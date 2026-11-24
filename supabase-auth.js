import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const url = window.HUMAN_PLUS_SUPABASE_URL;
const anon = window.HUMAN_PLUS_SUPABASE_ANON_KEY;
const configured = url && anon && !url.includes("YOUR-PROJECT") && !anon.includes("YOUR_SUPABASE");
const $ = (id) => document.getElementById(id);
let supabase = null;
let currentUser = null;
let adminRole = null;
let syncTimer = null;

function message(text, bad=false) {
  const el=$("authMessage"); if(el){el.textContent=text;el.style.color=bad?"#ff8d8d":"";}
}
function money(value,currency="XOF"){
  try{return new Intl.NumberFormat("fr-FR",{style:"currency",currency,maximumFractionDigits:0}).format(Number(value||0));}
  catch{return `${value||0} ${currency}`;}
}
async function recordEvent(event_type, metadata={}) {
  if(!supabase || !currentUser) return;
  await supabase.from("user_events").insert({user_id:currentUser.id,event_type,metadata});
}
async function syncState(){
  if(!supabase || !currentUser || !window.HP_GET_STATE) return;
  const data=window.HP_GET_STATE();
  await supabase.from("user_data").upsert({user_id:currentUser.id,data,updated_at:new Date().toISOString()},{onConflict:"user_id"});
}
window.HP_SYNC=()=>{
  if(!currentUser || !supabase) return;
  clearTimeout(syncTimer);
  syncTimer=setTimeout(()=>syncState(),900);
};
async function restoreState(){
  if(!supabase || !currentUser) return;
  const {data,error}=await supabase.from("user_data").select("data").eq("user_id",currentUser.id).maybeSingle();
  if(!error && data?.data && window.HP_SET_STATE) window.HP_SET_STATE(data.data);
  else await syncState();
}
async function refreshRole(){
  if(!supabase || !currentUser) {adminRole=null;return;}
  const {data}=await supabase.from("admin_roles").select("role").eq("user_id",currentUser.id).maybeSingle();
  adminRole=data?.role||null;
}
function updateAuthUI(session){
  currentUser=session?.user||null;
  const status=$("authStatus");
  if(status) status.textContent=currentUser?`Connecté : ${currentUser.email}`:"Hors ligne";
  if($("signOutBtn")) $("signOutBtn").hidden=!currentUser;
  if($("signInBtn")) $("signInBtn").hidden=!!currentUser;
  if($("signUpBtn")) $("signUpBtn").hidden=!!currentUser;
  if($("authName")) $("authName").disabled=!!currentUser;
  if($("openAuthBtn")) $("openAuthBtn").textContent=currentUser?"Mon compte":"Connexion";
  const canAdmin=(adminRole==="owner"||adminRole==="moderator");
  const adminView=$("admin"); if(adminView) adminView.hidden=!canAdmin;
}
async function signIn(){
  const email=$("authEmail").value.trim(),password=$("authPassword").value;
  const {data,error}=await supabase.auth.signInWithPassword({email,password});
  if(error) throw error;
  currentUser=data.user;
  await refreshRole();
  updateAuthUI(data);
  await recordEvent("login");
  await restoreState();
  message("Connexion réussie. Tes données sont synchronisées.");
}
async function signUp(){
  const email=$("authEmail").value.trim(),password=$("authPassword").value;
  const display_name=$("authName").value.trim();
  if(password.length<8) throw new Error("Le mot de passe doit contenir au moins 8 caractères.");
  const {data,error}=await supabase.auth.signUp({email,password,options:{data:{display_name}}});
  if(error) throw error;
  if(data.user && data.session){
    currentUser=data.user; await refreshRole(); updateAuthUI(data);
    await supabase.from("profiles").upsert({id:data.user.id,display_name});
    await recordEvent("signup"); await restoreState(); show("dashboard");
  }
  message(data.session?"Compte créé et connecté.":"Compte créé. Vérifie ta boîte e-mail pour confirmer l'inscription.");
}
async function resetPassword(){
  const email=$("authEmail").value.trim();
  if(!email) throw new Error("Saisis ton adresse e-mail avant de demander la réinitialisation.");
  const {error}=await supabase.auth.resetPasswordForEmail(email,{redirectTo:location.origin+location.pathname});
  if(error) throw error;
  message("Un lien de réinitialisation a été envoyé si cette adresse correspond à un compte.");
}
async function loadAdmin(){
  if(!adminRole || !supabase) return;
  const since=new Date(Date.now()-30*864e5).toISOString();
  const [profiles,events,installs,active,subs,payments,recent,mods]=await Promise.all([
    supabase.from("profiles").select("id",{count:"exact",head:true}),
    supabase.from("user_events").select("id",{count:"exact",head:true}).eq("event_type","login"),
    supabase.from("user_events").select("id",{count:"exact",head:true}).eq("event_type","pwa_install"),
    supabase.from("user_events").select("user_id").gte("created_at",since),
    supabase.from("subscriptions").select("id",{count:"exact",head:true}).eq("status","active"),
    supabase.from("revenue_events").select("amount,currency").eq("status","confirmed"),
    supabase.from("user_events").select("event_type,created_at,metadata,user_id").order("created_at",{ascending:false}).limit(12),
    supabase.from("admin_roles").select("user_id,role,profiles(display_name,email)")
  ]);
  const put=(id,v)=>{if($(id))$(id).textContent=v};
  put("adminSignups",profiles.count??"—");put("adminLogins",events.count??"—");put("adminInstalls",installs.count??"—");
  put("adminActive",new Set((active.data||[]).map(x=>x.user_id)).size);
  put("adminSubs",subs.count??"—");
  const totals={};(payments.data||[]).forEach(x=>{const c=x.currency||"XOF";totals[c]=(totals[c]||0)+Number(x.amount||0)});
  put("adminRevenue",Object.keys(totals).length?Object.entries(totals).map(([c,v])=>money(v,c)).join(" · "):"0 XOF");
  $("adminEvents").innerHTML=(recent.data||[]).map(e=>`<div class="history-row"><span><b>${String(e.event_type).replaceAll("_"," ")}</b><small>${new Date(e.created_at).toLocaleString("fr-FR")}</small></span><small>${e.user_id.slice(0,8)}…</small></div>`).join("")||"Aucun événement.";
  $("moderatorList").textContent=(mods.data||[]).filter(x=>x.role==="moderator").map(x=>x.profiles?.email||x.user_id).join(" · ")||"Aucun modérateur.";
}
async function addModerator(){
  const email=$("moderatorEmail").value.trim().toLowerCase();
  if(!email) return;
  const {data,error}=await supabase.rpc("grant_moderator_by_email",{target_email:email});
  if(error) throw error;
  $("moderatorEmail").value="";
  message(data||"Accès modérateur mis à jour.");
  await loadAdmin();
}
function show(view){
  document.querySelectorAll(".view").forEach(v=>v.classList.toggle("active",v.id===view));
  document.querySelectorAll("[data-view]").forEach(b=>b.classList.toggle("active",b.dataset.view===view));
  window.scrollTo({top:0,behavior:"smooth"});
}
async function boot(){
  if(!configured){
    message("Configuration manquante : renseigne l'URL du projet et la clé publique Supabase dans supabase-config.js.",true);
    $("openAuthBtn")?.addEventListener("click",()=>show("account"));
    return;
  }
  supabase=createClient(url,anon,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
  $("openAuthBtn")?.addEventListener("click",()=>show("account"));
  $("openAdminBtn")?.addEventListener("click",async()=>{show("admin");await loadAdmin()});
  $("authForm")?.addEventListener("submit",async e=>{e.preventDefault();try{await signIn()}catch(err){message(err.message,true)}});
  $("signUpBtn")?.addEventListener("click",async()=>{try{await signUp()}catch(err){message(err.message,true)}});
  $("resetPasswordBtn")?.addEventListener("click",async()=>{try{await resetPassword()}catch(err){message(err.message,true)}});
  $("signOutBtn")?.addEventListener("click",async()=>{await syncState();await supabase.auth.signOut();currentUser=null;adminRole=null;updateAuthUI(null);message("Déconnexion effectuée.")});
  $("refreshAdminBtn")?.addEventListener("click",async()=>{try{await loadAdmin()}catch(e){message(e.message,true)}});
  $("moderatorForm")?.addEventListener("submit",async e=>{e.preventDefault();try{await addModerator()}catch(err){message(err.message,true)}});
  supabase.auth.onAuthStateChange(async(_event,session)=>{
    currentUser=session?.user||null;
    if(currentUser){await refreshRole();updateAuthUI(session);await restoreState();if(adminRole==="owner"||adminRole==="moderator"){show("admin");await loadAdmin()}}
    else updateAuthUI(null);
  });
  const {data:{session}}=await supabase.auth.getSession();
  currentUser=session?.user||null;
  if(currentUser){await refreshRole();updateAuthUI(session);await restoreState();await recordEvent("session_start");if(adminRole==="owner"||adminRole==="moderator"){show("admin");await loadAdmin()}}
  else updateAuthUI(null);
  window.addEventListener("appinstalled",()=>recordEvent("pwa_install",{platform:"browser_appinstalled"}));
  document.addEventListener("visibilitychange",()=>{if(document.visibilityState==="visible"&&currentUser)recordEvent("app_open")});
}
boot();
