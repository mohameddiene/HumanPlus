/* HUMAN+ — Rappels & calendrier (stockage local + synchronisation via le compte) */
(function(){
"use strict";
const $=id=>document.getElementById(id);
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const MONTHS=["Janvier","Février","Mars","Avril","Mai","Juin","Juillet","Août","Septembre","Octobre","Novembre","Décembre"];
const WD=["Lun","Mar","Mer","Jeu","Ven","Sam","Dim"];            // affichage lundi → dimanche
const WD_JS=[1,2,3,4,5,6,0];                                      // valeur getDay() correspondante
const ICONS=[["💧","Boire de l'eau"],["🏋️","Séance de sport"],["🍽️","Repas"],["💊","Médicament"],["😴","Dormir"],["✍️","Habitude"],["🌿","Activité Outdoor"],["📊","Bilan de progression"],["⭐","Autre"]];
const ALL=[0,1,2,3,4,5,6];
const TPL=[
 {id:"sport",icon:"🏋️",label:"Séance de sport",desc:"Lun · Mer · Ven à 18:00",data:{title:"Séance de sport",icon:"🏋️",time:"18:00",days:[1,3,5],everyH:0,go:"fitness"}},
 {id:"goals",icon:"✦",label:"Objectifs du jour",desc:"Chaque jour à 19:00 · sauf si tout est fait",data:{title:"Tes objectifs du jour",icon:"✦",time:"19:00",days:ALL,everyH:0,cond:"habits",go:"habits"}},
 {id:"water",icon:"💧",label:"Boire de l'eau",desc:"Toutes les 2 h, 08:00–20:00 · sauf si 8 verres bus",data:{title:"Boire de l'eau",icon:"💧",time:"08:00",days:ALL,everyH:2,endTime:"20:00",cond:"water",go:"habits"}},
 {id:"outdoor",icon:"🌿",label:"Activité Outdoor",desc:"Samedi à 08:00",data:{title:"Activité Outdoor",icon:"🌿",time:"08:00",days:[6],everyH:0,go:"outdoor"}},
 {id:"review",icon:"📊",label:"Bilan de progression",desc:"Dimanche à 18:00",data:{title:"Bilan de la semaine",icon:"📊",time:"18:00",days:[0],everyH:0,go:"dashboard"}}
];
const COND_TXT={water:"sauf si les 8 verres sont bus",habits:"sauf si toutes les habitudes sont faites"};
const ls={get(k,f){try{return JSON.parse(localStorage.getItem("hp_"+k))??f}catch{return f}},set(k,v){try{localStorage.setItem("hp_"+k,JSON.stringify(v))}catch{}}};

let reminders=ls.get("reminders",[]);
let done=ls.get("rem_done",{});
let fired=ls.get("rem_fired",{});
let snoozes=ls.get("rem_snooze",[]);
let view=new Date(); view.setDate(1);
let selected=dstr(new Date());
let editing=null;               // id en cours de modification (ou "new")
let form={icon:"💧",days:[0,1,2,3,4,5,6]};

function dstr(d){return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0")}
function toMin(t){const [h,m]=String(t||"0:0").split(":").map(Number);return (h||0)*60+(m||0)}
function toHM(m){return String(Math.floor(m/60)).padStart(2,"0")+":"+String(m%60).padStart(2,"0")}
function parseDate(s){const [y,m,d]=s.split("-").map(Number);return new Date(y,m-1,d)}
function save(){ls.set("reminders",reminders);ls.set("rem_done",done);ls.set("rem_fired",fired);ls.set("rem_snooze",snoozes);window.HP_SYNC?.()}
function cleanup(){const limit=dstr(new Date(Date.now()-45*864e5));[done,fired].forEach(o=>Object.keys(o).forEach(k=>{if(k.slice(0,10)<limit)delete o[k]}))}

// ---- Calcul des occurrences d'un rappel pour un jour donné ----
function occurrences(r,date){
  if(!r.on)return [];
  const ds=dstr(date);
  if(r.date){if(r.date!==ds)return []}else if(!(r.days||[]).includes(date.getDay()))return [];
  const start=toMin(r.time);
  if(!(r.everyH>0))return [toHM(start)];
  const end=Math.max(start,toMin(r.endTime||"20:00")),step=Math.round(r.everyH*60),out=[];
  for(let m=start;m<=end&&out.length<48;m+=step)out.push(toHM(m));
  return out;
}
function dayItems(date){
  const ds=dstr(date),items=[];
  reminders.forEach(r=>occurrences(r,date).forEach(t=>items.push({r,t,key:ds+"|"+r.id+"|"+t})));
  return items.sort((a,b)=>a.t.localeCompare(b.t));
}

// ---- Alerte : notification système + bannière + son + vibration ----
function beep(){try{const C=window.AudioContext||window.webkitAudioContext;if(!C)return;const c=new C(),o=c.createOscillator(),g=c.createGain();o.connect(g);g.connect(c.destination);o.frequency.value=880;g.gain.setValueAtTime(.15,c.currentTime);g.gain.exponentialRampToValueAtTime(.001,c.currentTime+.6);o.start();o.stop(c.currentTime+.6)}catch{}}
async function systemNotify(title,body,tag){
  if(typeof Notification==="undefined"||Notification.permission!=="granted")return;
  try{
    if("serviceWorker" in navigator){const reg=await navigator.serviceWorker.ready;await reg.showNotification(title,{body,tag,icon:"/icons/icon-192.png",badge:"/icons/icon-192.png",vibrate:[200,100,200],renotify:true});}
    else new Notification(title,{body,icon:"/icons/icon-192.png"});
  }catch{}
}
let queue=[];
function showAlert(item){
  queue.push(item);
  if(!$("remAlert")||!$("remAlert").hidden)return;
  nextAlert();
}
function nextAlert(){
  const el=$("remAlert");if(!el)return;
  const it=queue.shift();
  if(!it){el.hidden=true;return}
  el.hidden=false;
  el.innerHTML=`<div class="rem-alert-card"><div class="rem-alert-icon">${esc(it.icon)}</div><div class="rem-alert-text"><small>RAPPEL · ${esc(it.t)}${it.late?" (manqué)":""}</small><strong>${esc(it.title)}</strong></div><div class="rem-alert-actions"><button class="primary-btn" data-a="done">Fait ✓</button>${it.go?'<button class="secondary-btn" data-a="open">Ouvrir</button>':""}<button class="secondary-btn" data-a="snooze">+10 min</button><button class="text-btn" data-a="close">Fermer</button></div></div>`;
  el.querySelector('[data-a="done"]').onclick=()=>{if(it.key)done[it.key]=true;save();render();nextAlert()};
  el.querySelector('[data-a="snooze"]').onclick=()=>{snoozes.push({id:it.rid,title:it.title,icon:it.icon,go:it.go,at:Date.now()+10*60000});save();nextAlert()};
  el.querySelector('[data-a="close"]').onclick=()=>nextAlert();
  const ob=el.querySelector('[data-a="open"]');if(ob)ob.onclick=()=>{window.showView?.(it.go);nextAlert()};
}
function fire(r,t,key,late){
  fired[key]=true;
  const title=(r.icon||"⏰")+" "+r.title;
  systemNotify(title,late?"Rappel manqué de "+t:"C'est l'heure — "+t,key);
  try{navigator.vibrate?.([200,100,200])}catch{}
  beep();
  showAlert({rid:r.id,title:r.title,icon:r.icon||"⏰",t,key,late,go:r.go});
}

// ---- Condition « objectif déjà atteint » : pas de rappel inutile ----
function condMet(r){
  if(!r.cond)return false;
  const st=window.HP_GET_STATE?window.HP_GET_STATE():null;if(!st)return false;
  if(r.cond==="water")return Number(st.water)>=8;
  if(r.cond==="habits")return Array.isArray(st.habits)&&st.habits.length>0&&(st.checked||[]).length>=st.habits.length;
  return false;
}

// ---- Moteur : vérifie toutes les 15 s tant que l'application est ouverte ----
function tick(){
  const now=new Date(),nowMin=now.getHours()*60+now.getMinutes();
  let changed=false;
  dayItems(now).forEach(({r,t,key})=>{
    const m=toMin(t);
    if(m<=nowMin&&nowMin-m<=120&&!fired[key]&&!done[key]){
      if(condMet(r)){fired[key]=true;done[key]=true;changed=true;return}
      fire(r,t,key,nowMin-m>2);changed=true}
  });
  const due=snoozes.filter(s=>s.at<=Date.now());
  if(due.length){snoozes=snoozes.filter(s=>s.at>Date.now());due.forEach(s=>{beep();systemNotify((s.icon||"⏰")+" "+s.title,"Rappel reporté","snooze-"+s.id);showAlert({rid:s.id,title:s.title,icon:s.icon||"⏰",t:toHM(nowMin),key:null,late:false,go:s.go})});changed=true}
  if(changed){save();render()}
}

// ---- Interface ----
function permissionText(){
  if(typeof Notification==="undefined")return ["Ce navigateur ne gère pas les notifications. Les rappels s'afficheront dans l'application.",false];
  if(Notification.permission==="granted")return ["Notifications activées ✓",false];
  if(Notification.permission==="denied")return ["Notifications bloquées. Autorise-les dans les paramètres du site du navigateur.",false];
  return ["Les notifications ne sont pas encore activées.",true];
}
function renderCalendar(){
  const y=view.getFullYear(),m=view.getMonth();
  $("remMonthLabel").textContent=MONTHS[m]+" "+y;
  const first=new Date(y,m,1),offset=(first.getDay()+6)%7,days=new Date(y,m+1,0).getDate(),today=dstr(new Date());
  let html=WD.map(d=>`<div class="rem-wd">${d}</div>`).join("");
  for(let i=0;i<offset;i++)html+=`<div class="rem-day empty"></div>`;
  for(let d=1;d<=days;d++){
    const date=new Date(y,m,d),ds=dstr(date),items=dayItems(date),n=items.length;
    const doneN=items.filter(i=>done[i.key]).length;
    html+=`<button class="rem-day${ds===today?" today":""}${ds===selected?" selected":""}" data-date="${ds}"><span>${d}</span>${n?`<i class="${doneN===n?"all":""}">${n>3?"•••":"•".repeat(n)}</i>`:""}</button>`;
  }
  $("remCalendar").innerHTML=html;
  $("remCalendar").querySelectorAll("[data-date]").forEach(b=>b.onclick=()=>{selected=b.dataset.date;render()});
}
function renderDay(){
  const date=parseDate(selected),items=dayItems(date);
  const label=date.toLocaleDateString("fr-FR",{weekday:"long",day:"numeric",month:"long"});
  $("remDayTitle").textContent=label.charAt(0).toUpperCase()+label.slice(1);
  $("remDayList").innerHTML=items.length?items.map(({r,t,key})=>`<div class="rem-item${done[key]?" is-done":""}"><button class="rem-check" data-key="${esc(key)}" aria-label="Marquer comme fait">${done[key]?"✓":""}</button><div class="rem-item-body"><strong>${esc(r.icon||"⏰")} ${esc(r.title)}</strong><small>${t}</small></div></div>`).join(""):`<div class="empty-state">Aucun rappel ce jour-là.</div>`;
  $("remDayList").querySelectorAll("[data-key]").forEach(b=>b.onclick=()=>{const k=b.dataset.key;if(done[k])delete done[k];else done[k]=true;save();render()});
}
function repeatText(r){
  const when=r.date?"Le "+parseDate(r.date).toLocaleDateString("fr-FR"):((r.days||[]).length===7?"Tous les jours":WD.filter((_,i)=>(r.days||[]).includes(WD_JS[i])).join(" · "));
  const base=r.everyH>0?`${when} · toutes les ${r.everyH} h, de ${r.time} à ${r.endTime}`:`${when} · à ${r.time}`;
  return r.cond&&COND_TXT[r.cond]?base+" · "+COND_TXT[r.cond]:base;
}
function renderList(){
  $("remList").innerHTML=reminders.length?reminders.map(r=>`<div class="rem-row"><div class="rem-row-main"><strong>${esc(r.icon||"⏰")} ${esc(r.title)}</strong><small>${esc(repeatText(r))}</small></div><label class="rem-switch"><input type="checkbox" data-toggle="${esc(r.id)}" ${r.on?"checked":""} aria-label="Activer"><span></span></label><button class="text-btn" data-edit="${esc(r.id)}">Modifier</button><button class="text-btn rem-del" data-del="${esc(r.id)}">Supprimer</button></div>`).join(""):`<div class="empty-state">Aucun rappel. Crée le premier ci-dessous.</div>`;
  $("remList").querySelectorAll("[data-toggle]").forEach(i=>i.onchange=()=>{const r=reminders.find(x=>x.id===i.dataset.toggle);if(r){r.on=i.checked;save();render()}});
  $("remList").querySelectorAll("[data-edit]").forEach(b=>b.onclick=()=>openForm(b.dataset.edit));
  $("remList").querySelectorAll("[data-del]").forEach(b=>b.onclick=()=>{if(confirm("Supprimer ce rappel ?")){reminders=reminders.filter(x=>x.id!==b.dataset.del);save();render()}});
}
function renderPerm(){
  const [txt,canAsk]=permissionText();
  $("remPermText").textContent=txt;
  $("remPermBtn").hidden=!canAsk;
}
function renderTemplates(){
  const box=$("remTemplates");if(!box)return;
  box.innerHTML=TPL.map(t=>{const has=reminders.some(r=>r.tpl===t.id);return `<button type="button" class="rem-tpl${has?" added":""}" data-tpl="${t.id}"><span class="rem-tpl-icon">${t.icon}</span><span class="rem-tpl-text"><strong>${esc(t.label)}</strong><small>${esc(t.desc)}</small></span><b>${has?"Ajouté ✓":"+ Ajouter"}</b></button>`}).join("");
  box.querySelectorAll("[data-tpl]").forEach(b=>b.onclick=()=>addTemplate(b.dataset.tpl));
}
function addTemplate(id){
  const t=TPL.find(x=>x.id===id);if(!t)return false;
  if(reminders.some(r=>r.tpl===id)){window.toast?.("Ce modèle est déjà ajouté");return false}
  reminders.push({id:"r"+Date.now().toString(36)+Math.random().toString(36).slice(2,5),tpl:id,date:null,endTime:null,on:true,...JSON.parse(JSON.stringify(t.data))});
  save();render();window.toast?.("Rappel ajouté : "+t.label);return true;
}
function render(){if(!$("remCalendar"))return;renderPerm();renderCalendar();renderDay();renderTemplates();renderList()}

// ---- Formulaire ----
function renderIcons(){
  $("remIcons").innerHTML=ICONS.map(([i,l])=>`<button type="button" class="rem-chip${form.icon===i?" active":""}" data-icon="${i}" title="${esc(l)}">${i}</button>`).join("");
  $("remIcons").querySelectorAll("[data-icon]").forEach(b=>b.onclick=()=>{form.icon=b.dataset.icon;const t=$("remTitle");if(!t.value||ICONS.some(x=>x[1]===t.value))t.value=ICONS.find(x=>x[0]===form.icon)[1];renderIcons()});
}
function renderDays(){
  $("remDays").innerHTML=WD.map((d,i)=>`<button type="button" class="rem-chip${form.days.includes(WD_JS[i])?" active":""}" data-d="${WD_JS[i]}">${d}</button>`).join("");
  $("remDays").querySelectorAll("[data-d]").forEach(b=>b.onclick=()=>{const v=Number(b.dataset.d);form.days=form.days.includes(v)?form.days.filter(x=>x!==v):[...form.days,v];renderDays()});
}
function syncRepeatUI(){
  const mode=$("remRepeat").value;
  $("remDaysWrap").hidden=mode!=="days";
  $("remDateWrap").hidden=mode!=="once";
  $("remEveryWrap").hidden=!$("remEvery").checked;
}
function openForm(id){
  editing=id;
  const r=id==="new"?null:reminders.find(x=>x.id===id);
  form={icon:r?.icon||"💧",days:r?.days?.length?[...r.days]:[0,1,2,3,4,5,6]};
  $("remFormTitle").textContent=r?"Modifier le rappel":"Nouveau rappel";
  $("remTitle").value=r?.title||"Boire de l'eau";
  $("remTime").value=r?.time||"08:00";
  $("remRepeat").value=r?.date?"once":((r?.days||[]).length===7||!r?"daily":"days");
  $("remDate").value=r?.date||dstr(new Date());
  $("remEvery").checked=!!(r?.everyH>0);
  $("remEveryH").value=r?.everyH>0?r.everyH:2;
  $("remEnd").value=r?.endTime||"20:00";
  $("remCond").value=r?.cond||"";
  $("remError").textContent="";
  $("remForm").hidden=false;
  renderIcons();renderDays();syncRepeatUI();
  $("remForm").scrollIntoView({behavior:"smooth",block:"center"});
}
function submitForm(e){
  e.preventDefault();
  const title=$("remTitle").value.trim(),time=$("remTime").value,mode=$("remRepeat").value;
  const err=m=>{$("remError").textContent=m};
  if(!title)return err("Donne un nom au rappel.");
  if(!time)return err("Choisis une heure.");
  let days=[0,1,2,3,4,5,6],date=null;
  if(mode==="days"){days=[...form.days];if(!days.length)return err("Choisis au moins un jour.")}
  if(mode==="once"){date=$("remDate").value;if(!date)return err("Choisis une date.")}
  let everyH=0,endTime=null;
  if($("remEvery").checked){
    everyH=Number($("remEveryH").value);endTime=$("remEnd").value;
    if(!(everyH>=0.5&&everyH<=12))return err("Intervalle entre 0,5 h et 12 h.");
    if(!endTime||toMin(endTime)<toMin(time))return err("L'heure de fin doit être après l'heure de début.");
  }
  const data={title,icon:form.icon,time,days,date,everyH,endTime,cond:$("remCond").value||null,on:true};
  if(editing==="new")reminders.push({id:"r"+Date.now().toString(36)+Math.random().toString(36).slice(2,5),...data});
  else{const r=reminders.find(x=>x.id===editing);if(r)Object.assign(r,data)}
  $("remForm").hidden=true;editing=null;save();render();
  window.toast?.("Rappel enregistré");
}
function init(){
  if(!$("reminders"))return;
  cleanup();
  $("remPrev").onclick=()=>{view=new Date(view.getFullYear(),view.getMonth()-1,1);renderCalendar()};
  $("remNext").onclick=()=>{view=new Date(view.getFullYear(),view.getMonth()+1,1);renderCalendar()};
  $("remAdd").onclick=()=>openForm("new");
  $("remWater").onclick=()=>addTemplate("water");
  $("remCancel").onclick=()=>{$("remForm").hidden=true;editing=null};
  $("remForm").addEventListener("submit",submitForm);
  $("remRepeat").onchange=syncRepeatUI;$("remEvery").onchange=syncRepeatUI;
  $("remPermBtn").onclick=async()=>{try{await Notification.requestPermission()}catch{}renderPerm()};
  render();tick();
  setInterval(tick,15000);
  document.addEventListener("visibilitychange",()=>{if(!document.hidden)tick()});
}
window.HP_REM_ADD_TEMPLATE=addTemplate;
window.HP_REM_GET=()=>reminders;
window.HP_REM_SET=list=>{if(!Array.isArray(list))return;reminders=list;ls.set("reminders",reminders);render()};
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",init);else init();
})();
