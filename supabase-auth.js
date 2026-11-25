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
window.HP_RECORD_EVENT=(type,metadata={})=>recordEvent(type,metadata);
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
function setAvatar(url){const preview=$('profilePhotoPreview'),mini=document.querySelector('.profile-mini .avatar');[preview,mini].forEach(el=>{if(!el)return;if(url){el.style.backgroundImage=`url("${url}")`;el.textContent=''}else{el.style.backgroundImage='';el.textContent='H+'}})}
async function loadProfile(){if(!supabase||!currentUser)return;const {data}=await supabase.from('profiles').select('avatar_url,display_name').eq('id',currentUser.id).maybeSingle();setAvatar(data?.avatar_url||'');if(data?.display_name&&$('authName'))$('authName').value=data.display_name;}
async function uploadAvatar(file){if(!file||!currentUser)throw new Error('Connecte-toi avant de modifier ta photo.');if(file.size>5*1024*1024)throw new Error('La photo doit faire 5 Mo maximum.');if(!['image/jpeg','image/png','image/webp'].includes(file.type))throw new Error('Format accepté : JPG, PNG ou WebP.');const ext=file.type==='image/png'?'png':file.type==='image/webp'?'webp':'jpg';const path=`${currentUser.id}/avatar-${Date.now()}.${ext}`;const {error:upErr}=await supabase.storage.from('profile-photos').upload(path,file,{upsert:true,contentType:file.type});if(upErr)throw upErr;const {data}=supabase.storage.from('profile-photos').getPublicUrl(path);const {error}=await supabase.from('profiles').upsert({id:currentUser.id,avatar_url:data.publicUrl});if(error)throw error;setAvatar(data.publicUrl);message('Photo de profil mise à jour.');}
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
  const adminView=$("admin"); if(adminView) adminView.hidden=!canAdmin;const supervise=$("superviseNav");if(supervise)supervise.hidden=!canAdmin;const superviseMobile=$("superviseMobileNav");if(superviseMobile)superviseMobile.hidden=!canAdmin;
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
  await loadProfile();
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
    await recordEvent("signup"); await restoreState(); await loadProfile(); show("dashboard");
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
    supabase.from("user_events").select("event_type,created_at,metadata,user_id").order("created_at",{ascending:false}).limit(500),
    supabase.from("admin_roles").select("user_id,role,profiles(display_name,email)")
  ]);
  const put=(id,v)=>{if($(id))$(id).textContent=v};
  put("adminSignups",profiles.count??"—");put("adminLogins",events.count??"—");put("adminInstalls",installs.count??"—");
  put("adminActive",new Set((active.data||[]).map(x=>x.user_id)).size);
  put("adminSubs",subs.count??"—");
  const totals={};(payments.data||[]).forEach(x=>{const c=x.currency||"XOF";totals[c]=(totals[c]||0)+Number(x.amount||0)});
  put("adminRevenue",Object.keys(totals).length?Object.entries(totals).map(([c,v])=>money(v,c)).join(" · "):"0 XOF");
  const allEvents=recent.data||[];
  const draw=(id,items)=>{const el=$(id);if(!el)return;const max=Math.max(1,...items.map(x=>x.value));el.innerHTML=items.map(x=>`<div class="chart-bar-wrap"><div class="chart-value">${x.value}</div><div class="chart-bar" style="height:${Math.max(5,x.value/max*100)}%"></div><small>${x.label}</small></div>`).join("")||"<span class=muted>Pas encore de données.</span>"};
  const days=Array.from({length:7},(_,i)=>{const d=new Date();d.setDate(d.getDate()-(6-i));return d.toISOString().slice(0,10)});
  const accountSeries=days.map(day=>({label:day.slice(5),value:allEvents.filter(e=>e.created_at?.slice(0,10)===day&&["signup","login"].includes(e.event_type)).length}));draw("chartAccounts",accountSeries);
  draw("chartFitness",[{label:"Séances",value:allEvents.filter(e=>e.event_type==="workout_saved").length}]);draw("chartHabits",[{label:"Actions",value:allEvents.filter(e=>e.event_type==="habit_updated").length}]);draw("chartNutrition",[{label:"Verres ajoutés",value:allEvents.filter(e=>e.event_type==="water_added").length}]);
  draw("chartOutdoor",[{label:"Course",value:allEvents.filter(e=>e.event_type==="outdoor_saved"&&e.metadata?.type==="Course").length},{label:"Vélo",value:allEvents.filter(e=>e.event_type==="outdoor_saved"&&e.metadata?.type==="Vélo").length},{label:"Marche",value:allEvents.filter(e=>e.event_type==="outdoor_saved"&&e.metadata?.type==="Marche").length},{label:"Rapide",value:allEvents.filter(e=>e.event_type==="outdoor_saved"&&e.metadata?.type==="Marche rapide").length}]);
  draw("chartRevenue",[{label:"Actifs",value:subs.count||0},{label:"Paiements",value:(payments.data||[]).length}]);
  $("adminEvents").innerHTML=(recent.data||[]).slice(0,12).map(e=>`<div class="history-row"><span><b>${String(e.event_type).replaceAll("_"," ")}</b><small>${new Date(e.created_at).toLocaleString("fr-FR")}</small></span><small>${e.user_id.slice(0,8)}…</small></div>`).join("")||"Aucun événement.";
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
  if(view==="admin")loadAdmin().catch(e=>message(e.message,true));
}
async function boot(){
  if(!configured){
    message("Configuration manquante : renseigne l'URL du projet et la clé publique Supabase dans supabase-config.js.",true);
    $("openAuthBtn")?.addEventListener("click",()=>show("account"));
    return;
  }
  supabase=createClient(url,anon,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
  $("openAuthBtn")?.addEventListener("click",()=>show("account"));
  $("superviseNav")?.addEventListener("click",async()=>{if(adminRole){show("admin");await loadAdmin()}});
  window.HP_LOAD_ADMIN=()=>{if(adminRole)return loadAdmin()};
  $("authForm")?.addEventListener("submit",async e=>{e.preventDefault();try{await signIn()}catch(err){message(err.message,true)}});
  $("signUpBtn")?.addEventListener("click",async()=>{try{await signUp()}catch(err){message(err.message,true)}});
  $("resetPasswordBtn")?.addEventListener("click",async()=>{try{await resetPassword()}catch(err){message(err.message,true)}});
  $('signOutBtn')?.addEventListener('click',async()=>{await syncState();const {error}=await supabase.auth.signOut();if(error){message(error.message,true);return;}currentUser=null;adminRole=null;updateAuthUI(null);['authName','authEmail','authPassword'].forEach(id=>{if($(id))$(id).value=''});if($('profilePhotoInput'))$('profilePhotoInput').value='';setAvatar('');show('dashboard');message('Déconnexion effectuée. Les champs du formulaire ont été vidés.');});
  $('changeProfilePhotoBtn')?.addEventListener('click',()=>{if(!currentUser){message('Connecte-toi pour modifier ta photo.',true);return;}$('profilePhotoInput')?.click()});
  $('profilePhotoInput')?.addEventListener('change',async e=>{try{await uploadAvatar(e.target.files?.[0])}catch(err){message(err.message,true)}finally{e.target.value=''}});
  $("refreshAdminBtn")?.addEventListener("click",async()=>{try{await loadAdmin()}catch(e){message(e.message,true)}});
  $("moderatorForm")?.addEventListener("submit",async e=>{e.preventDefault();try{await addModerator()}catch(err){message(err.message,true)}});
  supabase.auth.onAuthStateChange(async(_event,session)=>{
    currentUser=session?.user||null;
    if(currentUser){await refreshRole();updateAuthUI(session);await restoreState();await loadProfile();if(adminRole==="owner"||adminRole==="moderator"){show("dashboard");}}
    else updateAuthUI(null);
  });
  const {data:{session}}=await supabase.auth.getSession();
  currentUser=session?.user||null;
  if(currentUser){await refreshRole();updateAuthUI(session);await restoreState();await loadProfile();await recordEvent("session_start");if(adminRole==="owner"||adminRole==="moderator"){show("dashboard");}}
  else updateAuthUI(null);
  window.addEventListener("appinstalled",()=>recordEvent("pwa_install",{platform:"browser_appinstalled"}));
  document.addEventListener("visibilitychange",()=>{if(document.visibilityState==="visible"&&currentUser)recordEvent("app_open")});
}
boot();
