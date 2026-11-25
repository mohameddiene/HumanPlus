const CACHE = "human-plus-v9";
const ASSETS = ["/", "/index.html", "/styles.css", "/app.js", "/outdoor.js", "/reminders.js", "/supabase-auth.js", "/supabase-config.js", "/manifest.webmanifest", "/icons/icon.svg", "/icons/icon-192.png", "/icons/icon-512.png"];

// Installation : un fichier manquant ne doit jamais faire échouer tout le service worker
self.addEventListener("install", e => {
  e.waitUntil(
    caches.open(CACHE).then(c => Promise.all(ASSETS.map(a => c.add(a).catch(() => {}))))
  );
  self.skipWaiting();
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Réseau d'abord (pour recevoir les mises à jour), cache en secours hors ligne
self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET" || !req.url.startsWith(self.location.origin)) return;
  e.respondWith(
    fetch(req).then(res => {
      if (res && res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
      return res;
    }).catch(() => caches.match(req).then(r => r || caches.match("/index.html")))
  );
});

// Notification push reçue du serveur (application fermée comprise)
self.addEventListener("push", e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { body: e.data ? e.data.text() : "" }; }
  e.waitUntil(self.registration.showNotification(d.title || "HUMAN+", {
    body: d.body || "",
    tag: d.tag || undefined,
    icon: "/icons/icon-192.png",
    badge: "/icons/icon-192.png",
    vibrate: [200, 100, 200],
    renotify: !!d.tag,
    data: { url: d.url || "/" }
  }));
});

// Clic sur une notification : ouvre ou ramène HUMAN+ au premier plan, sur la bonne page
self.addEventListener("notificationclick", e => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || "/";
  const go = new URL(url, self.location.origin).hash.slice(1);
  e.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(list => {
      for (const c of list) {
        if ("focus" in c) { c.postMessage({ go }); return c.focus(); }
      }
      return self.clients.openWindow(url);
    })
  );
});
