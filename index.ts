// HUMAN+ — envoi des rappels en notification push (Supabase Edge Function)
// Appelée chaque minute par pg_cron (voir supabase-cron.sql) avec l'en-tête x-cron-secret.
// Appelée aussi par l'appli (bouton « Envoyer un test ») avec la session de l'utilisateur.
import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

// BEGIN-PURE (logique sans dépendance, testée séparément)
const toMin = (t: any) => { const [h, m] = String(t || "0:0").split(":").map(Number); return (h || 0) * 60 + (m || 0); };
const toHM = (m: number) => String(Math.floor(m / 60)).padStart(2, "0") + ":" + String(m % 60).padStart(2, "0");

function localParts(now: Date, tz: string) {
  const opts: any = { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", weekday: "short", hourCycle: "h23" };
  let f: Intl.DateTimeFormat;
  try { f = new Intl.DateTimeFormat("en-CA", { timeZone: tz, ...opts }); }
  catch { f = new Intl.DateTimeFormat("en-CA", { timeZone: "UTC", ...opts }); }
  const p: any = {};
  for (const x of f.formatToParts(now)) p[x.type] = x.value;
  return {
    date: `${p.year}-${p.month}-${p.day}`,
    minutes: (Number(p.hour) % 24) * 60 + Number(p.minute),
    weekday: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(p.weekday),
  };
}

function occurrences(r: any, local: any): string[] {
  if (!r || !r.on) return [];
  if (r.date) { if (r.date !== local.date) return []; }
  else if (!Array.isArray(r.days) || !r.days.includes(local.weekday)) return [];
  const start = toMin(r.time);
  if (!(r.everyH > 0)) return [toHM(start)];
  const end = Math.max(start, toMin(r.endTime || "20:00")), step = Math.round(r.everyH * 60);
  const out: string[] = [];
  for (let m = start; m <= end && out.length < 48; m += step) out.push(toHM(m));
  return out;
}

// Pas de rappel si l'objectif du jour est déjà atteint (uniquement si les données sont celles d'aujourd'hui)
function condMet(r: any, data: any, local: any): boolean {
  if (!r.cond || !data || data.day !== local.date) return false;
  if (r.cond === "water") return Number(data.water) >= 8;
  if (r.cond === "habits") return Array.isArray(data.habits) && data.habits.length > 0 && Array.isArray(data.checked) && data.checked.length >= data.habits.length;
  return false;
}

function dueReminders(data: any, tz: string, now: Date, windowMin = 2) {
  const local = localParts(now, tz);
  const out: any[] = [];
  for (const r of (Array.isArray(data?.reminders) ? data.reminders : [])) {
    for (const t of occurrences(r, local)) {
      const diff = local.minutes - toMin(t);
      if (diff < 0 || diff > windowMin) continue;
      if (condMet(r, data, local)) continue;
      out.push({ r, t, key: `${local.date}|${r.id}|${t}` });
    }
  }
  return out;
}
// END-PURE

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

async function sendPush(admin: any, s: any, payload: any) {
  try {
    await webpush.sendNotification(
      { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
      JSON.stringify(payload),
      { TTL: 600, urgency: "high" },
    );
    return true;
  } catch (e: any) {
    if (e?.statusCode === 404 || e?.statusCode === 410) await admin.from("push_subscriptions").delete().eq("id", s.id);
    console.error("push error", e?.statusCode, e?.body);
    return false;
  }
}

async function runCron(admin: any) {
  const { data: subs, error } = await admin.from("push_subscriptions").select("id,user_id,endpoint,p256dh,auth,tz").limit(5000);
  if (error) return json({ error: error.message }, 500);
  if (!subs?.length) return json({ ok: true, subs: 0, sent: 0 });
  const userIds = [...new Set(subs.map((s: any) => s.user_id))];
  const { data: rows } = await admin.from("user_data").select("user_id,data").in("user_id", userIds);
  const byUser = new Map((rows || []).map((r: any) => [r.user_id, r.data]));
  const now = new Date();
  let sent = 0, failed = 0;
  for (const s of subs) {
    for (const d of dueReminders(byUser.get(s.user_id), s.tz || "UTC", now)) {
      // Anti-doublon : on n'envoie que si la ligne vient d'être insérée
      const { data: ins } = await admin.from("push_sent").upsert({ sub_id: s.id, key: d.key }, { onConflict: "sub_id,key", ignoreDuplicates: true }).select();
      if (!ins || !ins.length) continue;
      const ok = await sendPush(admin, s, {
        title: `${d.r.icon || "⏰"} ${d.r.title}`,
        body: `C'est l'heure — ${d.t}`,
        tag: d.key,
        url: "/#" + (d.r.go || "reminders"),
      });
      ok ? sent++ : failed++;
    }
  }
  if (now.getUTCMinutes() === 0) await admin.from("push_sent").delete().lt("sent_at", new Date(Date.now() - 3 * 864e5).toISOString());
  return json({ ok: true, subs: subs.length, sent, failed });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const pub = Deno.env.get("VAPID_PUBLIC_KEY"), priv = Deno.env.get("VAPID_PRIVATE_KEY");
  if (!pub || !priv) return json({ error: "Clés VAPID manquantes dans les secrets de la fonction." }, 500);
  webpush.setVapidDetails(Deno.env.get("VAPID_SUBJECT") || "mailto:contact@example.com", pub, priv);
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  // 1) Appel du planificateur (cron)
  const secret = Deno.env.get("CRON_SECRET");
  if (secret && req.headers.get("x-cron-secret") === secret) return await runCron(admin);

  // 2) Test envoyé par un utilisateur connecté, uniquement vers ses propres appareils
  const body = await req.json().catch(() => ({}));
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (body?.test && token) {
    const { data } = await admin.auth.getUser(token);
    if (data?.user) {
      const { data: subs } = await admin.from("push_subscriptions").select("id,endpoint,p256dh,auth").eq("user_id", data.user.id);
      if (!subs?.length) return json({ ok: false, error: "Aucun appareil enregistré pour ce compte." }, 404);
      let sent = 0;
      for (const s of subs) if (await sendPush(admin, s, { title: "✅ HUMAN+", body: "Les rappels en arrière-plan fonctionnent.", tag: "test", url: "/#reminders" })) sent++;
      return json({ ok: sent > 0, sent });
    }
  }
  return json({ error: "Non autorisé" }, 401);
});
