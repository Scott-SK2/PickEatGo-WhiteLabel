"use client";
import { TOUCH_CSS } from "../../lib/touch.css";
import { useHistoryPage } from "../../lib/useHistoryPage";
import { useOrderWebSocket } from "../../lib/useWebSocket";
import { useRef, useState, useEffect, useCallback } from "react";
import { useAuth } from "../../lib/AuthContext";
import { printTicket, previewTicket, getPrintPrefs, setPrintPrefs } from "../../lib/ticket";
import PushToggle from "../PushToggle";
import Lightbox from "../Lightbox";
import { openState, localNow } from "../../lib/hours";
import { API, get, post, patch, put, del, upload, money, todayISO, Ic, STATUS_CONFIG, TYPE_LABELS, PAYMENT_LABELS, UNIT_LABELS, nextStep, payStep, statusLabel } from "./shared";
import { SalesPage, StockPage, CustomersPage, CounterSaleModal, NotificationsPanel, ActivityChart, PaymentChooser } from "./management";
import MyAppCard from "./myapp";
import { useBrand } from "../../lib/BrandContext";

// Types de cuisine proposés (mode mono-restaurant : la cuisine se modifie depuis « Profil restaurant »)
const CUISINES = [
  "Américain","Français","Italien","Espagnol","Grec","Belge","Allemand",
  "Marocain","Tunisien","Algérien","Maghrébin","Méditerranéen","Africain","Afro européen","Caraïbéen",
  "Indien","Thaïlandais","Japonais","Chinois","Libanais","Mexicain",
  "Végétarien","Healthy","Traditionnel","Gastronomique","Bistro / Brasserie",
  "Snack / Restauration rapide","Fast-food","Street food","Cafétéria","Buffet à volonté","Food truck",
  "Salon de thé / Café","Pâtisserie / Boulangerie","Bar à tapas","Grill / Steakhouse","Pizzeria","Crêperie","Autre",
];

const DAY_NAMES = ["Lundi","Mardi","Mercredi","Jeudi","Vendredi","Samedi","Dimanche"];
const initHours = (apiHours) => DAY_NAMES.map((_,i) => {
  const found = (apiHours||[]).find(h => h.day_of_week === i);
  return found ? {day_of_week:found.day_of_week,is_open:found.is_open,open_time:found.open_time,close_time:found.close_time}
               : {day_of_week:i,is_open:i<5,open_time:"11:30",close_time:"22:00"};
});

const CUISINE_EMOJI = {
  "Américain":"🍔","Americain":"🍔","American":"🍔",
  "Italien":"🍝","Italian":"🍝",
  "Japonais":"🍣","Japanese":"🍣",
  "Mexicain":"🌮","Mexican":"🌮",
  "Belge":"🧇",
  "Français":"🥐","French":"🥐",
  "Indien":"🍛","Indian":"🍛",
  "Chinois":"🥡","Chinese":"🥡",
  "Grec":"🥗","Greek":"🥗",
  "Libanais":"🧆","Healthy":"🥗","Végétarien":"🌿","Afro européen":"🌍","Africain":"🌍",
};

const orderTotal = (items) => (items||[]).reduce((s,i) => s + parseFloat(i.price||0) * (i.qty||i.quantity||1), 0);
// « 15€ », « 15,50 », « 3.20 » → nombre (null si vide ou illisible)
const parseMoney = (v) => { const n = parseFloat(String(v ?? "").replace(/[€\s]/g, "").replace(",", ".")); return isNaN(n) ? null : n; };
const EMPTY_ITEM = {name:"",category_id:"",price:"",description:"",image:null,imagePreview:null,photos:[],newPhotos:[],removedPhotos:[],options:[],cost_price:"",stock_qty:"",low_stock_threshold:"5",recipe:[],recipeOrig:"[]",
                    available_days:[],available_from:"",available_until:"",available_on:""};
const DAY_SHORT = ["L","M","M","J","V","S","D"];
// Coût matière d'une recette (lignes {ingredient, qty}) à partir de la liste des ingrédients
const recipeCost = (lines, ingredients) => lines.reduce((s,l)=>{ const ing=ingredients.find(i=>i.id===l.ingredient); return s + (ing?parseFloat(l.qty||0)*parseFloat(ing.unit_cost||0):0); },0);

const Sparkline = ({data,color}) => {
  const max=Math.max(...data),min=Math.min(...data),w=80,h=32;
  const pts=data.map((v,i)=>`${(i/(data.length-1))*w},${h-((v-min)/(max-min||1))*h}`).join(" ");
  return <svg width={w} height={h} style={{overflow:"visible"}}><polyline points={pts} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round"/><polyline points={`0,${h} ${pts} ${w},${h}`} fill={color} fillOpacity=".12" stroke="none"/></svg>;
};

/**
 * Nom, description, adresse, téléphone, e-mail de contact : modifiables par le restaurateur.
 * Mode plateforme : la cuisine et le statut restent gérés par l'administration.
 * Mode mono-restaurant (`single`) : la cuisine se modifie ici aussi (elle n'est plus réservée à l'éditeur).
 */
function ProfileForm({restaurant,setRestaurant,showToast,email,single=false,platformName="PickEatGo"}){
  const toList=(c)=>Array.isArray(c)?c:(c?[c]:[]);
  const [f,setF]=useState({name:restaurant.name||"",description:restaurant.description||"",address:restaurant.address||"",city:restaurant.city||"",phone:restaurant.phone||"",email:restaurant.email||"",cuisine:toList(restaurant.cuisine)});
  const [saving,setSaving]=useState(false);
  const dirty=["name","description","address","city","phone","email"].some(k=>(f[k]||"")!==(restaurant[k]||""))||(single&&JSON.stringify(f.cuisine)!==JSON.stringify(toList(restaurant.cuisine)));
  const toggleCuisine=(c)=>setF(p=>({...p,cuisine:p.cuisine.includes(c)?p.cuisine.filter(x=>x!==c):[...p.cuisine,c]}));
  const save=async()=>{
    if(!f.name.trim()){showToast("Le nom est obligatoire","error");return;}
    setSaving(true);
    try{
      const body={name:f.name.trim(),description:f.description,address:f.address,city:f.city,phone:f.phone,email:f.email.trim()};
      if(single) body.cuisine=f.cuisine;
      const r=await patch(`/restaurants/${restaurant.id}/`,body);
      setRestaurant(p=>({...p,name:r.name,description:r.description,address:r.address,city:r.city,phone:r.phone,email:r.email,cuisine:r.cuisine}));
      showToast("Profil enregistré ✓");
    }
    catch(e){showToast(e.message,"error");}
    finally{setSaving(false);}
  };
  return (<>
    <div className="sf">
      <div><label className="fl">Nom</label><input className="fi" value={f.name} onChange={e=>setF(p=>({...p,name:e.target.value}))}/></div>
      <div><label className="fl">Description</label><textarea className="fi" rows={3} value={f.description} onChange={e=>setF(p=>({...p,description:e.target.value}))} placeholder="Quelques mots sur votre cuisine…"/></div>
      <div><label className="fl">Adresse</label><input className="fi" value={f.address} onChange={e=>setF(p=>({...p,address:e.target.value}))}/></div>
      <div><label className="fl">Ville</label><input className="fi" value={f.city} onChange={e=>setF(p=>({...p,city:e.target.value}))}/></div>
      <div><label className="fl">Téléphone</label><input className="fi" type="tel" value={f.phone} onChange={e=>setF(p=>({...p,phone:e.target.value}))}/></div>
      <div><label className="fl">E-mail de contact (affiché aux clients)</label><input className="fi" type="email" value={f.email} placeholder="contact@monrestaurant.be" onChange={e=>setF(p=>({...p,email:e.target.value}))}/></div>
      {single ? (
        <div><label className="fl">Cuisine {f.cuisine.length>0&&<span style={{color:"#FF6B2C",fontWeight:700,textTransform:"none",letterSpacing:0}}>({f.cuisine.length} sélectionnée{f.cuisine.length>1?"s":""})</span>}</label>
          <div style={{display:"flex",flexWrap:"wrap",gap:6,padding:10,border:"1.5px solid var(--border)",borderRadius:10,maxHeight:160,overflowY:"auto",background:"#fff"}}>
            {CUISINES.map(c=><button key={c} type="button" onClick={()=>toggleCuisine(c)} style={{fontSize:12,fontWeight:f.cuisine.includes(c)?700:500,padding:"5px 10px",borderRadius:20,border:"1.5px solid",borderColor:f.cuisine.includes(c)?"#FF6B2C":"var(--border)",background:f.cuisine.includes(c)?"#FF6B2C":"#F8FAFC",color:f.cuisine.includes(c)?"#fff":"#475569",cursor:"pointer",fontFamily:"inherit"}}>{c}</button>)}
          </div></div>
      ) : (
        <div><label className="fl">Cuisine</label><input className="fi" readOnly value={toList(restaurant.cuisine).join(", ")} style={{background:"#F8FAFC",color:"#64748B"}}/></div>
      )}
      <div><label className="fl">Email du compte</label><input className="fi" readOnly value={email||""} style={{background:"#F8FAFC",color:"#64748B"}}/></div>
    </div>
    <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:10,marginTop:12,flexWrap:"wrap"}}>
      <p style={{fontSize:12,color:"#94A3B8"}}>{single?`Pour changer l'e-mail du compte, contactez l'éditeur (${platformName}).`:"Pour changer la cuisine ou l'e-mail du compte, contactez l'équipe PickEatGo."}</p>
      <button className="btn-primary" disabled={saving||!dirty} onClick={save} style={{opacity:dirty?1:.5}}>{saving?"Enregistrement…":"Enregistrer"}</button>
    </div>
  </>);
}

/** Date et heure du bandeau : composant isolé, seul lui se re-rend chaque seconde. */
function TopbarClock(){
  const [now,setNow]=useState(new Date());
  useEffect(()=>{const t=setInterval(()=>setNow(new Date()),1000);return()=>clearInterval(t);},[]);
  return <p className="page-sub">{now.toLocaleDateString("fr-BE",{weekday:"long",day:"numeric",month:"long"})} · {now.toLocaleTimeString("fr-BE",{hour:"2-digit",minute:"2-digit"})}</p>;
}
/** Bouton d'état « Ouvert · ferme à 22:00 » : recalculé chaque minute selon les horaires et l'interrupteur. */
function OpenStateButton({hours,isOpen,onToggle}){
  const [now,setNow]=useState(localNow());
  useEffect(()=>{const t=setInterval(()=>setNow(localNow()),60*1000);return()=>clearInterval(t);},[]);
  const st=openState(hours,isOpen,now); const col=st.open?"#16A34A":isOpen?"#D97706":"#DC2626", bg=st.open?"#DCFCE7":isOpen?"#FEF3C7":"#FEE2E2";
  return <button className="topbar-state" onClick={onToggle} title={isOpen?"Interrupteur : ouvert. Cliquez pour suspendre les commandes.":"Interrupteur : fermé. Cliquez pour accepter les commandes."} style={{display:"flex",alignItems:"center",gap:8,padding:"8px 14px",borderRadius:20,border:"none",cursor:"pointer",background:bg,color:col,fontWeight:700,fontSize:13,fontFamily:"'Instrument Sans',sans-serif"}}>
    <span style={{width:8,height:8,borderRadius:"50%",background:col,display:"inline-block"}}/>{st.label}
  </button>;
}

function StaffPinModal({restaurant,employees,purpose="enter",onClose,onConfirm}) {
  const [pin,setPin]=useState(""); const [err,setErr]=useState(""); const [busy,setBusy]=useState(false);
  const eligible=employees.filter(e=>e.is_active&&(purpose!=="exit"||e.role==="gerant"));
  const check=async(code)=>{
    setBusy(true);
    try{ const r=await post("/restaurants/employees/unlock/",{restaurant:restaurant.id,pin:code,purpose}); onConfirm(r.employee); }
    catch(e){ if(code.length<6){ setErr("Code incorrect — continuez si votre code est plus long"); } else { setErr(e.message||"Code incorrect"); setPin(""); } }
    finally{setBusy(false);}
  };
  return (
    <div className="modal-ov" onClick={onClose}>
      <div className="pin-modal" onClick={e=>e.stopPropagation()}>
        <h3 className="pin-title">{purpose==="exit"?"Quitter le mode caissier":"Accès caissier"}</h3>
        {eligible.length===0 ? (
          <>
            <p className="pin-sub">{purpose==="exit"?"Aucun gérant n'est défini : la sortie n'est pas verrouillée.":"Aucun employé n'a encore de code PIN. Vous pouvez entrer directement, ou créer votre équipe dans Paramètres → Équipe & codes PIN pour savoir qui encaisse."}</p>
            <button className="btn-primary" style={{width:"100%",justifyContent:"center"}} onClick={()=>onConfirm(null)}>{purpose==="exit"?"Quitter":"Entrer sans code"}</button>
          </>
        ) : (
          <>
            <p className="pin-sub">{purpose==="exit"?"Code PIN d'un gérant":"Entrez votre code PIN personnel"}</p>
            <div className="pin-display" style={err?{color:"#DC2626",background:"#FEF2F2"}:{}}>{"●".repeat(pin.length).padEnd(4,"·")}</div>
            <div className="pin-grid">
              {[1,2,3,4,5,6,7,8,9,"✕",0,"←"].map((k,i)=>(
                <button key={i} className="pin-key" disabled={busy} onClick={()=>{
                  setErr("");
                  if(k==="✕")setPin("");
                  else if(k==="←")setPin(p=>p.slice(0,-1));
                  else if(pin.length<6){const np=pin+k;setPin(np);if(np.length>=4)check(np);}
                }}>{k}</button>
              ))}
            </div>
            <p className="pin-hint" style={err?{color:"#DC2626",fontWeight:700}:{}}>{err||(busy?"Vérification…":`${eligible.length} membre(s) de l'équipe`)}</p>
          </>
        )}
      </div>
    </div>
  );
}

function StaffView({orders,onAdvance,onExit,onCounterSale,onPrint,restaurantName,staffUser}) {
  const [liveTime,setLiveTime]=useState(new Date());
  useEffect(()=>{const t=setInterval(()=>setLiveTime(new Date()),1000);return()=>clearInterval(t);},[]);
  const newO=orders.filter(o=>o.status==="nouvelle");
  const inProg=orders.filter(o=>["confirmee","en_cuisine"].includes(o.status));
  const ready=orders.filter(o=>["prete","en_livraison"].includes(o.status));
  const cols=[
    {title:"🔔 Nouvelles",orders:newO,bg:"#EFF6FF",color:"#2563EB",label:"Confirmer"},
    {title:"👨‍🍳 En cours",orders:inProg,bg:"#F5F3FF",color:"#7C3AED",label:null},
    {title:"✅ Prêtes / en livraison",orders:ready,bg:"#ECFDF5",color:"#059669",label:null},
  ];
  return (
    <div className="staff-wrap">
      <div className="staff-topbar">
        <div><h1 className="staff-title">🍔 {restaurantName||"Dashboard"}</h1><p className="staff-time">{liveTime.toLocaleTimeString("fr-BE",{hour:"2-digit",minute:"2-digit",second:"2-digit"})}{staffUser&&<> · 👤 <strong style={{color:"#fff"}}>{staffUser.name}</strong> ({staffUser.role_display||staffUser.role})</>}</p></div>
        <div style={{display:"flex",gap:8,flexWrap:"wrap",justifyContent:"flex-end"}}>
          <button className="staff-exit-btn" style={{background:"var(--primary)",borderColor:"var(--primary)"}} onClick={onCounterSale}>🧾 Encaisser une vente</button>
          <button className="staff-exit-btn" onClick={onExit}>✕ Quitter</button>
        </div>
      </div>
      <div className="staff-grid">
        {cols.map(col=>(
          <div key={col.title} className="staff-col">
            <div className="staff-col-header" style={{background:col.bg,color:col.color}}>
              <span>{col.title}</span><span className="staff-col-count">{col.orders.length}</span>
            </div>
            {col.orders.map(o=>{
              const sc=STATUS_CONFIG[o.status]||STATUS_CONFIG.nouvelle;
              const items=o.items||o.order_items||[];
              return (
                <div key={o.id} className="staff-card" style={{borderTop:`3px solid ${sc.color}`}}>
                  <div className="staff-card-header">
                    <span className="staff-order-id">#{o.number||o.id}</span>
                    <span className="staff-client">{o.client_name||"Client"}</span>
                    <span className="staff-time-badge">⏱ {o.pickup_slot||"—"}</span>
                  </div>
                  <div className="staff-items">
                    {items.map((item,i)=><p key={i} className="staff-item"><span className="staff-qty">{item.qty||1}×</span> {item.name||item.item_name}</p>)}
                  </div>
                  {o.delivery_address&&<div className="staff-note">🛵 {o.delivery_address}</div>}
                  {o.note&&<div className="staff-note">📝 {o.note}</div>}
                  <div className="staff-meta">
                    <span className="staff-type">{TYPE_LABELS[o.order_type]||o.order_type}</span>
                    <span className="staff-total">{parseFloat(o.total_price||0).toFixed(2)} €</span>
                  </div>
                  <div style={{display:"flex",gap:8,alignItems:"center"}}>
                    {nextStep(o).next&&<button className="staff-advance-btn" style={{flex:1}} onClick={()=>onAdvance(o.id)}>{col.label||(o.status==="prete"&&o.order_type!=="livraison"?"Client récupéré":nextStep(o).nextLabel)} →</button>}
                    {onPrint&&<button className="staff-exit-btn" style={{padding:"9px 12px"}} title="Imprimer le ticket cuisine" onClick={()=>onPrint(o,"kitchen")}>🖨</button>}
                  </div>
                </div>
              );
            })}
            {col.orders.length===0&&<div className="staff-empty">Aucune commande</div>}
          </div>
        ))}
      </div>
    </div>
  );
}

function PlaceGalleryCard({restaurant,setRestaurant,showToast,onView}) {
  const [busy,setBusy]=useState(false);
  const [captionEdit,setCaptionEdit]=useState({});
  const gallery=restaurant.gallery||[];
  const apply=(r)=>setRestaurant(p=>({...p,gallery:r.restaurant.gallery,banner_url:r.restaurant.banner_url}));
  const addFiles=async(files)=>{
    const list=Array.from(files||[]).slice(0,Math.max(0,10-gallery.length));
    if(!list.length){showToast("Maximum 10 photos du restaurant","error");return;}
    setBusy(true);
    try{ let r; for(const f of list){ if(f.size>5*1024*1024){showToast(`${f.name} : trop grande (max 5 MB)`,"error");continue;} const fd=new FormData(); fd.append("image",f); r=await upload(`/restaurants/${restaurant.id}/photos/`,fd); } if(r) apply(r); showToast("Photo(s) ajoutée(s) ✓"); }
    catch(e){showToast(e.message,"error");} finally{setBusy(false);}
  };
  const remove=async(ph)=>{ if(!confirm("Retirer cette photo ?"))return; try{ apply(await del(`/restaurants/${restaurant.id}/photos/${ph.id}/`)); }catch(e){showToast(e.message,"error");} };
  const setBanner=async(ph)=>{ try{ apply(await post(`/restaurants/${restaurant.id}/photos/${ph.id}/`,{})); showToast("Bannière mise à jour ✓"); }catch(e){showToast(e.message,"error");} };
  const saveCaption=async(ph)=>{ const c=captionEdit[ph.id]; if(c===undefined||c===(ph.caption||""))return; try{ apply(await patch(`/restaurants/${restaurant.id}/photos/${ph.id}/`,{caption:c})); }catch(e){showToast(e.message,"error");} setCaptionEdit(t=>{const n={...t};delete n[ph.id];return n;}); };
  return (
    <>
      <div className="card-hd"><h3 className="card-title">📷 Photos du restaurant</h3>
        <label className="btn-primary" style={{padding:"8px 14px",fontSize:13,cursor:"pointer",opacity:busy?.6:1}}>{busy?"Envoi…":<><Ic n="plus" s={14} c="white"/> Photos</>}
          <input type="file" accept="image/jpeg,image/png,image/webp" multiple style={{display:"none"}} disabled={busy||gallery.length>=10} onChange={e=>{addFiles(e.target.files);e.target.value="";}}/></label></div>
      <p style={{fontSize:12,color:"#64748B",marginBottom:12}}>Façade, salle, terrasse, cuisine, équipe : jusqu'à 10 photos visibles sur votre page publique. La photo marquée 🖼 est la <strong>bannière</strong> (image de couverture en haut de votre page et sur l'accueil). {gallery.length} / 10.</p>
      {gallery.length===0&&<div className="empty-msg" style={{padding:16}}>Aucune photo du lieu. Ajoutez-en pour rassurer les clients qui ne vous connaissent pas encore.</div>}
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(150px,1fr))",gap:10}}>
        {gallery.map((ph,i)=>{const isBanner=restaurant.banner_url&&restaurant.banner_url===ph.url;return (
          <div key={ph.id} style={{border:"1.5px solid",borderColor:isBanner?"var(--primary)":"var(--border)",borderRadius:12,overflow:"hidden",background:"#fff"}}>
            <div style={{position:"relative",height:100}}>
              <img src={ph.url} alt="" style={{width:"100%",height:"100%",objectFit:"cover",cursor:"zoom-in"}} onClick={()=>onView(gallery.map(x=>({url:x.url,caption:x.caption||restaurant.name})),i)}/>
              {isBanner&&<span style={{position:"absolute",top:6,left:6,fontSize:10,fontWeight:800,background:"var(--primary)",color:"#fff",padding:"2px 7px",borderRadius:10}}>🖼 Bannière</span>}
              <div style={{position:"absolute",top:6,right:6,display:"flex",gap:4}}>
                {!isBanner&&<button className="icon-btn-sm" title="Définir comme bannière" style={{width:24,height:24}} onClick={()=>setBanner(ph)}>🖼</button>}
                <button className="icon-btn-sm red" title="Retirer" style={{width:24,height:24}} onClick={()=>remove(ph)}><Ic n="x" s={11} c="#EF4444"/></button>
              </div>
            </div>
            <input className="fi" placeholder="Légende (Terrasse…)" style={{border:"none",borderTop:"1px solid var(--border)",borderRadius:0,fontSize:12,padding:"7px 10px"}}
              value={captionEdit[ph.id]??(ph.caption||"")} onChange={e=>setCaptionEdit(t=>({...t,[ph.id]:e.target.value}))} onBlur={()=>saveCaption(ph)} onKeyDown={e=>e.key==="Enter"&&e.target.blur()}/>
          </div>);})}
      </div>
    </>
  );
}

const DAY_LETTERS = ["L","M","M","J","V","S","D"];
function OrderModesCard({restaurant,setRestaurant,showToast}) {
  const [f,setF]=useState({
    allow_on_site:restaurant.allow_on_site!==false, allow_pickup:restaurant.allow_pickup!==false, allow_delivery:!!restaurant.allow_delivery,
    delivery_fee:String(restaurant.delivery_fee??"0"), delivery_min_order:String(restaurant.delivery_min_order??"0"),
    delivery_fee_mode:restaurant.delivery_fee_mode||"fixed", delivery_free_above:restaurant.delivery_free_above==null?"":String(restaurant.delivery_free_above),
    delivery_zones:(restaurant.delivery_zones||[]).map(z=>({label:z.label||"",postcodes:(z.postcodes||[]).join(", "),fee:String(z.fee??"0")})),
    delivery_days:restaurant.delivery_days||[], delivery_from:restaurant.delivery_from?String(restaurant.delivery_from).slice(0,5):"",
    delivery_until:restaurant.delivery_until?String(restaurant.delivery_until).slice(0,5):"", delivery_info:restaurant.delivery_info||"",
  });
  const [saving,setSaving]=useState(false);
  const num=(v)=>{const n=parseFloat(String(v).replace(",","."));return isNaN(n)?0:n;};
  const save=async()=>{
    if(!f.allow_on_site&&!f.allow_pickup&&!f.allow_delivery){showToast("Gardez au moins un mode de commande actif","error");return;}
    setSaving(true);
    try{
      if(f.allow_delivery&&f.delivery_fee_mode==="zones"&&f.delivery_zones.filter(z=>z.postcodes.trim()).length===0){showToast("Ajoutez au moins une zone avec ses codes postaux","error");setSaving(false);return;}
      const body={allow_on_site:f.allow_on_site,allow_pickup:f.allow_pickup,allow_delivery:f.allow_delivery,
        delivery_fee:num(f.delivery_fee),delivery_min_order:num(f.delivery_min_order),delivery_days:f.delivery_days,
        delivery_fee_mode:f.delivery_fee_mode,delivery_free_above:f.delivery_free_above===""?null:num(f.delivery_free_above),
        delivery_zones:f.delivery_zones.filter(z=>z.postcodes.trim()).map(z=>({label:z.label,postcodes:z.postcodes,fee:num(z.fee)})),
        delivery_from:f.delivery_from||null,delivery_until:f.delivery_until||null,delivery_info:f.delivery_info};
      const r=await patch(`/restaurants/${restaurant.id}/`,body); setRestaurant(p=>({...p,...body,delivery_schedule_label:r.delivery_schedule_label}));
      showToast("Modes de commande enregistrés ✓");
    }catch(e){showToast(e.message,"error");} finally{setSaving(false);}
  };
  const Toggle=({k,icon,label,sub})=>(
    <label style={{display:"flex",alignItems:"center",gap:12,padding:"10px 12px",border:"1.5px solid",borderColor:f[k]?"#FED7AA":"var(--border)",background:f[k]?"#FFF7ED":"#fff",borderRadius:12,cursor:"pointer"}}>
      <input type="checkbox" checked={f[k]} onChange={e=>setF(p=>({...p,[k]:e.target.checked}))} style={{width:18,height:18,accentColor:"#FF6B2C"}}/>
      <span style={{fontSize:20}}>{icon}</span>
      <span style={{flex:1}}><span style={{fontWeight:700,fontSize:14,display:"block"}}>{label}</span><span style={{fontSize:12,color:"#64748B"}}>{sub}</span></span>
    </label>
  );
  return (
    <>
      <div className="card-hd"><h3 className="card-title">Modes de commande</h3></div>
      <p style={{fontSize:12,color:"#64748B",marginBottom:12}}>Ce que le client peut choisir dans son panier. Décochez ce que vous ne proposez pas.</p>
      <div style={{display:"flex",flexDirection:"column",gap:8}}>
        <Toggle k="allow_on_site" icon="🪑" label="Sur place" sub="Le client mange au restaurant"/>
        <Toggle k="allow_pickup" icon="🥡" label="À emporter" sub="Le client vient chercher sa commande"/>
        <Toggle k="allow_delivery" icon="🛵" label="Livraison" sub="Vous livrez à l'adresse du client"/>
      </div>
      {f.allow_delivery&&(
        <div style={{marginTop:14,padding:"12px 14px",background:"var(--bg)",borderRadius:12}}>
          <p style={{fontWeight:700,fontSize:13,marginBottom:10}}>Frais de livraison</p>
          <div style={{display:"flex",gap:6,marginBottom:10}}>
            {[["fixed","Montant fixe"],["zones","Par zone (code postal)"]].map(([k,l])=><button key={k} className={`mini-tab ${f.delivery_fee_mode===k?"active":""}`} style={{background:f.delivery_fee_mode===k?"#fff":"transparent",border:"1.5px solid",borderColor:f.delivery_fee_mode===k?"var(--primary)":"var(--border)"}} onClick={()=>setF(p=>({...p,delivery_fee_mode:k}))}>{l}</button>)}
          </div>
          {f.delivery_fee_mode==="fixed" ? (
            <div className="form-3col" style={{gridTemplateColumns:"1fr 1fr"}}>
              <div><label className="fl">Frais (€)</label><input className="fi" type="text" inputMode="decimal" value={f.delivery_fee} onChange={e=>setF(p=>({...p,delivery_fee:e.target.value}))}/></div>
              <div><label className="fl">Offerts à partir de (€)</label><input className="fi" type="text" inputMode="decimal" placeholder="jamais" value={f.delivery_free_above} onChange={e=>setF(p=>({...p,delivery_free_above:e.target.value}))}/></div>
            </div>
          ) : (
            <div>
              {f.delivery_zones.map((z,i)=>(
                <div key={i} style={{display:"grid",gridTemplateColumns:"1fr 1.4fr 80px 30px",gap:6,marginBottom:6,alignItems:"center"}}>
                  <input className="fi" placeholder="Nom (Centre…)" value={z.label} onChange={e=>setF(p=>({...p,delivery_zones:p.delivery_zones.map((x,j)=>j===i?{...x,label:e.target.value}:x)}))}/>
                  <input className="fi" placeholder="Codes postaux : 1000, 1050" value={z.postcodes} onChange={e=>setF(p=>({...p,delivery_zones:p.delivery_zones.map((x,j)=>j===i?{...x,postcodes:e.target.value}:x)}))}/>
                  <input className="fi" type="text" inputMode="decimal" placeholder="€" value={z.fee} onChange={e=>setF(p=>({...p,delivery_zones:p.delivery_zones.map((x,j)=>j===i?{...x,fee:e.target.value}:x)}))}/>
                  <button className="icon-btn-sm red" onClick={()=>setF(p=>({...p,delivery_zones:p.delivery_zones.filter((_,j)=>j!==i)}))}><Ic n="x" s={11} c="#EF4444"/></button>
                </div>
              ))}
              <button className="pill-btn" onClick={()=>setF(p=>({...p,delivery_zones:[...p.delivery_zones,{label:"",postcodes:"",fee:""}]}))}>+ Zone</button>
              <div style={{marginTop:8}}><label className="fl">Offerts à partir de (€)</label><input className="fi" type="text" inputMode="decimal" placeholder="jamais" value={f.delivery_free_above} onChange={e=>setF(p=>({...p,delivery_free_above:e.target.value}))}/></div>
              <p style={{fontSize:11,color:"#94A3B8",marginTop:6}}>Un code postal absent de toutes les zones n'est pas livré : le client en est informé avant de commander.</p>
            </div>
          )}
          <div style={{marginTop:10}}><label className="fl">Commande minimum (€)</label><input className="fi" type="text" inputMode="decimal" value={f.delivery_min_order} onChange={e=>setF(p=>({...p,delivery_min_order:e.target.value}))}/></div>
          <p style={{fontWeight:700,fontSize:13,margin:"14px 0 6px"}}>Créneaux de livraison</p>
          <div style={{display:"flex",gap:6,flexWrap:"wrap",alignItems:"center",margin:"10px 0"}}>
            <span style={{fontSize:12,color:"var(--text-soft)",marginRight:4}}>Jours :</span>
            {DAY_LETTERS.map((d,i)=>{const on=f.delivery_days.includes(i);return (
              <button key={i} type="button" onClick={()=>setF(p=>({...p,delivery_days:on?p.delivery_days.filter(x=>x!==i):[...p.delivery_days,i].sort()}))}
                style={{width:34,height:34,borderRadius:"50%",border:"1.5px solid",borderColor:on?"#FF6B2C":"var(--border)",background:on?"#FF6B2C":"#fff",color:on?"#fff":"var(--text-soft)",fontWeight:800,fontSize:13,cursor:"pointer",fontFamily:"inherit"}}>{d}</button>);})}
            <span style={{fontSize:11,color:"#94A3B8"}}>{f.delivery_days.length===0?"tous les jours":""}</span>
          </div>
          <div className="form-3col" style={{gridTemplateColumns:"1fr 1fr"}}>
            <div><label className="fl">De</label><input className="fi" type="time" value={f.delivery_from} onChange={e=>setF(p=>({...p,delivery_from:e.target.value}))}/></div>
            <div><label className="fl">À</label><input className="fi" type="time" value={f.delivery_until} onChange={e=>setF(p=>({...p,delivery_until:e.target.value}))}/></div>
          </div>
          <div style={{marginTop:10}}><label className="fl">Informations pour le client</label><input className="fi" placeholder="Ex. Bruxelles centre uniquement, délai 30 à 45 min" value={f.delivery_info} onChange={e=>setF(p=>({...p,delivery_info:e.target.value}))}/></div>
          <p style={{fontSize:11,color:"#94A3B8",marginTop:6}}>Heures vides = aux heures d'ouverture. Le client ne peut choisir une heure de livraison que dans ce créneau.</p>
        </div>
      )}
      <button className="btn-primary" style={{width:"100%",marginTop:12,justifyContent:"center"}} disabled={saving} onClick={save}>{saving?"…":<><Ic n="check" s={14} c="white"/> Enregistrer</>}</button>
    </>
  );
}

function MarketingCard({restaurant,setRestaurant,showToast}) {
  const [loy,setLoy]=useState({loyalty_enabled:!!restaurant.loyalty_enabled,loyalty_target:String(restaurant.loyalty_target??10),loyalty_reward_type:restaurant.loyalty_reward_type||"percent",loyalty_reward_value:String(restaurant.loyalty_reward_value??10)});
  const [savingLoy,setSavingLoy]=useState(false);
  const [promos,setPromos]=useState([]);
  const [form,setForm]=useState(null);
  const [saving,setSaving]=useState(false);
  const load=useCallback(async()=>{ try{ const d=await get(`/orders/promos/?restaurant=${restaurant.id}`); setPromos(d.results||[]); }catch{} },[restaurant]);
  useEffect(()=>{load();},[load]);
  const saveLoy=async()=>{
    setSavingLoy(true);
    try{
      const body={loyalty_enabled:loy.loyalty_enabled,loyalty_target:Math.max(2,parseInt(loy.loyalty_target)||10),loyalty_reward_type:loy.loyalty_reward_type,loyalty_reward_value:parseFloat(String(loy.loyalty_reward_value).replace(",","."))||0};
      const r=await patch(`/restaurants/${restaurant.id}/`,body); setRestaurant(p=>({...p,...body})); showToast("Programme de fidélité enregistré ✓");
    }catch(e){showToast(e.message,"error");} finally{setSavingLoy(false);}
  };
  const savePromo=async()=>{
    if(!form.code.trim()||!form.value){showToast("Code et valeur requis","error");return;}
    setSaving(true);
    try{
      const body={code:form.code.trim().toUpperCase(),kind:form.kind,value:parseFloat(String(form.value).replace(",",".")),min_order:parseFloat(form.min_order||0)||0,starts_at:form.starts_at||null,ends_at:form.ends_at||null,max_uses:form.max_uses===""?null:parseInt(form.max_uses)};
      const r=form.id?await patch(`/orders/promos/${form.id}/`,body):await post("/orders/promos/",{...body,restaurant:restaurant.id});
      setPromos(p=>p.some(x=>x.id===r.id)?p.map(x=>x.id===r.id?r:x):[r,...p]); setForm(null); showToast("Code enregistré ✓");
    }catch(e){showToast(e.message,"error");} finally{setSaving(false);}
  };
  const toggle=async(pc)=>{ try{ const r=await patch(`/orders/promos/${pc.id}/`,{is_active:!pc.is_active}); setPromos(p=>p.map(x=>x.id===r.id?r:x)); }catch(e){showToast(e.message,"error");} };
  const remove=async(pc)=>{ if(!confirm(`Supprimer le code ${pc.code} ?`))return; try{ await del(`/orders/promos/${pc.id}/`); setPromos(p=>p.filter(x=>x.id!==pc.id)); }catch(e){showToast(e.message,"error");} };
  const fmt=(d)=>d?new Date(d+"T00:00:00").toLocaleDateString("fr-BE",{day:"2-digit",month:"2-digit"}):null;
  return (
    <>
      <div className="card-hd"><h3 className="card-title">🎁 Fidélité & codes promo</h3>
        <button className="btn-primary" style={{padding:"8px 14px",fontSize:13}} onClick={()=>setForm({code:"",kind:"percent",value:"",min_order:"",starts_at:"",ends_at:"",max_uses:""})}><Ic n="plus" s={14} c="white"/> Code promo</button></div>
      <div className="grid2">
        <div style={{border:"1.5px solid var(--border)",borderRadius:12,padding:"12px 14px"}}>
          <label style={{display:"flex",alignItems:"center",gap:10,cursor:"pointer",fontWeight:700,fontSize:14}}>
            <input type="checkbox" checked={loy.loyalty_enabled} onChange={e=>setLoy(p=>({...p,loyalty_enabled:e.target.checked}))} style={{width:18,height:18,accentColor:"#FF6B2C"}}/> Programme de fidélité
          </label>
          <p style={{fontSize:12,color:"#64748B",margin:"6px 0 10px"}}>Après <strong>{loy.loyalty_target||"N"}</strong> commandes récupérées, la suivante bénéficie automatiquement de la récompense. Le client voit sa carte dans son panier.</p>
          <div className="form-3col">
            <div><label className="fl">Commandes</label><input className="fi" type="text" inputMode="numeric" min={2} value={loy.loyalty_target} onChange={e=>setLoy(p=>({...p,loyalty_target:e.target.value}))}/></div>
            <div><label className="fl">Récompense</label><select className="fi" value={loy.loyalty_reward_type} onChange={e=>setLoy(p=>({...p,loyalty_reward_type:e.target.value}))}><option value="percent">% de remise</option><option value="amount">€ de remise</option></select></div>
            <div><label className="fl">Valeur</label><input className="fi" type="text" inputMode="decimal" min={0} value={loy.loyalty_reward_value} onChange={e=>setLoy(p=>({...p,loyalty_reward_value:e.target.value}))}/></div>
          </div>
          <button className="btn-primary" style={{width:"100%",marginTop:10,justifyContent:"center"}} disabled={savingLoy} onClick={saveLoy}>{savingLoy?"…":<><Ic n="check" s={14} c="white"/> Enregistrer</>}</button>
        </div>
        <div>
          {promos.length===0&&<div className="empty-msg" style={{padding:16}}>Aucun code promo. Créez-en un pour vos habitués, un lancement, une heure creuse…</div>}
          <div style={{display:"flex",flexDirection:"column",gap:8}}>
            {promos.map(pc=>(
              <div key={pc.id} style={{display:"flex",alignItems:"center",gap:10,padding:"8px 12px",border:"1.5px solid var(--border)",borderRadius:10,opacity:pc.is_active?1:.55}}>
                <div style={{flex:1,minWidth:0}}>
                  <p style={{fontWeight:800,fontSize:13,letterSpacing:.5}}>{pc.code} <span className="status-badge" style={{background:"#FFF0E8",color:"#FF6B2C",marginLeft:4}}>{pc.label}</span></p>
                  <p style={{fontSize:11,color:"var(--text-soft)"}}>{pc.uses} utilisation(s){pc.max_uses?` / ${pc.max_uses}`:""}{parseFloat(pc.min_order)>0?` · dès ${money(pc.min_order)}`:""}{pc.starts_at||pc.ends_at?` · ${fmt(pc.starts_at)||"…"} → ${fmt(pc.ends_at)||"…"}`:""}{!pc.is_active?" · désactivé":""}</p>
                </div>
                <button className="icon-btn-sm" onClick={()=>setForm({id:pc.id,code:pc.code,kind:pc.kind,value:String(pc.value),min_order:String(pc.min_order||""),starts_at:pc.starts_at||"",ends_at:pc.ends_at||"",max_uses:pc.max_uses==null?"":String(pc.max_uses)})}><Ic n="edit" s={13} c="#6366F1"/></button>
                <button className="icon-btn-sm" title={pc.is_active?"Désactiver":"Réactiver"} onClick={()=>toggle(pc)}><Ic n={pc.is_active?"lock":"check"} s={13} c={pc.is_active?"#64748B":"#16A34A"}/></button>
                <button className="icon-btn-sm red" onClick={()=>remove(pc)}><Ic n="trash" s={13} c="#EF4444"/></button>
              </div>
            ))}
          </div>
        </div>
      </div>
      {form&&(
        <div className="modal-ov" onClick={()=>setForm(null)}>
          <div className="pin-modal" style={{textAlign:"left",maxWidth:420}} onClick={e=>e.stopPropagation()}>
            <h3 className="pin-title">{form.id?"Modifier le code":"Nouveau code promo"}</h3>
            <div className="sf" style={{marginTop:12}}>
              <div><label className="fl">Code *</label><input className="fi" autoFocus placeholder="BIENVENUE10" value={form.code} disabled={!!form.id} onChange={e=>setForm(p=>({...p,code:e.target.value.toUpperCase()}))} style={{textTransform:"uppercase",fontWeight:800,letterSpacing:1}}/></div>
              <div className="form-3col">
                <div><label className="fl">Type</label><select className="fi" value={form.kind} onChange={e=>setForm(p=>({...p,kind:e.target.value}))}><option value="percent">% de remise</option><option value="amount">€ de remise</option></select></div>
                <div><label className="fl">Valeur *</label><input className="fi" type="text" inputMode="decimal" min={0} value={form.value} onChange={e=>setForm(p=>({...p,value:e.target.value}))}/></div>
                <div><label className="fl">Panier min. (€)</label><input className="fi" type="text" inputMode="decimal" min={0} placeholder="0" value={form.min_order} onChange={e=>setForm(p=>({...p,min_order:e.target.value}))}/></div>
              </div>
              <div className="form-3col">
                <div><label className="fl">Du</label><input className="fi" type="date" value={form.starts_at} onChange={e=>setForm(p=>({...p,starts_at:e.target.value}))}/></div>
                <div><label className="fl">Au</label><input className="fi" type="date" value={form.ends_at} onChange={e=>setForm(p=>({...p,ends_at:e.target.value}))}/></div>
                <div><label className="fl">Utilisations max</label><input className="fi" type="text" inputMode="numeric" min={1} placeholder="∞" value={form.max_uses} onChange={e=>setForm(p=>({...p,max_uses:e.target.value}))}/></div>
              </div>
              <p style={{fontSize:11,color:"#94A3B8"}}>Le client saisit le code dans son panier ; vous pouvez aussi l'appliquer au comptoir. Non cumulable avec la récompense fidélité.</p>
            </div>
            <div style={{display:"flex",gap:10,marginTop:16}}>
              <button className="btn-secondary" style={{flex:1}} onClick={()=>setForm(null)}>Annuler</button>
              <button className="btn-primary" style={{flex:2,justifyContent:"center"}} disabled={saving} onClick={savePromo}>{saving?"…":"Enregistrer"}</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

const ROLE_LABELS={caissier:"Caissier",cuisine:"Cuisine",gerant:"Gérant"};
const ROLE_COLORS={caissier:"#3B82F6",cuisine:"#8B5CF6",gerant:"#F59E0B"};
function TeamCard({restaurant,employees,setEmployees,showToast}) {
  const [form,setForm]=useState(null);       // {id?,name,role,pin}
  const [saving,setSaving]=useState(false);
  const submit=async()=>{
    if(!form.name.trim()){showToast("Le nom est requis","error");return;}
    if(!form.id&&!/^\d{4,6}$/.test(form.pin)){showToast("Code PIN : 4 à 6 chiffres","error");return;}
    if(form.id&&form.pin&&!/^\d{4,6}$/.test(form.pin)){showToast("Code PIN : 4 à 6 chiffres","error");return;}
    setSaving(true);
    try{
      const body={name:form.name.trim(),role:form.role}; if(form.pin) body.pin=form.pin;
      const r=form.id?await patch(`/restaurants/employees/${form.id}/`,body):await post("/restaurants/employees/",{...body,restaurant:restaurant.id});
      setEmployees(p=>p.some(e=>e.id===r.id)?p.map(e=>e.id===r.id?r:e):[...p,r]);
      showToast(form.id?"Membre modifié ✓":"Membre ajouté ✓"); setForm(null);
    }catch(e){showToast(e.message,"error");}
    finally{setSaving(false);}
  };
  const toggle=async(e)=>{
    try{ const r=await patch(`/restaurants/employees/${e.id}/`,{is_active:!e.is_active}); setEmployees(p=>p.map(x=>x.id===r.id?r:x)); }
    catch(err){showToast(err.message,"error");}
  };
  const remove=async(e)=>{
    if(!confirm(`Supprimer ${e.name} de l'équipe ?`))return;
    try{ await del(`/restaurants/employees/${e.id}/`); setEmployees(p=>p.filter(x=>x.id!==e.id)); showToast("Membre supprimé"); }
    catch(err){showToast(err.message,"error");}
  };
  const managers=employees.filter(e=>e.is_active&&e.role==="gerant").length;
  return (
    <>
      <div className="card-hd">
        <h3 className="card-title">Équipe & codes PIN</h3>
        <button className="btn-primary" style={{padding:"8px 14px",fontSize:13}} onClick={()=>setForm({name:"",role:"caissier",pin:""})}><Ic n="plus" s={14} c="white"/> Membre</button>
      </div>
      <p style={{fontSize:12,color:"#64748B",marginBottom:14}}>
        Chaque membre entre son code PIN personnel pour ouvrir le mode caissier sur la tablette : les ventes et remises de commandes sont enregistrées à son nom (visible dans Ventes).
        {managers>0
          ? <> Sortir du mode caissier demande le code d'un <strong>gérant</strong> : le reste du tableau de bord est protégé.</>
          : <> Ajoutez un <strong>gérant</strong> pour verrouiller la sortie du mode caissier (sinon n'importe qui peut revenir au tableau de bord).</>}
      </p>
      {employees.length===0&&<div className="empty-msg" style={{padding:16}}>Aucun membre. Sans équipe, le mode caissier s'ouvre sans code.</div>}
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(240px,1fr))",gap:10}}>
        {employees.map(e=>(
          <div key={e.id} style={{display:"flex",alignItems:"center",gap:10,padding:"10px 12px",border:"1.5px solid var(--border)",borderRadius:12,opacity:e.is_active?1:.55}}>
            <div style={{width:36,height:36,borderRadius:10,background:ROLE_COLORS[e.role]+"22",color:ROLE_COLORS[e.role],display:"flex",alignItems:"center",justifyContent:"center",fontWeight:800,flexShrink:0}}>{e.name[0]?.toUpperCase()}</div>
            <div style={{flex:1,minWidth:0}}>
              <p style={{fontWeight:700,fontSize:13,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{e.name}</p>
              <p style={{fontSize:11,color:"var(--text-soft)"}}><span className="status-badge" style={{background:ROLE_COLORS[e.role]+"18",color:ROLE_COLORS[e.role],padding:"1px 7px"}}>{ROLE_LABELS[e.role]}</span>{!e.is_active&&" · désactivé"}{e.last_login_at&&e.is_active&&` · vu ${new Date(e.last_login_at).toLocaleDateString("fr-BE",{day:"2-digit",month:"2-digit"})}`}</p>
            </div>
            <button className="icon-btn-sm" title="Modifier / changer le PIN" onClick={()=>setForm({id:e.id,name:e.name,role:e.role,pin:""})}><Ic n="edit" s={13} c="#6366F1"/></button>
            <button className="icon-btn-sm" title={e.is_active?"Désactiver":"Réactiver"} onClick={()=>toggle(e)}><Ic n={e.is_active?"lock":"check"} s={13} c={e.is_active?"#64748B":"#16A34A"}/></button>
            <button className="icon-btn-sm red" onClick={()=>remove(e)}><Ic n="trash" s={13} c="#EF4444"/></button>
          </div>
        ))}
      </div>
      {form&&(
        <div className="modal-ov" onClick={()=>setForm(null)}>
          <div className="pin-modal" style={{textAlign:"left",maxWidth:400}} onClick={e=>e.stopPropagation()}>
            <h3 className="pin-title">{form.id?"Modifier le membre":"Nouveau membre"}</h3>
            <p className="pin-sub">Le code PIN est personnel et haché : vous ne pourrez pas le relire, seulement le remplacer.</p>
            <div className="sf">
              <div><label className="fl">Prénom / nom *</label><input className="fi" autoFocus value={form.name} onChange={e=>setForm(p=>({...p,name:e.target.value}))} placeholder="Sarah"/></div>
              <div><label className="fl">Rôle</label>
                <select className="fi" value={form.role} onChange={e=>setForm(p=>({...p,role:e.target.value}))}>
                  {Object.entries(ROLE_LABELS).map(([k,l])=><option key={k} value={k}>{l}</option>)}
                </select>
                <p style={{fontSize:11,color:"#94A3B8",marginTop:4}}>Le gérant peut aussi déverrouiller la sortie du mode caissier.</p></div>
              <div><label className="fl">{form.id?"Nouveau code PIN (laisser vide pour conserver)":"Code PIN * (4 à 6 chiffres)"}</label>
                <input className="fi" type="password" inputMode="numeric" maxLength={6} value={form.pin} onChange={e=>setForm(p=>({...p,pin:e.target.value.replace(/\D/g,"")}))} placeholder="••••" style={{letterSpacing:6,fontWeight:800}}/></div>
            </div>
            <div style={{display:"flex",gap:10,marginTop:16}}>
              <button className="btn-secondary" style={{flex:1}} onClick={()=>setForm(null)}>Annuler</button>
              <button className="btn-primary" style={{flex:2,justifyContent:"center"}} disabled={saving} onClick={submit}>{saving?"…":"Enregistrer"}</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export default function RestaurantDashboard() {
  const {user} = useAuth();
  const brandCtx = useBrand();                 // édition Marque Blanche : mode single → carte « Mon application »
  const single = brandCtx.single;
  const [page,setPage]               = useState("dashboard");
  useHistoryPage(page, setPage, { home: "dashboard", pages: ["dashboard","orders","menu","stock","sales","customers","settings"] });   // bouton Retour du téléphone = écran précédent ; rechargement = même écran
  const [restaurant,setRestaurant]   = useState(null);
  const [orders,setOrders]           = useState([]);
  const [menu,setMenu]               = useState([]);
  const [categories,setCategories]   = useState([]);
  const [loading,setLoading]         = useState(true);
  const [orderFilter,setOrderFilter] = useState("active");
  const [showModal,setShowModal]     = useState(false);
  const [editItem,setEditItem]       = useState(null);
  const [formItem,setFormItem]       = useState(EMPTY_ITEM);
  const [newOption,setNewOption]     = useState({label:"",extra_price:""});
  const [newLine,setNewLine]         = useState({ingredient:"",qty:""});
  const [ingredients,setIngredients] = useState([]);
  const [suppliers,setSuppliers]     = useState([]);
  const [stockSection,setStockSection] = useState("dishes");
  const [photoUploading,setPhotoUploading] = useState(false);
  const [lightbox,setLightbox]             = useState(null);
  const [photoDragOver,setPhotoDragOver]   = useState(false);
  const [sidebarOpen,setSidebarOpen] = useState(true);
  const [showStaffPin,setShowStaffPin] = useState(false);   // false | "enter" | "exit"
  const [staffMode,setStaffMode]     = useState(false);
  const [staffUser,setStaffUser]     = useState(null);      // employé identifié par PIN
  // Le mode caissier survit à un rechargement (tablette au comptoir) : la sortie demande toujours le PIN gérant
  useEffect(()=>{ try{ const s=JSON.parse(sessionStorage.getItem("pickeatgo_staff")||"null"); if(s&&s.on){ setStaffMode(true); setStaffUser(s.user||null); } }catch{} },[]);
  useEffect(()=>{ try{ if(staffMode) sessionStorage.setItem("pickeatgo_staff",JSON.stringify({on:true,user:staffUser})); else sessionStorage.removeItem("pickeatgo_staff"); }catch{} },[staffMode,staffUser]);
  const [employees,setEmployees]     = useState([]);
  const [printPrefs,setPrintPrefsState] = useState({autoKitchen:false,autoReceipt:false});
  const [receiptForm,setReceiptForm] = useState({vat_number:"",receipt_footer:""});
  const [savingReceipt,setSavingReceipt] = useState(false);
  useEffect(()=>{setPrintPrefsState(getPrintPrefs());},[]);
  const updatePrintPrefs=(patchObj)=>setPrintPrefsState(p=>{const n={...p,...patchObj};setPrintPrefs(n);return n;});
  const [chartMetric,setChartMetric] = useState("orders");
  const [saving,setSaving]           = useState(false);
  const [logoUploading,setLogoUploading] = useState(false);
  const [logoPreview,setLogoPreview]     = useState(null);
  const [toast,setToast]             = useState(null);
  const [isOpen,setIsOpen]           = useState(false);
  const [hours,setHours]             = useState(()=>initHours([]));
  const [savingHours,setSavingHours] = useState(false);
  const [prepTime,setPrepTime]       = useState(15);
  const [maxPerSlot,setMaxPerSlot]   = useState("");
  const [savingTiming,setSavingTiming] = useState(false);
  const [newCatName,setNewCatName]     = useState("");
  // Gestion : statistiques réelles, encaissement comptoir, notifications, paiement à la remise
  const [stats,setStats]               = useState([]);
  const [showCounter,setShowCounter]   = useState(false);
  const [notifOpen,setNotifOpen]       = useState(false);
  const [payingOrder,setPayingOrder]   = useState(null);
  const [refreshKey,setRefreshKey]     = useState(0);

  const toastTimer = useRef(null);
  const showToast = useCallback((msg,type="success") => { setToast({msg,type}); clearTimeout(toastTimer.current); toastTimer.current=setTimeout(()=>setToast(null),3000); },[]);

  // Maintien en éveil du serveur tant que le tableau de bord est ouvert (évite un redémarrage lent à la première action)
  useEffect(()=>{const ping=()=>fetch(`${API}/health/`,{cache:"no-store"}).catch(()=>{});const t=setInterval(ping,8*60*1000);return()=>clearInterval(t);},[]);

  const loadRestaurant = useCallback(async()=>{
    if(!user)return; setLoading(true);
    try {
      const data = await get(`/restaurants/?owner=${user.id}`);
      const resto = data.results?.[0]||null;
      setRestaurant(resto); setIsOpen(resto?.is_open||false); setHours(initHours(resto?.hours||[]));
      setPrepTime(resto?.prep_time_avg||15);
      setMaxPerSlot(resto?.max_orders_per_slot ?? "");
      setReceiptForm({vat_number:resto?.vat_number||"",receipt_footer:resto?.receipt_footer||""});
    } catch(err){showToast(err.message,"error");}
    finally{setLoading(false);}
  },[user]);
  useEffect(()=>{loadRestaurant();},[loadRestaurant]);
  const loadEmployees = useCallback(async()=>{
    if(!restaurant)return;
    try { const d=await get(`/restaurants/employees/?restaurant=${restaurant.id}`); setEmployees(d.results||[]); } catch{}
  },[restaurant?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(()=>{loadEmployees();},[loadEmployees]);

  const loadOrders = useCallback(async()=>{
    if(!restaurant)return;
    try { const d=await get(`/orders/?restaurant=${restaurant.id}&ordering=-created_at&page_size=200`); setOrders(d.results||[]); } catch{}
  },[restaurant?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  // Chargement initial des commandes (une seule fois, pas de polling)
  useEffect(()=>{loadOrders();},[loadOrders]);

  // WebSocket temps réel — remplace le polling toutes les 10s
  const { connected: wsConnected } = useOrderWebSocket({
    enabled: !!restaurant,
    onNewOrder: (order) => setOrders(prev => {
      if (prev.find(o=>o.id===order.id)) return prev;
      if (getPrintPrefs().autoKitchen) { try { printTicket(order, restaurant, "kitchen"); } catch {} }
      return [order, ...prev];
    }),
    onStatusUpdate: (order) => setOrders(prev => prev.map(o => o.id===order.id ? order : o)),
  });

  const loadMenu = useCallback(async()=>{
    if(!restaurant)return;
    try {
      const [c,m,ing,sup]=await Promise.all([
        get(`/menus/categories/?restaurant=${restaurant.id}&page_size=200`),
        get(`/menus/items/?restaurant=${restaurant.id}&page_size=500`),
        get(`/menus/ingredients/?restaurant=${restaurant.id}&page_size=500`),
        get(`/menus/suppliers/?restaurant=${restaurant.id}&page_size=200`),
      ]);
      setCategories(c.results||[]); setMenu(m.results||[]); setIngredients(ing.results||[]); setSuppliers(sup.results||[]);
    } catch{}
  },[restaurant?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(()=>{loadMenu();},[loadMenu]);

  // Activité des 7 derniers jours (données réelles pour les graphiques)
  const loadStats = useCallback(async()=>{
    if(!restaurant)return;
    try { const d=await get(`/orders/stats/?restaurant=${restaurant.id}&days=7`); setStats(d.days||[]); } catch{}
  },[restaurant?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(()=>{loadStats();},[loadStats,refreshKey]);
  const bump = ()=>setRefreshKey(k=>k+1);

  const newOrders    = orders.filter(o=>o.status==="nouvelle");
  const activeOrders = orders.filter(o=>!["recuperee","annulee"].includes(o.status));
  const isToday      = (iso)=>iso&&new Date(iso).toDateString()===new Date().toDateString();
  const todayOrders  = orders.filter(o=>isToday(o.created_at)&&o.status!=="annulee");
  const todayRevenue = orders.filter(o=>isToday(o.created_at)&&o.status==="recuperee").reduce((s,o)=>s+parseFloat(o.total_price||0),0);
  const stockAlerts  = { out: menu.filter(i=>i.is_out_of_stock), low: menu.filter(i=>i.is_low_stock) };
  const ingAlerts    = { out: ingredients.filter(i=>i.is_out_of_stock), low: ingredients.filter(i=>i.is_low_stock) };
  const alertsCount  = stockAlerts.out.length+stockAlerts.low.length+ingAlerts.out.length+ingAlerts.low.length;
  const notifCount   = newOrders.length+alertsCount;
  const filteredOrders = orders.filter(o=>{
    if(orderFilter==="active") return !["recuperee","annulee"].includes(o.status);
    if(orderFilter==="done")   return ["recuperee","annulee"].includes(o.status);
    return o.status===orderFilter;
  });
  const menuCategories = [...new Set(menu.map(i=>i.category_name||"Menu"))];

  const [advancingId,setAdvancingId]=useState(null);       // anti double-tap : une seule étape à la fois
  const advanceOrder = async(id,payment)=>{
    if(advancingId===id) return;
    setAdvancingId(id);
    try {
      const body = payment ? {payment_method:payment} : {};
      if(staffMode&&staffUser) body.employee=staffUser.id;
      const r=await patch(`/orders/${id}/advance/`,body);
      setOrders(p=>p.map(o=>o.id===id?{...o,status:r.status,payment_method:payment||o.payment_method,employee_name:(staffMode&&staffUser)?staffUser.name:o.employee_name}:o));
      setPayingOrder(null); showToast("Commande avancée ✓"); bump();
    } catch(err){showToast(err.message,"error");}
    finally{setAdvancingId(null);}
  };
  const cancelOrder = async(id)=>{
    try { await patch(`/orders/${id}/cancel/`,{}); setOrders(p=>p.map(o=>o.id===id?{...o,status:"annulee"}:o)); showToast("Commande annulée"); loadMenu(); bump(); }
    catch(err){showToast(err.message,"error");}
  };
  const onCounterSaved = (order)=>{ setOrders(p=>[order,...p]); setShowCounter(false); loadMenu(); bump();
    if(printPrefs.autoReceipt){ try{ printTicket(order,restaurant,"receipt"); }catch{} } };
  const doPrint = (order,kind)=>{ try{ printTicket(order,restaurant,kind); }catch(e){ showToast("Impression impossible : "+e.message,"error"); } };
  const saveReceipt = async()=>{
    setSavingReceipt(true);
    try{ const r=await patch(`/restaurants/${restaurant.id}/`,receiptForm); setRestaurant(prev=>({...prev,vat_number:r.vat_number,receipt_footer:r.receipt_footer})); showToast("Mentions du ticket enregistrées ✓"); }
    catch(e){showToast(e.message,"error");}
    finally{setSavingReceipt(false);}
  };
  const saveTiming = async()=>{
    if(!restaurant)return;
    const prep = Math.max(1, parseInt(prepTime)||15);
    const maxVal = maxPerSlot === "" ? null : Math.max(1, parseInt(maxPerSlot)||1);
    setSavingTiming(true);
    try {
      const r=await patch(`/restaurants/${restaurant.id}/`,{prep_time_avg:prep,max_orders_per_slot:maxVal});
      setRestaurant(prev=>({...prev,prep_time_avg:r.prep_time_avg,max_orders_per_slot:r.max_orders_per_slot}));
      setPrepTime(r.prep_time_avg);
      setMaxPerSlot(r.max_orders_per_slot ?? "");
      showToast("Paramètres mis à jour ✓");
    } catch(err){showToast(err.message,"error");}
    finally{setSavingTiming(false);}
  };
  const saveHours = async()=>{
    if(!restaurant)return;
    setSavingHours(true);
    try { const data=await put(`/restaurants/${restaurant.id}/hours/`,hours); setHours(initHours(data)); setRestaurant(p=>p?{...p,hours:data}:p); showToast("Horaires sauvegardés ✓"); }
    catch(err){showToast(err.message,"error");}
    finally{setSavingHours(false);}
  };
  const togglingRef = useRef(new Set());                      // anti double-tap sur les bascules (ouvert/fermé, disponible)
  const toggleOpen = async()=>{
    if(!restaurant||togglingRef.current.has("open"))return;
    togglingRef.current.add("open");
    try { const r=await patch(`/restaurants/${restaurant.id}/toggle-open/`,{}); setIsOpen(r.is_open); showToast(r.is_open?"Restaurant ouvert ✓":"Restaurant fermé"); }
    catch(err){showToast(err.message,"error");}
    finally{togglingRef.current.delete("open");}
  };
  const toggleAvail = async(item)=>{
    if(togglingRef.current.has(item.id))return;
    togglingRef.current.add(item.id);
    try { const r=await patch(`/menus/items/${item.id}/toggle-availability/`,{}); setMenu(p=>p.map(i=>i.id===item.id?{...i,is_available:r.is_available}:i)); togglingRef.current.delete(item.id); showToast(r.is_available?"Disponible ✓":"Indisponible"); }
    catch(err){togglingRef.current.delete(item.id);showToast(err.message,"error");}
  };
  const deleteItem = async(id)=>{
    if(!confirm("Supprimer ce plat ?"))return;
    try { await del(`/menus/items/${id}/`); setMenu(p=>p.filter(i=>i.id!==id)); showToast("Plat supprimé"); }
    catch(err){showToast(err.message,"error");}
  };
  const handlePhotoSelect = (file)=>{
    if(!file)return;
    if(!["image/jpeg","image/png","image/webp"].includes(file.type)){showToast("Format non supporté","error");return;}
    if(file.size>5*1024*1024){showToast("Image trop grande (max 5MB)","error");return;}
    setPhotoUploading(true);
    const r=new FileReader();
    r.onloadend=()=>{setFormItem(p=>({...p,image:file,imagePreview:r.result}));setPhotoUploading(false);};
    r.readAsDataURL(file);
  };
  const handleExtraPhotos = (files)=>{
    const list=Array.from(files||[]);
    const room = 5 - (1) - formItem.photos.length - formItem.newPhotos.length;   // 5 au total, principale comprise
    if(list.length>room){showToast(`Maximum 5 photos par plat (${Math.max(0,room)} place(s) restante(s))`,"error");}
    list.slice(0,Math.max(0,room)).forEach(file=>{
      if(!["image/jpeg","image/png","image/webp"].includes(file.type)){showToast(`${file.name} : format non supporté`,"error");return;}
      if(file.size>5*1024*1024){showToast(`${file.name} : trop grande (max 5 MB)`,"error");return;}
      const r=new FileReader(); r.onloadend=()=>setFormItem(p=>({...p,newPhotos:[...p.newPhotos,{file,preview:r.result}]})); r.readAsDataURL(file);
    });
  };
  const handleLogoSelect = async(file)=>{
    if(!file)return;
    if(!["image/jpeg","image/png","image/webp"].includes(file.type)){showToast("Format non supporté","error");return;}
    if(file.size>5*1024*1024){showToast("Image trop grande (max 5MB)","error");return;}
    setLogoUploading(true);
    // Aperçu local immédiat, remplacé par l'URL définitive une fois l'envoi confirmé
    const previous=logoPreview;
    const reader=new FileReader();
    reader.onloadend=()=>setLogoPreview(reader.result);
    reader.readAsDataURL(file);
    // Upload vers l'API
    try{
      const fd=new FormData();
      fd.append("logo",file);
      const r=await upload(`/restaurants/${restaurant.id}/upload-logo/`,fd);
      if(!r?.logo_url) throw new Error("Le serveur n'a pas renvoyé le logo.");
      setLogoPreview(r.logo_url);
      setRestaurant(p=>p?{...p,logo_url:r.logo_url}:p);
      showToast("Logo mis à jour ✓");
    }catch(err){
      setLogoPreview(previous||null);          // l'envoi a échoué : on ne fait pas croire que c'est enregistré
      showToast(`Logo non enregistré : ${err.message}`,"error");
    }finally{setLogoUploading(false);}
  };

  const saveItem = async()=>{
    const priceVal = parseMoney(formItem.price);
    if(!formItem.name.trim()){showToast("Indiquez le nom du plat","error");return;}
    if(priceVal===null){showToast("Prix manquant ou illisible : tapez un nombre, ex. 15 ou 15,50","error");return;}
    if(priceVal<=0){showToast("Le prix doit être supérieur à 0","error");return;}
    if(formItem.cost_price!==""&&formItem.recipe.length===0&&parseMoney(formItem.cost_price)===null){showToast("Prix de revient illisible : tapez un nombre, ex. 3,20","error");return;}
    setSaving(true);
    try {
      let categoryId = formItem.category_id||categories[0]?.id;
      if(formItem.category_id==="__new__"){
        if(!newCatName.trim()){showToast("Entrez un nom de catégorie","error");setSaving(false);return;}
        const newCat = await post("/menus/categories/",{restaurant:restaurant.id,name:newCatName.trim(),order:categories.length});
        setCategories(p=>[...p,newCat]);
        categoryId = newCat.id;
        setNewCatName("");
      }
      const body={name:formItem.name.trim(),price:priceVal,description:formItem.description,category:categoryId,options:formItem.options.map(o=>({label:o.label,extra_price:parseMoney(o.extra_price)||0})),
        cost_price: parseMoney(formItem.cost_price),
        low_stock_threshold: Math.max(0,parseInt(formItem.low_stock_threshold)||0),
        available_days: formItem.available_days, available_from: formItem.available_from||null, available_until: formItem.available_until||null, available_on: formItem.available_on||null};
      if(!editItem) body.is_available=true;
      let saved;
      if(editItem){saved=await patch(`/menus/items/${editItem}/`,body);setMenu(p=>p.map(i=>i.id===editItem?saved:i));}
      else{saved=await post("/menus/items/",body);setMenu(p=>[...p,saved]);setEditItem(saved.id);}
      // Recette (plat ↔ ingrédients) : enregistrée seulement si elle a changé
      const recipeNow = JSON.stringify(formItem.recipe.map(l=>[l.ingredient,String(l.qty)]));
      if(recipeNow!==formItem.recipeOrig){
        const r=await put(`/menus/items/${saved.id}/recipe/`,{lines:formItem.recipe.map(l=>({ingredient:l.ingredient,qty:parseFloat(String(l.qty).replace(",","."))}))});
        saved=r.item; setMenu(p=>p.map(i=>i.id===saved.id?saved:i));
      }
      // Stock initial / inventaire saisi dans le formulaire → mouvement tracé
      const wantedStock = formItem.stock_qty===""?null:parseInt(formItem.stock_qty);
      if(wantedStock!==null && !isNaN(wantedStock) && wantedStock!==saved.stock_qty){
        const r=await post(`/menus/items/${saved.id}/stock/`,{mode:"set",qty:wantedStock,note:editItem?"Modification du plat":"Stock initial"});
        saved=r.item; setMenu(p=>p.map(i=>i.id===saved.id?saved:i));
      }
      if(formItem.image&&saved?.id){const fd=new FormData();fd.append("image",formItem.image);const r=await upload(`/menus/items/${saved.id}/upload-image/`,fd);setMenu(p=>p.map(i=>i.id===saved.id?{...i,image_url:r.image_url}:i));}
      for(const pid of formItem.removedPhotos){ try{ await del(`/menus/items/${saved.id}/photos/${pid}/`); }catch(e){ showToast(e.message,"error"); } }
      for(const np of formItem.newPhotos){ const fd=new FormData(); fd.append("image",np.file); try{ await upload(`/menus/items/${saved.id}/photos/`,fd); }catch(e){ showToast(`Photo non ajoutée : ${e.message}`,"error"); } }
      showToast(editItem?"Plat modifié ✓":"Plat ajouté ✓");
      setShowModal(false);setEditItem(null);setFormItem(EMPTY_ITEM);setNewOption({label:"",extra_price:""});
      loadMenu();
    } catch(err){showToast(err.message,"error");}
    finally{setSaving(false);}
  };
  const openEdit = (item)=>{
    setEditItem(item.id);
    const recipe=(item.recipe||[]).map(l=>({ingredient:l.ingredient,qty:String(parseFloat(l.qty))}));
    setFormItem({name:item.name,category_id:String(item.category||""),price:String(item.price),description:item.description||"",image:null,imagePreview:item.image_url||null,photos:item.photos||[],newPhotos:[],removedPhotos:[],options:(item.options||[]).map(o=>({label:o.label,extra_price:String(o.extra_price||0)})),
      cost_price:item.cost_price==null?"":String(item.cost_price),stock_qty:item.stock_qty==null?"":String(item.stock_qty),low_stock_threshold:String(item.low_stock_threshold??5),
      recipe, recipeOrig:JSON.stringify(recipe.map(l=>[l.ingredient,String(l.qty)])),
      available_days:item.available_days||[],available_from:item.available_from?String(item.available_from).slice(0,5):"",available_until:item.available_until?String(item.available_until).slice(0,5):"",available_on:item.available_on||""});
    setNewOption({label:"",extra_price:""});setNewLine({ingredient:"",qty:""});
    setShowModal(true);
  };
  const addRecipeLine = ()=>{
    const q=parseFloat(String(newLine.qty).replace(",","."));
    if(!newLine.ingredient||isNaN(q)||q<=0){showToast("Choisissez un ingrédient et une quantité","error");return;}
    setFormItem(p=>({...p,recipe:[...p.recipe.filter(l=>l.ingredient!==newLine.ingredient),{ingredient:newLine.ingredient,qty:String(q)}]}));
    setNewLine({ingredient:"",qty:""});
  };

  if(!user) return (<><style>{CSS}</style><div style={{display:"flex",alignItems:"center",justifyContent:"center",minHeight:"100vh",background:"#0F172A",color:"#fff",textAlign:"center"}}><div><p style={{fontSize:48,marginBottom:16}}>🍔</p><h2 style={{fontFamily:"'Sora',sans-serif",fontSize:24,marginBottom:12}}>Accès restreint</h2><button onClick={()=>window.location.href="/login"} style={{background:"#FF6B2C",color:"#fff",border:"none",borderRadius:12,padding:"12px 24px",fontSize:16,fontWeight:700,cursor:"pointer"}}>Se connecter</button></div></div></>);
  if(loading) return (<><style>{CSS}</style><div style={{display:"flex",alignItems:"center",justifyContent:"center",minHeight:"100vh",background:"#0F172A",color:"#fff",textAlign:"center",fontFamily:"'Sora',sans-serif"}}><div><p style={{fontSize:48,marginBottom:16}}>🍔</p><p>Chargement...</p></div></div></>);
  if(!restaurant) return (<><style>{CSS}</style><div style={{display:"flex",alignItems:"center",justifyContent:"center",minHeight:"100vh",background:"#F8FAFC"}}><div style={{textAlign:"center",maxWidth:400,padding:32}}><p style={{fontSize:64,marginBottom:16}}>🏪</p><h2 style={{fontFamily:"'Sora',sans-serif",fontSize:24,marginBottom:12}}>Aucun restaurant associé</h2><p style={{color:"#64748B",marginBottom:24}}>Votre compte n'est lié à aucun restaurant. Contactez {single?`l'éditeur (${brandCtx.platformName})`:"l'équipe PickEatGo"} pour activer votre établissement.</p><button onClick={()=>{localStorage.clear();window.location.href="/login";}} style={{background:"#FF6B2C",color:"#fff",border:"none",borderRadius:12,padding:"12px 24px",fontSize:14,fontWeight:700,cursor:"pointer"}}>Se déconnecter</button></div></div></>);
  if(staffMode) return (<><style>{CSS}</style>
    {toast&&<div style={{position:"fixed",top:"calc(12px + env(safe-area-inset-top))",right:12,left:12,maxWidth:"calc(100vw - 24px)",marginLeft:"auto",width:"max-content",zIndex:999,background:toast.type==="error"?"#FEF2F2":"#DCFCE7",color:toast.type==="error"?"#DC2626":"#16A34A",border:`1.5px solid ${toast.type==="error"?"#FCA5A5":"#86EFAC"}`,borderRadius:12,padding:"12px 20px",fontWeight:700,fontSize:14,boxShadow:"0 8px 24px rgba(0,0,0,.12)"}}>{toast.type==="error"?"⚠️":"✓"} {toast.msg}</div>}
    <StaffView orders={activeOrders} onAdvance={advanceOrder} staffUser={staffUser} restaurantName={restaurant.name} onPrint={doPrint}
               onExit={()=>{ if(employees.some(e=>e.is_active&&e.role==="gerant")) setShowStaffPin("exit"); else {setStaffMode(false);setStaffUser(null);} }}
               onCounterSale={()=>setShowCounter(true)}/>
    {showCounter&&<CounterSaleModal restaurant={restaurant} menu={menu} employee={staffUser} showToast={showToast} onClose={()=>setShowCounter(false)} onSaved={onCounterSaved}/>}
    {showStaffPin==="exit"&&<StaffPinModal restaurant={restaurant} employees={employees} purpose="exit" onClose={()=>setShowStaffPin(false)} onConfirm={()=>{setShowStaffPin(false);setStaffMode(false);setStaffUser(null);}}/>}
  </>);

  const NAV=[
    {id:"dashboard",label:"Dashboard",icon:"dashboard",badge:null},
    {id:"orders",   label:"Commandes",icon:"orders",   badge:newOrders.length>0?newOrders.length:null},
    {id:"menu",     label:"Menu",     icon:"menu",     badge:null},
    {id:"stock",    label:"Stocks",   icon:"stock",    badge:alertsCount>0?alertsCount:null},
    {id:"sales",    label:"Ventes",   icon:"sales",    badge:null},
    {id:"customers",label:"Clients",  icon:"staff",    badge:null},
    {id:"staff",    label:"Caissier", icon:"cash",     badge:null},
    {id:"settings", label:"Paramètres",icon:"settings",badge:null},
  ];

  return (
    <><style>{CSS}</style>
    <div className="app">
      {toast&&<div style={{position:"fixed",top:"calc(12px + env(safe-area-inset-top))",right:12,left:12,maxWidth:"calc(100vw - 24px)",marginLeft:"auto",width:"max-content",zIndex:999,background:toast.type==="error"?"#FEF2F2":"#DCFCE7",color:toast.type==="error"?"#DC2626":"#16A34A",border:`1.5px solid ${toast.type==="error"?"#FCA5A5":"#86EFAC"}`,borderRadius:12,padding:"12px 20px",fontWeight:700,fontSize:14,boxShadow:"0 8px 24px rgba(0,0,0,.12)",animation:"fadeUp .3s ease"}}>{toast.type==="error"?"⚠️":"✓"} {toast.msg}</div>}

      <aside className={`sidebar ${sidebarOpen?"":"collapsed"}`}>
        <div className="sb-logo" onClick={()=>setSidebarOpen(o=>!o)}>
          <div className="sb-logo-icon" style={{overflow:"hidden",padding:0}}>
            {restaurant.logo_url||logoPreview
              ?<img src={logoPreview||restaurant.logo_url} alt="logo" style={{width:"100%",height:"100%",objectFit:"cover",borderRadius:10}}/>
              :<span style={{fontSize:20}}>{restaurant.emoji||CUISINE_EMOJI[Array.isArray(restaurant.cuisine) ? restaurant.cuisine[0] : restaurant.cuisine]||"🍽️"}</span>}
          </div>
          {sidebarOpen&&<div><p className="sb-title">{restaurant.name}</p><p className="sb-sub">Tableau de bord</p></div>}
        </div>
        <nav className="sb-nav">
          {NAV.map(item=>(
            <button key={item.id} className={`sb-item ${page===item.id?"active":""}`} onClick={()=>{if(item.id==="staff")setShowStaffPin("enter");else setPage(item.id);}}>
              <span className="sb-icon"><Ic n={item.icon} s={18} c={page===item.id?"#fff":"#94A3B8"}/></span>
              {sidebarOpen&&<span className="sb-label">{item.label}</span>}
              {item.badge&&<span className={`sb-badge ${!sidebarOpen?"mini":""}`}>{item.badge}</span>}
            </button>
          ))}
        </nav>
        <div className="sb-footer">
          {sidebarOpen&&<div className="sb-resto"><div className="sb-av">{user.first_name?.[0]||"R"}</div><div><p className="sb-admin-name">{user.first_name} {user.last_name}</p><p className="sb-admin-role">Propriétaire</p></div></div>}
          <button className="sb-item sb-client" style={{marginTop:4}} title="Voir le site tel que vos clients le voient" onClick={()=>{try{sessionStorage.setItem("pickeatgo_view_client","1");}catch{};window.location.href="/";}}>
            <span className="sb-icon"><Ic n="home" s={17} c="#64748B"/></span>
            {sidebarOpen&&<span className="sb-label" style={{color:"#64748B"}}>Voir le site client</span>}
          </button>
          <button className="sb-item" style={{marginTop:4}} onClick={()=>{ ["access","refresh","user"].forEach(k=>localStorage.removeItem(k)); window.location.href="/login"; }}>
            <span className="sb-icon"><Ic n="logout" s={17} c="#64748B"/></span>
            {sidebarOpen&&<span className="sb-label" style={{color:"#64748B"}}>Déconnexion</span>}
          </button>
        </div>
      </aside>

      <main className="main">
        <header className="topbar">
          <div>
            <h1 className="page-title">{{dashboard:"Vue d'ensemble",orders:"Commandes",menu:"Menu",stock:"Stocks",sales:"Ventes & clôture",customers:"Ma clientèle",settings:"Paramètres"}[page]||"Dashboard"}</h1>
            <TopbarClock/>
          </div>
          <div style={{display:"flex",alignItems:"center",gap:10}}>
            <OpenStateButton hours={restaurant?.hours} isOpen={isOpen} onToggle={toggleOpen}/>
            {newOrders.length>0&&<div className="alert-pill" onClick={()=>setPage("orders")}><span className="live-dot"/>{newOrders.length} nouvelle{newOrders.length>1?"s":""}<span className="ap-long"> commande{newOrders.length>1?"s":""}</span></div>}
            <button className="icon-btn" onClick={()=>{loadOrders();loadMenu();bump();}} aria-label="Actualiser"><Ic n="refresh" s={16} c="#64748B"/></button>
            <div className="notif-wrap">
              <button className="icon-btn" aria-label="Notifications" onClick={()=>setNotifOpen(o=>!o)} style={notifCount>0?{background:"#FFFBEB",borderColor:"#FDE68A"}:{}}>
                <Ic n="bell" s={18} c={notifCount>0?"#D97706":"#64748B"}/>
              </button>
              {notifCount>0&&<span className="notif-badge">{notifCount}</span>}
              {notifOpen&&<NotificationsPanel newOrders={newOrders} alerts={stockAlerts} ingredientAlerts={ingAlerts} onGo={setPage} onClose={()=>setNotifOpen(false)}/>}
            </div>
            <div className="ws-ind" title={wsConnected?"Mises à jour en direct":"Reconnexion en cours"} style={{display:"flex",alignItems:"center",gap:5,fontSize:12,fontWeight:600,color:wsConnected?"#10B981":"#94A3B8"}}>
              <div style={{width:7,height:7,borderRadius:"50%",background:wsConnected?"#10B981":"#E2E8F0"}}/>  
              <span className="ws-ind-label">{wsConnected?"En direct":"…"}</span>
            </div>
            <button className="staff-btn" onClick={()=>setShowStaffPin("enter")}><Ic n="staff" s={15} c="white"/> Mode caissier</button>
          </div>
        </header>

        <div className="content">

          {/* DASHBOARD */}
          {page==="dashboard"&&(
            <div className="fade-in">
              <div className="kpi-row">
                {[
                  {label:"Ventes aujourd'hui",   value:todayOrders.length, sub:`${activeOrders.length} en cours`,  color:"#FF6B2C",icon:"orders",spark:stats.map(d=>d.orders)},
                  {label:"Revenu du jour",        value:money(todayRevenue), sub:"Commandes récupérées",           color:"#10B981",icon:"euro",  spark:stats.map(d=>parseFloat(d.revenue))},
                  {label:"À traiter",             value:activeOrders.length,sub:`${newOrders.length} nouvelle(s)`, color:"#F59E0B",icon:"bell",  spark:null},
                  {label:"Stocks",                value:alertsCount>0?`${alertsCount} alerte(s)`:"OK", sub:stockAlerts.out.length?`${stockAlerts.out.length} plat(s) épuisé(s)`:ingAlerts.out.length?`${ingAlerts.out.length} ingrédient(s) épuisé(s)`:`${menu.filter(i=>i.track_stock||i.has_recipe).length} plat(s) suivi(s) · ${ingredients.length} ingrédient(s)`, color:alertsCount?"#EF4444":"#6366F1",icon:"stock",spark:null},
                ].map((k,i)=>(
                  <div key={i} className="kpi-card" style={{animationDelay:`${i*.07}s`}}>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:k.spark?12:0}}>
                      <div><p className="kpi-label">{k.label}</p><p className="kpi-val">{k.value}</p><p className="kpi-sub">{k.sub}</p></div>
                      <div style={{width:42,height:42,borderRadius:12,background:k.color+"18",display:"flex",alignItems:"center",justifyContent:"center"}}><Ic n={k.icon} s={20} c={k.color}/></div>
                    </div>
                    {k.spark&&k.spark.length>1&&<Sparkline data={k.spark} color={k.color}/>}
                  </div>
                ))}
              </div>
              {alertsCount>0&&(
                <div className={`alert-banner ${stockAlerts.out.length||ingAlerts.out.length?"":"warn"}`} onClick={()=>{setStockSection(stockAlerts.out.length+stockAlerts.low.length?"dishes":"ingredients");setPage("stock");}}>
                  <Ic n="warning" s={16}/>
                  <span>{stockAlerts.out.length>0&&<><strong>{stockAlerts.out.map(i=>i.name).join(", ")}</strong> : épuisé(s), retiré(s) de la carte. </>}
                  {stockAlerts.low.length>0&&<>Bientôt épuisé(s) : {stockAlerts.low.map(i=>`${i.name} (${i.effective_stock})`).join(", ")}. </>}
                  {(ingAlerts.out.length+ingAlerts.low.length)>0&&<>Ingrédients à commander : {[...ingAlerts.out,...ingAlerts.low].map(i=>i.name).join(", ")}.</>}</span>
                  <span style={{marginLeft:"auto",whiteSpace:"nowrap"}}>Gérer →</span>
                </div>
              )}
              <div className="card" style={{marginBottom:16}}>
                <div className="card-hd"><h3 className="card-title">🔴 Commandes actives</h3>
                  <div style={{display:"flex",gap:8,alignItems:"center"}}>
                    <button className="pill-btn primary" onClick={()=>setShowCounter(true)}>🧾 Vente comptoir</button>
                    <button className="link-btn" onClick={()=>setPage("orders")}>Voir tout →</button>
                  </div>
                </div>
                {activeOrders.length===0?<div className="empty-msg">Aucune commande active</div>:activeOrders.slice(0,4).map(order=>{
                  const sc=STATUS_CONFIG[order.status]||STATUS_CONFIG.nouvelle;
                  const items=order.items||order.order_items||[];
                  return(<div key={order.id} className="order-row">
                    <div style={{display:"flex",alignItems:"center",gap:10,flex:1}}>
                      <span className="order-dot" style={{background:sc.color}}/>
                      <div><p className="order-id">#{order.number||order.id} · <strong>{order.client_name||"Client"}</strong></p>
                        <p className="order-meta">{items.map(i=>`${i.qty||1}× ${i.name||i.item_name}`).join(", ")} · ⏱ {order.pickup_slot||"—"}</p></div>
                    </div>
                    <span className="status-badge" style={{background:sc.bg,color:sc.color}}>{statusLabel(order)}</span>
                    {nextStep(order).next&&<button className="advance-btn" onClick={()=>advanceOrder(order.id)}>{nextStep(order).nextLabel} →</button>}
                  </div>);
                })}
              </div>
              <div className="card">
                <div className="card-hd"><h3 className="card-title">Activité de la semaine</h3>
                  <div style={{display:"flex",gap:4,background:"var(--bg)",borderRadius:8,padding:4}}>
                    {["orders","revenue"].map(m=><button key={m} className={`mini-tab ${chartMetric===m?"active":""}`} onClick={()=>setChartMetric(m)}>{m==="orders"?"Commandes":"Revenus"}</button>)}
                  </div>
                </div>
                <ActivityChart periods={stats} metric={chartMetric} height={110}/>
                <p style={{fontSize:11,color:"#94A3B8",marginTop:8}}>Ventes = commandes non annulées ; revenu = commandes récupérées (en ligne et comptoir). Détails dans l'onglet Ventes.</p>
              </div>
            </div>
          )}

          {/* ORDERS */}
          {page==="orders"&&(
            <div className="fade-in">
              <div className="menu-toolbar" style={{display:"flex",justifyContent:"flex-end",marginBottom:14}}>
                <button className="btn-primary menu-add-btn" onClick={()=>setShowCounter(true)}>🧾 Encaisser une vente comptoir</button>
              </div>
              <div className="filter-row">
                {[["active","Actives"],["nouvelle","Nouvelles"],["confirmee","Confirmées"],["en_cuisine","En cuisine"],["prete","Prêtes"],["en_livraison","En livraison"],["done","Terminées"]].map(([v,l])=>(
                  <button key={v} className={`filter-chip ${orderFilter===v?"active":""}`} onClick={()=>setOrderFilter(v)}>
                    {l}<span className="chip-n">{v==="active"?activeOrders.length:v==="done"?orders.filter(o=>["recuperee","annulee"].includes(o.status)).length:orders.filter(o=>o.status===v).length}</span>
                  </button>
                ))}
              </div>
              <div style={{display:"flex",flexDirection:"column",gap:12}}>
                {filteredOrders.map(order=>{
                  const sc=STATUS_CONFIG[order.status]||STATUS_CONFIG.nouvelle;
                  const items=order.items||order.order_items||[];
                  return(
                    <div key={order.id} className="order-card" style={{borderLeft:`4px solid ${sc.color}`}}>
                      <div className="oc-header">
                        <div>
                          <div style={{display:"flex",alignItems:"center",gap:10}}>
                            <p className="oc-id">#{order.number||order.id}</p>
                            <span className="status-badge" style={{background:sc.bg,color:sc.color}}>{statusLabel(order)}</span>
                            <span className="type-badge">{TYPE_LABELS[order.order_type]||order.order_type}</span>
                            {order.payment_method&&<span className="type-badge">{PAYMENT_LABELS[order.payment_method]}</span>}
                          </div>
                          <p className="oc-client">{order.client_name||"Client"} · ⏱ {String(order.pickup_slot||"—").slice(0,5)}{(order.employee_name||order.created_by_name)?` · par ${order.employee_name||order.created_by_name}`:""}</p>
                        </div>
                        <p className="oc-total">{parseFloat(order.total_price||0).toFixed(2)} €</p>
                      </div>
                      <div className="oc-items">
                        {items.map((item,i)=><span key={i} className="oc-item">{item.qty||1}× {item.name||item.item_name} <span style={{color:"#94A3B8"}}>({parseFloat(item.subtotal||item.price||0).toFixed(2)}€)</span></span>)}
                      </div>
                      {order.delivery_address&&<div className="oc-note">🛵 Livrer à : {order.delivery_address}{parseFloat(order.delivery_fee)>0?` · frais ${money(order.delivery_fee)}`:""}</div>}
                      {order.note&&<div className="oc-note">📝 {order.note}</div>}
                      <div style={{display:"flex",gap:6,marginTop:10,flexWrap:"wrap"}}>
                        {order.status!=="annulee"&&<button className="pill-btn" onClick={()=>doPrint(order,"kitchen")}>🖨 Cuisine</button>}
                        {order.status!=="annulee"&&<button className="pill-btn" onClick={()=>doPrint(order,"receipt")}>🧾 Ticket client</button>}
                      </div>
                      {!["recuperee","annulee"].includes(order.status)&&(
                        payingOrder===order.id
                          ? <div className="oc-actions" style={{marginTop:12}}><PaymentChooser saving={advancingId===order.id} onPick={(pm)=>advanceOrder(order.id,pm)} onCancel={()=>setPayingOrder(null)}/></div>
                          : <div className="oc-actions">
                              {nextStep(order).next&&<button className="btn-advance" disabled={advancingId===order.id} onClick={()=>order.status===payStep(order)?setPayingOrder(order.id):advanceOrder(order.id)}>{advancingId===order.id?"…":`${nextStep(order).nextLabel} →`}</button>}
                              {!["prete","en_livraison"].includes(order.status)&&<button className="btn-cancel" onClick={()=>cancelOrder(order.id)}>Annuler</button>}
                            </div>
                      )}
                    </div>
                  );
                })}
                {filteredOrders.length===0&&<div className="empty-msg">Aucune commande dans cette catégorie</div>}
              </div>
            </div>
          )}

          {/* MENU */}
          {page==="menu"&&(
            <div className="fade-in">
              <div className="menu-toolbar" style={{display:"flex",justifyContent:"flex-end",marginBottom:20}}>
                <button className="btn-primary menu-add-btn" onClick={()=>{setEditItem(null);setFormItem({...EMPTY_ITEM,category_id:categories[0]?.id?String(categories[0].id):""});setNewOption({label:"",extra_price:""});setNewLine({ingredient:"",qty:""});setNewCatName("");setShowModal(true);}}>
                  <Ic n="plus" s={15} c="white"/> Ajouter un plat
                </button>
              </div>
              {menuCategories.length===0&&<div className="empty-msg"><p style={{fontSize:32,marginBottom:10}}>🍽️</p><p style={{fontWeight:700,color:"var(--text)",marginBottom:6}}>Votre menu est vide</p><p style={{fontSize:12,color:"#94A3B8"}}>Ajoutez votre premier plat avec le bouton ci-dessus. Vous pourrez créer une catégorie directement dans le formulaire.</p></div>}
              {menuCategories.map(cat=>(
                <div key={cat} style={{marginBottom:24}}>
                  <h3 className="cat-title">{cat}</h3>
                  <div className="menu-grid">
                    {menu.filter(i=>(i.category_name||"Menu")===cat).map(item=>(
                      <div key={item.id} className={`menu-card ${!item.is_available?"unavail":""}`}>
                        <div style={{position:"relative"}}>
                          <img src={item.image_url||"https://images.unsplash.com/photo-1568901346375-23c9450c58cd?w=200&q=80"} alt={item.name} className="menu-card-img" style={{cursor:item.image_urls?.length?"zoom-in":"default"}}
                            onClick={()=>item.image_urls?.length&&setLightbox({images:item.image_urls.map(u=>({url:u,caption:item.name})),index:0})}/>
                          {item.image_urls?.length>1&&<span style={{position:"absolute",bottom:6,right:6,fontSize:10,fontWeight:800,background:"rgba(15,23,42,.75)",color:"#fff",padding:"2px 7px",borderRadius:10}}>📷 {item.image_urls.length}</span>}
                        </div>
                        <div className="menu-card-body">
                          <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
                            <p className="menu-card-name">{item.name}</p>
                            <p className="menu-card-price">{parseFloat(item.price).toFixed(2)} €</p>
                          </div>
                          {(item.track_stock||item.has_recipe)&&<p style={{fontSize:11,fontWeight:700,marginBottom:4,color:item.is_out_of_stock?"#DC2626":item.is_low_stock?"#B45309":"#15803D"}}>
                            {item.is_out_of_stock?`Épuisé${item.limited_by&&item.portions_available===0?` (${item.limited_by})`:""}`:`Stock : ${item.effective_stock}${item.has_recipe?" portion(s)":""}`}{item.is_low_stock?" ⚠":""}
                          </p>}
                          {item.is_scheduled&&<p style={{fontSize:11,fontWeight:700,marginBottom:4,color:item.is_available_now?"#1D4ED8":"#94A3B8"}}>⏰ {item.schedule_label}{!item.is_available_now&&item.is_available?" · hors créneau":""}</p>}
                          <p className="menu-card-desc">{item.description}</p>
                          {item.options?.length>0&&(
                            <div style={{display:"flex",flexWrap:"wrap",gap:4,marginBottom:8}}>
                              {item.options.map((opt,i)=>(
                                <span key={i} style={{fontSize:10,fontWeight:600,background:"#FFF0E8",color:"#FF6B2C",padding:"2px 8px",borderRadius:20,border:"1px solid #FED7AA"}}>
                                  {opt.label}{parseFloat(opt.extra_price)>0?` +${parseFloat(opt.extra_price).toFixed(2)}€`:""}
                                </span>
                              ))}
                            </div>
                          )}
                          <div className="menu-card-actions">
                            <button className={`avail-btn ${item.is_available?"on":"off"}`} onClick={()=>toggleAvail(item)}>{item.is_available?"✓ Disponible":"✗ Indispo"}</button>
                            <button className="icon-btn-sm" onClick={()=>openEdit(item)}><Ic n="edit" s={14} c="#6366F1"/></button>
                            <button className="icon-btn-sm red" onClick={()=>deleteItem(item.id)}><Ic n="trash" s={14} c="#EF4444"/></button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* VENTES & CLÔTURE */}
          {page==="sales"&&<SalesPage restaurant={restaurant} showToast={showToast} refreshKey={refreshKey}/>}

          {/* CLIENTS */}
          {page==="customers"&&<CustomersPage restaurant={restaurant} showToast={showToast} refreshKey={refreshKey}/>}

          {/* STOCKS */}
          {page==="stock"&&<StockPage key={stockSection} restaurant={restaurant} menu={menu} showToast={showToast} refreshKey={refreshKey} initialSection={stockSection}
                                     ingredients={ingredients} suppliers={suppliers}
                                     onIngredientsChange={(upd)=>{setIngredients(upd);loadMenu();}} onSuppliersChange={setSuppliers}
                                     onEditRecipe={openEdit}
                                     onMenuItemChange={(it)=>setMenu(p=>p.map(i=>i.id===it.id?it:i))}/>}

          {/* SETTINGS */}
          {page==="settings"&&(
            <div className="fade-in">
              <div className="settings-grid">
                {single&&(
                  <div className="card" style={{gridColumn:"1/-1"}}>
                    <MyAppCard restaurant={restaurant} showToast={showToast}/>
                  </div>
                )}
                <div className="card">
                  <div className="card-hd"><h3 className="card-title">Logo du restaurant</h3></div>
                  <div style={{display:"flex",alignItems:"center",gap:20,marginBottom:16}}>
                    {/* Aperçu logo */}
                    <div style={{width:80,height:80,borderRadius:16,background:"#F1F5F9",border:"2px dashed #E2E8F0",display:"flex",alignItems:"center",justifyContent:"center",overflow:"hidden",flexShrink:0,cursor:"pointer",position:"relative"}}
                      onClick={()=>document.getElementById("logo-input").click()}>
                      {logoPreview||restaurant.logo_url
                        ?<img src={logoPreview||restaurant.logo_url} alt="logo" style={{width:"100%",height:"100%",objectFit:"cover"}}/>
                        :<span style={{fontSize:36}}>{CUISINE_EMOJI[Array.isArray(restaurant.cuisine) ? restaurant.cuisine[0] : restaurant.cuisine]||"🍽️"}</span>}
                      {logoUploading&&<div style={{position:"absolute",inset:0,background:"rgba(0,0,0,.4)",display:"flex",alignItems:"center",justifyContent:"center"}}><div style={{width:20,height:20,border:"2px solid rgba(255,255,255,.3)",borderTop:"2px solid white",borderRadius:"50%",animation:"spin .8s linear infinite"}}/></div>}
                    </div>
                    <div style={{flex:1}}>
                      <p style={{fontSize:13,fontWeight:600,color:"#1E293B",marginBottom:4}}>{restaurant.name}</p>
                      <p style={{fontSize:12,color:"#64748B",marginBottom:10}}>{logoPreview||restaurant.logo_url?"Logo personnalisé":`Icône actuelle : ${restaurant.emoji||CUISINE_EMOJI[Array.isArray(restaurant.cuisine) ? restaurant.cuisine[0] : restaurant.cuisine]||"🍽️"}`}</p>
                      <button className="btn-primary" style={{padding:"8px 16px",fontSize:12}} onClick={()=>document.getElementById("logo-input").click()} disabled={logoUploading}>
                        {logoUploading?"Upload...":"📷 Changer le logo"}
                      </button>
                      {(logoPreview||restaurant.logo_url)&&(
                        <button onClick={async()=>{ try{ await patch(`/restaurants/${restaurant.id}/`,{logo:null}); setLogoPreview(null); setRestaurant(p=>p?{...p,logo_url:null}:p); showToast("Logo retiré"); }catch(e){showToast(e.message,"error");} }} style={{marginLeft:8,background:"none",border:"none",color:"#EF4444",fontSize:12,cursor:"pointer",fontWeight:600,padding:"10px 6px"}}>Supprimer</button>
                      )}
                    </div>
                    <input id="logo-input" type="file" accept="image/jpeg,image/png,image/webp" style={{display:"none"}} onChange={e=>handleLogoSelect(e.target.files[0])}/>
                  </div>
                  <p style={{fontSize:11,color:"#94A3B8"}}>JPEG / PNG / WebP · max 5 MB · Format carré recommandé</p>
                </div>
                <div className="card">
                  <div className="card-hd"><h3 className="card-title">Profil restaurant</h3></div>
                  <ProfileForm restaurant={restaurant} setRestaurant={setRestaurant} showToast={showToast} email={user.email} single={single} platformName={brandCtx.platformName}/>
                </div>
                <div className="card">
                  <div className="card-hd"><h3 className="card-title">Statut</h3>{single&&<span className="status-badge" style={{background:"#DCFCE7",color:"#16A34A"}}>Actif</span>}</div>
                  {!single&&restaurant.status==="pending"&&<p style={{fontSize:12,color:"#92400E",background:"#FFFBEB",border:"1px solid #FDE68A",borderRadius:10,padding:"8px 12px",marginBottom:8}}>En attente de validation par l'équipe PickEatGo : votre restaurant n'est pas encore visible du public.</p>}
                  {!single&&restaurant.status==="suspended"&&<p style={{fontSize:12,color:"#B91C1C",background:"#FEF2F2",border:"1px solid #FECACA",borderRadius:10,padding:"8px 12px",marginBottom:8}}>Restaurant suspendu par l'administration.</p>}
                  <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"16px 0"}}>
                    <div><p style={{fontWeight:700,fontSize:14}}>Restaurant {isOpen?"ouvert":"fermé"}</p><p style={{fontSize:12,color:"#64748B",marginTop:4}}>{isOpen?"Les clients peuvent commander":"Commandes désactivées"}{single?" · l'interrupteur et les horaires décident de l'ouverture":""}</p></div>
                    <button onClick={toggleOpen} style={{background:isOpen?"#DCFCE7":"#FEE2E2",color:isOpen?"#16A34A":"#DC2626",border:"none",borderRadius:20,padding:"10px 20px",fontWeight:700,fontSize:14,cursor:"pointer"}}>{isOpen?"Fermer":"Ouvrir"}</button>
                  </div>
                </div>
                <div className="card" style={{gridColumn:"1/-1"}}>
                  <PlaceGalleryCard restaurant={restaurant} setRestaurant={setRestaurant} showToast={showToast} onView={(images,index)=>setLightbox({images,index})}/>
                </div>
                <div className="card">
                  <OrderModesCard restaurant={restaurant} setRestaurant={setRestaurant} showToast={showToast}/>
                </div>
                <div className="card">
                  <div className="card-hd"><h3 className="card-title">Temps & créneaux</h3></div>
                  <p style={{fontSize:12,color:"#64748B",marginBottom:16}}>Le client voit ce délai et choisit librement son heure de retrait à partir de ce moment.</p>
                  <div className="sf">
                    <div>
                      <label className="fl">Temps de préparation moyen (minutes)</label>
                      <div style={{display:"flex",alignItems:"center",gap:10}}>
                        <input className="fi" type="text" inputMode="numeric" min={1} max={120} value={prepTime}
                          onChange={e=>setPrepTime(e.target.value)}
                          style={{width:90,textAlign:"center",fontSize:16,fontWeight:700}}/>
                        <p style={{fontSize:12,color:"#64748B",flex:1}}>Le premier créneau disponible sera au minimum dans <strong>{Math.max(1,parseInt(prepTime)||15)} min</strong> après la commande.</p>
                      </div>
                    </div>
                    <div>
                      <label className="fl">Nombre maximum de commandes par créneau</label>
                      <div style={{display:"flex",alignItems:"center",gap:10}}>
                        <input className="fi" type="text" inputMode="numeric" min={1} max={999} value={maxPerSlot}
                          placeholder="∞"
                          onChange={e=>setMaxPerSlot(e.target.value)}
                          style={{width:90,textAlign:"center",fontSize:16,fontWeight:700}}/>
                        <p style={{fontSize:12,color:"#64748B",flex:1}}>
                          {maxPerSlot===""
                            ? "Illimité — aucun créneau ne sera bloqué."
                            : <>Maximum <strong>{Math.max(1,parseInt(maxPerSlot)||1)} commande{parseInt(maxPerSlot)>1?"s":""}</strong> par créneau. Au-delà, le créneau sera refusé.</>
                          }
                        </p>
                      </div>
                    </div>
                  </div>
                  <button className="btn-primary" style={{width:"100%",marginTop:16,opacity:savingTiming?.7:1}} onClick={saveTiming} disabled={savingTiming}>
                    {savingTiming?"Sauvegarde...":<><Ic n="check" s={14} c="white"/> Sauvegarder</>}
                  </button>
                </div>

                <div className="card" style={{gridColumn:"1/-1"}}>
                  <div className="card-hd">
                    <h3 className="card-title">Horaires d'ouverture</h3>
                    <button className="btn-primary" style={{padding:"8px 16px",fontSize:13}} onClick={saveHours} disabled={savingHours}>
                      {savingHours?"Sauvegarde...":<><Ic n="check" s={14} c="white"/> Sauvegarder</>}
                    </button>
                  </div>
                  <p style={{fontSize:12,color:"#64748B",marginBottom:14}}>Ces horaires sont affichés aux clients. Le bouton Ouvrir/Fermer reste indépendant.</p>
                  <div style={{display:"flex",flexDirection:"column",gap:8}}>
                    {hours.map((h,i)=>(
                      <div key={h.day_of_week} className="hours-row" style={{display:"flex",alignItems:"center",gap:12,padding:"10px 14px",borderRadius:10,background:h.is_open?"#F8FAFC":"#FEF2F2",border:"1.5px solid",borderColor:h.is_open?"var(--border)":"#FEE2E2"}}>
                        <span style={{width:76,fontWeight:700,fontSize:13,color:h.is_open?"var(--text)":"#94A3B8",flexShrink:0}}>{DAY_NAMES[h.day_of_week]}</span>
                        <label style={{display:"flex",alignItems:"center",gap:6,cursor:"pointer",flexShrink:0}}>
                          <input type="checkbox" checked={h.is_open} onChange={e=>setHours(p=>p.map((d,j)=>j===i?{...d,is_open:e.target.checked}:d))} style={{width:16,height:16,accentColor:"#FF6B2C",cursor:"pointer"}}/>
                          <span style={{fontSize:12,fontWeight:700,color:h.is_open?"#16A34A":"#DC2626",minWidth:42}}>{h.is_open?"Ouvert":"Fermé"}</span>
                        </label>
                        <div className="hours-times" style={{display:"flex",alignItems:"center",gap:8,marginLeft:"auto",opacity:h.is_open?1:0.35,pointerEvents:h.is_open?"auto":"none"}}>
                          <input type="time" value={h.open_time} onChange={e=>setHours(p=>p.map((d,j)=>j===i?{...d,open_time:e.target.value}:d))}
                            style={{border:"1.5px solid var(--border)",borderRadius:8,padding:"6px 10px",fontSize:13,fontWeight:600,color:"var(--text)",background:"#fff",fontFamily:"inherit"}}/>
                          <span style={{fontSize:12,color:"#94A3B8",fontWeight:700}}>→</span>
                          <input type="time" value={h.close_time} onChange={e=>setHours(p=>p.map((d,j)=>j===i?{...d,close_time:e.target.value}:d))}
                            style={{border:"1.5px solid var(--border)",borderRadius:8,padding:"6px 10px",fontSize:13,fontWeight:600,color:"var(--text)",background:"#fff",fontFamily:"inherit"}}/>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="card">
                  <div className="card-hd"><h3 className="card-title">Notifications push</h3></div>
                  <p style={{fontSize:12,color:"#64748B",marginBottom:6}}>Soyez alerté d'une nouvelle commande même quand le tableau de bord est fermé (tablette, téléphone). Réglage par appareil.</p>
                  <PushToggle label="Nouvelle commande sur cet appareil" withTest onMessage={(t,ok)=>showToast(t,ok?"success":"error")} />
                </div>
                <div className="card">
                  <div className="card-hd"><h3 className="card-title">🖨 Impression des tickets</h3></div>
                  <p style={{fontSize:12,color:"#64748B",marginBottom:12}}>Format 80 mm (imprimante thermique) ou imprimante classique. L'impression automatique est réglée par appareil : activez-la sur la tablette de la cuisine ou de la caisse.</p>
                  {[["autoKitchen","Imprimer le ticket cuisine à chaque nouvelle commande en ligne"],["autoReceipt","Imprimer le ticket client après chaque vente comptoir"]].map(([k,l])=>(
                    <label key={k} style={{display:"flex",alignItems:"center",gap:10,padding:"8px 0",cursor:"pointer",fontSize:13,fontWeight:600}}>
                      <input type="checkbox" checked={!!printPrefs[k]} onChange={e=>updatePrintPrefs({[k]:e.target.checked})} style={{width:18,height:18,accentColor:"#FF6B2C"}}/>{l}
                    </label>
                  ))}
                  <div className="sf" style={{marginTop:10}}>
                    <div><label className="fl">N° de TVA (sur le ticket client)</label><input className="fi" placeholder="BE 0123.456.789" value={receiptForm.vat_number} onChange={e=>setReceiptForm(p=>({...p,vat_number:e.target.value}))}/></div>
                    <div><label className="fl">Message en bas du ticket</label><input className="fi" placeholder="Merci et à bientôt !" value={receiptForm.receipt_footer} onChange={e=>setReceiptForm(p=>({...p,receipt_footer:e.target.value}))}/></div>
                  </div>
                  <div style={{display:"flex",gap:8,marginTop:12,flexWrap:"wrap"}}>
                    <button className="btn-primary" style={{flex:1,justifyContent:"center"}} disabled={savingReceipt} onClick={saveReceipt}>{savingReceipt?"…":<><Ic n="check" s={14} c="white"/> Enregistrer</>}</button>
                    <button className="pill-btn" onClick={()=>previewTicket({number:"TEST",order_type:"emporter",pickup_slot:"12:30",created_at:new Date().toISOString(),total_price:22.4,payment_method:"carte",items:[{name:"Burger Classic",qty:2,price:9.5,subtotal:19,options:[{label:"Bacon",extra_price:"1.00"}]},{name:"Cola 33cl",qty:1,price:2.5,subtotal:2.5}],note:"Sans oignons"},{...restaurant,...receiptForm},"receipt")}>Aperçu ticket client</button>
                    <button className="pill-btn" onClick={()=>previewTicket({number:"TEST",order_type:"emporter",pickup_slot:"12:30",created_at:new Date().toISOString(),total_price:22.4,items:[{name:"Burger Classic",qty:2,options:[{label:"Bacon"}]},{name:"Cola 33cl",qty:1}],note:"Sans oignons"},restaurant,"kitchen")}>Aperçu ticket cuisine</button>
                  </div>
                </div>
                <div className="card" style={{gridColumn:"1/-1"}}>
                  <MarketingCard restaurant={restaurant} setRestaurant={setRestaurant} showToast={showToast}/>
                </div>
                <div className="card" style={{gridColumn:"1/-1"}}>
                  <TeamCard restaurant={restaurant} employees={employees} setEmployees={setEmployees} showToast={showToast}/>
                  <div className="card" style={{marginTop:16}}>
                    <div className="card-hd"><h3 className="card-title">👤 Compte</h3></div>
                    <p style={{fontSize:13,color:"#64748B",marginBottom:12}}>{user.first_name} {user.last_name} · {user.email}</p>
                    <div style={{display:"flex",gap:10,flexWrap:"wrap"}}>
                      <button className="btn-secondary" onClick={()=>{try{sessionStorage.setItem("pickeatgo_view_client","1");}catch{};window.location.href="/";}}>🏠 Voir le site client</button>
                      <button className="btn-secondary" style={{color:"#DC2626"}} onClick={()=>{ ["access","refresh","user"].forEach(k=>localStorage.removeItem(k)); window.location.href="/login"; }}>Se déconnecter</button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </main>

      {/* MODAL MENU */}
      {showModal&&(
        <div className="modal-ov" onClick={()=>setShowModal(false)}>
          <div className="menu-modal" onClick={e=>e.stopPropagation()}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20}}>
              <h3 style={{fontFamily:"'Sora',sans-serif",fontSize:18,fontWeight:800}}>{editItem?"Modifier le plat":"Nouveau plat"}</h3>
              <button className="icon-btn" onClick={()=>setShowModal(false)}><Ic n="x" s={18} c="#64748B"/></button>
            </div>
            <div className={`photo-drop-zone ${photoDragOver?"drag-over":""} ${formItem.imagePreview?"has-image":""}`}
              onDragOver={e=>{e.preventDefault();setPhotoDragOver(true);}} onDragLeave={()=>setPhotoDragOver(false)}
              onDrop={e=>{e.preventDefault();setPhotoDragOver(false);handlePhotoSelect(e.dataTransfer.files[0]);}}
              onClick={()=>document.getElementById("photo-input").click()}>
              {formItem.imagePreview
                ?<><img src={formItem.imagePreview} alt="preview" className="photo-preview"/><div className="photo-overlay"><span style={{fontSize:13,fontWeight:700,color:"#fff"}}>Changer la photo</span></div></>
                :<div className="photo-placeholder">{photoUploading?<div className="photo-spinner"/>:<><Ic n="photo" s={32} c="#CBD5E1"/><p className="photo-hint">Glissez une photo ici</p><p className="photo-hint-sub">JPEG / PNG / WebP · max 5 MB</p></>}</div>}
              <input id="photo-input" type="file" accept="image/jpeg,image/png,image/webp" style={{display:"none"}} onChange={e=>handlePhotoSelect(e.target.files[0])}/>
            </div>
            {formItem.imagePreview&&<button className="photo-remove-btn" onClick={e=>{e.stopPropagation();setFormItem(p=>({...p,image:null,imagePreview:null}));}}><Ic n="x" s={12} c="#EF4444"/> Supprimer</button>}
            {/* Photos supplémentaires (galerie) */}
            <div style={{marginTop:10}}>
              <label className="fl">Autres photos <span style={{color:"#94A3B8",fontWeight:500,textTransform:"none",letterSpacing:0}}>· {1+formItem.photos.length+formItem.newPhotos.length} / 5 au total</span></label>
              <div style={{display:"flex",gap:8,flexWrap:"wrap",alignItems:"center"}}>
                {formItem.photos.map(ph=>(
                  <div key={ph.id} className="photo-thumb">
                    <img src={ph.url} alt="" onClick={()=>setLightbox({images:[formItem.imagePreview,...formItem.photos.map(x=>x.url)].filter(Boolean),index:1+formItem.photos.findIndex(x=>x.id===ph.id)})}/>
                    <button className="photo-thumb-x" title="Retirer" onClick={()=>setFormItem(p=>({...p,photos:p.photos.filter(x=>x.id!==ph.id),removedPhotos:[...p.removedPhotos,ph.id]}))}>×</button>
                    {editItem&&<button className="photo-thumb-cover" title="Définir comme photo principale" onClick={async()=>{try{const r=await post(`/menus/items/${editItem}/photos/${ph.id}/`,{});setMenu(p=>p.map(i=>i.id===r.item.id?r.item:i));setFormItem(p=>({...p,imagePreview:r.item.image_url,image:null,photos:r.item.photos||[]}));showToast("Photo principale mise à jour ✓");}catch(e){showToast(e.message,"error");}}}>★</button>}
                  </div>
                ))}
                {formItem.newPhotos.map((np,i)=>(
                  <div key={i} className="photo-thumb new">
                    <img src={np.preview} alt=""/>
                    <button className="photo-thumb-x" title="Retirer" onClick={()=>setFormItem(p=>({...p,newPhotos:p.newPhotos.filter((_,j)=>j!==i)}))}>×</button>
                  </div>
                ))}
                {(1+formItem.photos.length+formItem.newPhotos.length)<5&&(
                  <label className="photo-thumb add" title="Ajouter des photos">
                    <Ic n="plus" s={18} c="#94A3B8"/>
                    <input type="file" accept="image/jpeg,image/png,image/webp" multiple style={{display:"none"}} onChange={e=>{handleExtraPhotos(e.target.files);e.target.value="";}}/>
                  </label>
                )}
              </div>
              <p style={{fontSize:11,color:"#94A3B8",marginTop:4}}>Le client peut agrandir chaque photo et parcourir la galerie du restaurant. ★ = choisir comme photo principale.</p>
            </div>
            <div className="sf" style={{marginTop:16}}>
              <div><label className="fl">Nom *</label><input className="fi" placeholder="Burger Classic" value={formItem.name} onChange={e=>setFormItem(p=>({...p,name:e.target.value}))}/></div>
              <div><label className="fl">Prix (€) *</label><input className="fi" type="text" inputMode="decimal" placeholder="9,50" value={formItem.price} onChange={e=>setFormItem(p=>({...p,price:e.target.value}))}/></div>
              <div><label className="fl">Description</label><input className="fi" placeholder="Courte description..." value={formItem.description} onChange={e=>setFormItem(p=>({...p,description:e.target.value}))}/></div>
              <div><label className="fl">Catégorie</label>
                <select className="fi" value={formItem.category_id} onChange={e=>setFormItem(p=>({...p,category_id:e.target.value}))}>
                  {categories.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}
                  <option value="__new__">＋ Nouvelle catégorie...</option>
                </select>
                {formItem.category_id==="__new__"&&(
                  <input className="fi" style={{marginTop:6}} placeholder="Nom de la nouvelle catégorie" value={newCatName} onChange={e=>setNewCatName(e.target.value)} autoFocus/>
                )}
              </div>
              {/* ── Gestion : coût, stock, seuil ── */}
              <div className="form-3col">
                <div><label className="fl">Prix de revient (€)</label>
                  <input className="fi" type="text" inputMode="decimal" placeholder="3,20" disabled={formItem.recipe.length>0}
                    value={formItem.recipe.length>0?recipeCost(formItem.recipe,ingredients).toFixed(2):formItem.cost_price} onChange={e=>setFormItem(p=>({...p,cost_price:e.target.value}))}/></div>
                <div><label className="fl">Stock (unités)</label><input className="fi" type="text" inputMode="numeric" min="0" placeholder="∞" value={formItem.stock_qty} onChange={e=>setFormItem(p=>({...p,stock_qty:e.target.value}))}/></div>
                <div><label className="fl">Seuil d'alerte</label><input className="fi" type="text" inputMode="numeric" min="0" value={formItem.low_stock_threshold} onChange={e=>setFormItem(p=>({...p,low_stock_threshold:e.target.value}))}/></div>
              </div>
              <p style={{fontSize:11,color:"#94A3B8",marginTop:-6}}>{formItem.recipe.length>0?"Prix de revient calculé depuis la recette. ":"Le prix de revient sert au calcul de la marge dans Ventes. "}Stock vide = pas de comptage à l'unité{formItem.recipe.length>0?" (la disponibilité suit les ingrédients)":" (toujours disponible)"}.</p>
            </div>

            {/* ── Recette : ingrédients consommés par portion ── */}
            <div style={{marginTop:16}}>
              <label className="fl" style={{display:"flex",alignItems:"center",gap:6}}><Ic n="leaf" s={13} c="#15803D"/> Recette — ingrédients par portion</label>
              {ingredients.length===0 ? (
                <p style={{fontSize:12,color:"#94A3B8",padding:"8px 0"}}>Aucun ingrédient créé. Ajoutez vos matières premières dans <strong>Stocks → Ingrédients</strong> pour que chaque vente les décompte automatiquement et que le prix de revient se calcule seul.</p>
              ) : (
                <>
                  {formItem.recipe.length>0&&(
                    <div style={{display:"flex",flexDirection:"column",gap:6,marginBottom:10}}>
                      {formItem.recipe.map((l,i)=>{const ing=ingredients.find(x=>x.id===l.ingredient);if(!ing)return null;return (
                        <div key={l.ingredient} style={{display:"flex",alignItems:"center",gap:8,padding:"8px 12px",background:"#F0FDF4",borderRadius:10,border:"1.5px solid #BBF7D0"}}>
                          <span style={{flex:1,fontSize:13,fontWeight:600,color:"var(--text)"}}>{ing.name}</span>
                          <input className="fi" type="text" inputMode="decimal" min="0" style={{width:84,padding:"5px 8px",fontSize:13,textAlign:"right"}} value={l.qty}
                            onChange={e=>setFormItem(p=>({...p,recipe:p.recipe.map((x,j)=>j===i?{...x,qty:e.target.value}:x)}))}/>
                          <span style={{fontSize:12,color:"var(--text-soft)",minWidth:44}}>{UNIT_LABELS[ing.unit]}</span>
                          <span style={{fontSize:12,fontWeight:700,color:"#15803D",minWidth:56,textAlign:"right"}}>{money(parseFloat(l.qty||0)*parseFloat(ing.unit_cost||0))}</span>
                          <button onClick={()=>setFormItem(p=>({...p,recipe:p.recipe.filter((_,j)=>j!==i)}))}
                            style={{width:22,height:22,borderRadius:6,border:"none",background:"#FEE2E2",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
                            <Ic n="x" s={11} c="#EF4444"/>
                          </button>
                        </div>);})}
                    </div>
                  )}
                  <div style={{display:"flex",gap:8}}>
                    <select className="fi" style={{flex:2}} value={newLine.ingredient} onChange={e=>setNewLine(p=>({...p,ingredient:e.target.value}))}>
                      <option value="">Ajouter un ingrédient…</option>
                      {ingredients.filter(i=>!formItem.recipe.some(l=>l.ingredient===i.id)).map(i=><option key={i.id} value={i.id}>{i.name} ({UNIT_LABELS[i.unit]})</option>)}
                    </select>
                    <input className="fi" type="text" inputMode="decimal" min="0" placeholder="Qté" style={{flex:1,maxWidth:90}} value={newLine.qty}
                      onChange={e=>setNewLine(p=>({...p,qty:e.target.value}))} onKeyDown={e=>{if(e.key==="Enter")addRecipeLine();}}/>
                    <button onClick={addRecipeLine} style={{width:42,height:42,borderRadius:10,border:"none",background:"#15803D",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
                      <Ic n="plus" s={18} c="white"/>
                    </button>
                  </div>
                  <p style={{fontSize:11,color:"#94A3B8",marginTop:6}}>
                    {formItem.recipe.length>0
                      ? <>Coût matière : <strong>{money(recipeCost(formItem.recipe,ingredients))}</strong>{formItem.price&&parseFloat(formItem.price)>0&&<> · marge {money(parseFloat(formItem.price)-recipeCost(formItem.recipe,ingredients))} ({Math.round((1-recipeCost(formItem.recipe,ingredients)/parseFloat(formItem.price))*100)} %)</>}. Chaque vente décompte ces quantités.</>
                      : "Ex. : 1 pièce de pain, 0,15 kg de steak, 2 pièces de cheddar. Le plat sera retiré de la carte si un ingrédient manque."}
                  </p>
                </>
              )}
            </div>

            {/* ── Disponibilité programmée ── */}
            <div style={{marginTop:16}}>
              <label className="fl" style={{display:"flex",alignItems:"center",gap:6}}><Ic n="clock" s={13} c="#1D4ED8"/> Disponibilité (menu du jour, formule midi…)</label>
              <div style={{display:"flex",gap:6,flexWrap:"wrap",alignItems:"center",marginBottom:8}}>
                <span style={{fontSize:12,color:"var(--text-soft)",marginRight:4}}>Jours :</span>
                {DAY_SHORT.map((d,i)=>{const on=formItem.available_days.includes(i);return (
                  <button key={i} type="button" onClick={()=>setFormItem(p=>({...p,available_days:on?p.available_days.filter(x=>x!==i):[...p.available_days,i].sort()}))}
                    style={{width:34,height:34,borderRadius:"50%",border:"1.5px solid",borderColor:on?"#1D4ED8":"var(--border)",background:on?"#1D4ED8":"#fff",color:on?"#fff":"var(--text-soft)",fontWeight:800,fontSize:13,cursor:"pointer",fontFamily:"inherit"}}>{d}</button>);})}
                <span style={{fontSize:11,color:"#94A3B8"}}>{formItem.available_days.length===0?"tous les jours":""}</span>
              </div>
              <div className="form-3col">
                <div><label className="fl">De</label><input className="fi" type="time" value={formItem.available_from} onChange={e=>setFormItem(p=>({...p,available_from:e.target.value}))}/></div>
                <div><label className="fl">À</label><input className="fi" type="time" value={formItem.available_until} onChange={e=>setFormItem(p=>({...p,available_until:e.target.value}))}/></div>
                <div><label className="fl">Plat du jour (date)</label><input className="fi" type="date" value={formItem.available_on} onChange={e=>setFormItem(p=>({...p,available_on:e.target.value}))}/></div>
              </div>
              <p style={{fontSize:11,color:"#94A3B8",marginTop:6}}>Laissez vide pour un plat toujours proposé. Le client ne peut le commander que pour un retrait dans ce créneau ; hors créneau il reste visible mais grisé.</p>
            </div>

            {/* ── Options / Suppléments ── */}
            <div style={{marginTop:16}}>
              <label className="fl">Options / Suppléments (checkbox client)</label>
              {formItem.options.length>0&&(
                <div style={{display:"flex",flexDirection:"column",gap:6,marginBottom:10}}>
                  {formItem.options.map((opt,i)=>(
                    <div key={i} style={{display:"flex",alignItems:"center",gap:8,padding:"8px 12px",background:"#F8FAFC",borderRadius:10,border:"1.5px solid var(--border)"}}>
                      <span style={{flex:1,fontSize:13,fontWeight:600,color:"var(--text)"}}>{opt.label}</span>
                      <span style={{fontSize:13,fontWeight:700,color:"#FF6B2C",minWidth:60,textAlign:"right"}}>
                        {parseFloat(opt.extra_price||0)>0?`+${parseFloat(opt.extra_price).toFixed(2)} €`:"Inclus"}
                      </span>
                      <button onClick={()=>setFormItem(p=>({...p,options:p.options.filter((_,j)=>j!==i)}))}
                        style={{width:22,height:22,borderRadius:6,border:"none",background:"#FEE2E2",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
                        <Ic n="x" s={11} c="#EF4444"/>
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <div style={{display:"flex",gap:8}}>
                <input className="fi" placeholder="Ex: Fromage, Bacon, Sans oignons..." style={{flex:2}}
                  value={newOption.label}
                  onChange={e=>setNewOption(p=>({...p,label:e.target.value}))}
                  onKeyDown={e=>{if(e.key==="Enter"&&newOption.label.trim()){setFormItem(p=>({...p,options:[...p.options,{label:newOption.label.trim(),extra_price:newOption.extra_price||"0"}]}));setNewOption({label:"",extra_price:""});}}}
                />
                <input className="fi" type="text" inputMode="decimal" min="0" placeholder="Prix +" style={{flex:1,maxWidth:90}}
                  value={newOption.extra_price}
                  onChange={e=>setNewOption(p=>({...p,extra_price:e.target.value}))}
                />
                <button
                  onClick={()=>{if(!newOption.label.trim())return;setFormItem(p=>({...p,options:[...p.options,{label:newOption.label.trim(),extra_price:newOption.extra_price||"0"}]}));setNewOption({label:"",extra_price:""});}}
                  style={{width:42,height:42,borderRadius:10,border:"none",background:"#FF6B2C",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
                  <Ic n="plus" s={18} c="white"/>
                </button>
              </div>
              <p style={{fontSize:11,color:"#94A3B8",marginTop:6}}>Appuyez sur Entrée ou ＋ · Prix 0 = inclus dans le plat</p>
            </div>

            <div style={{display:"flex",gap:10,marginTop:20}}>
              <button className="btn-secondary" style={{flex:1}} onClick={()=>{setShowModal(false);setNewCatName("");}}>Annuler</button>
              <button className="btn-primary" style={{flex:2,opacity:saving?0.7:1}} onClick={saveItem} disabled={saving}>
                {saving?"Sauvegarde...":<><Ic n="check" s={15} c="white"/> {editItem?"Sauvegarder":"Ajouter"}</>}
              </button>
            </div>
          </div>
        </div>
      )}

      {lightbox&&<Lightbox images={lightbox.images} index={lightbox.index} onClose={()=>setLightbox(null)}/>}
      {showStaffPin==="enter"&&<StaffPinModal restaurant={restaurant} employees={employees} onClose={()=>setShowStaffPin(false)} onConfirm={(emp)=>{setShowStaffPin(false);setStaffUser(emp);setStaffMode(true);}}/>}
      {showCounter&&<CounterSaleModal restaurant={restaurant} menu={menu} showToast={showToast} onClose={()=>setShowCounter(false)} onSaved={onCounterSaved}/>}
    </div></>
  );
}

const CSS = `
  *,*::before,*::after{box-sizing:border-box;margin:0;padding:0;}
  :root{--primary:#FF6B2C;--primary-d:#E55A1F;--primary-l:#FFF0E8;--dark:#0F172A;--text:#1E293B;--text-soft:#64748B;--bg:#F8FAFC;--white:#fff;--border:#E2E8F0;--radius:14px;--shadow:0 2px 12px rgba(0,0,0,.06);--shadow-md:0 8px 32px rgba(0,0,0,.12);}
  html,body{overflow-x:hidden;-webkit-text-size-adjust:100%;}
  body{font-family:'Instrument Sans',sans-serif;background:var(--bg);color:var(--text);}
  img{max-width:100%;}
  .app{display:flex;min-height:100vh;min-height:100dvh;}
  .fade-in{animation:fadeUp .35s ease both;}
  @keyframes fadeUp{from{opacity:0;transform:translateY(10px);}to{opacity:1;transform:translateY(0);}}
  @keyframes spin{to{transform:rotate(360deg);}}

  .sidebar{width:230px;min-height:100vh;background:var(--dark);display:flex;flex-direction:column;position:sticky;top:0;height:100vh;transition:width .3s cubic-bezier(.34,1.56,.64,1);flex-shrink:0;overflow:hidden;}
  .sidebar.collapsed{width:62px;}
  .sb-logo{padding:18px 14px 14px;display:flex;align-items:center;gap:10px;cursor:pointer;border-bottom:1px solid rgba(255,255,255,.07);margin-bottom:8px;}
  .sb-logo-icon{width:36px;height:36px;border-radius:10px;background:var(--primary);display:flex;align-items:center;justify-content:center;font-size:18px;flex-shrink:0;}
  .sb-title{font-family:'Sora',sans-serif;font-size:14px;font-weight:800;color:#fff;white-space:nowrap;}
  .sb-sub{font-size:10px;color:#94A3B8;margin-top:1px;}
  .sb-nav{flex:1;padding:0 8px;display:flex;flex-direction:column;gap:2px;}
  .sb-item{display:flex;align-items:center;gap:10px;padding:10px 11px;border-radius:10px;border:none;background:none;cursor:pointer;transition:all .15s;width:100%;text-align:left;position:relative;}
  .sb-item:hover{background:rgba(255,255,255,.06);}
  .sb-item.active{background:rgba(255,107,44,.25);}
  .sb-icon{flex-shrink:0;width:20px;display:flex;align-items:center;justify-content:center;}
  .sb-label{font-size:13px;font-weight:600;color:#94A3B8;white-space:nowrap;}
  .sb-item.active .sb-label{color:#FDB994;}
  .sb-badge{background:#EF4444;color:#fff;font-size:11px;font-weight:800;padding:2px 7px;border-radius:20px;margin-left:auto;}
  .sb-badge.mini{position:absolute;top:4px;right:4px;padding:2px 5px;}
  .sb-footer{padding:10px 8px 18px;border-top:1px solid rgba(255,255,255,.07);}
  .sb-resto{display:flex;align-items:center;gap:10px;padding:10px 11px;background:rgba(255,255,255,.05);border-radius:10px;margin-bottom:6px;}
  .sb-av{width:32px;height:32px;border-radius:9px;background:var(--primary);display:flex;align-items:center;justify-content:center;font-weight:800;color:#fff;font-size:14px;flex-shrink:0;}
  .sb-admin-name{font-size:13px;font-weight:700;color:#fff;}
  .sb-admin-role{font-size:10px;color:#94A3B8;}

  .main{flex:1;display:flex;flex-direction:column;min-width:0;}
  .topbar{background:#fff;border-bottom:1px solid var(--border);padding:14px 24px;display:flex;align-items:center;justify-content:space-between;position:sticky;top:0;z-index:50;}
  .page-title{font-family:'Sora',sans-serif;font-size:20px;font-weight:800;color:var(--text);}
  .page-sub{font-size:12px;color:var(--text-soft);margin-top:2px;text-transform:capitalize;}
  .alert-pill{background:#FEF9C3;color:#92400E;border:1.5px solid #FDE68A;font-size:12px;font-weight:700;padding:6px 12px;border-radius:20px;display:flex;align-items:center;gap:6px;cursor:pointer;}
  .live-dot{width:7px;height:7px;border-radius:50%;background:#EF4444;display:inline-block;animation:blink 1.5s infinite;}
  @keyframes blink{0%,100%{opacity:1;}50%{opacity:.3;}}
  .icon-btn{width:36px;height:36px;border-radius:10px;border:1.5px solid var(--border);background:#fff;display:flex;align-items:center;justify-content:center;cursor:pointer;transition:all .15s;}
  .icon-btn:hover{border-color:var(--primary);background:var(--primary-l);}
  .staff-btn{display:flex;align-items:center;gap:7px;background:var(--dark);color:#fff;border:none;border-radius:10px;padding:9px 16px;font-size:13px;font-weight:700;cursor:pointer;font-family:'Instrument Sans',sans-serif;}
  .content{padding:22px 24px;flex:1;}

  .kpi-row{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:14px;margin-bottom:20px;}
  .kpi-card{background:#fff;border-radius:var(--radius);padding:18px;box-shadow:var(--shadow);border:1px solid var(--border);animation:fadeUp .4s ease both;}
  .kpi-label{font-size:11px;font-weight:700;color:var(--text-soft);text-transform:uppercase;letter-spacing:.5px;margin-bottom:5px;}
  .kpi-val{font-family:'Sora',sans-serif;font-size:26px;font-weight:800;color:var(--text);line-height:1.1;}
  .kpi-sub{font-size:12px;color:var(--text-soft);margin-top:3px;}

  .card{background:#fff;border-radius:var(--radius);padding:18px;box-shadow:var(--shadow);border:1px solid var(--border);}
  .card-hd{display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;}
  .card-title{font-family:'Sora',sans-serif;font-size:15px;font-weight:700;color:var(--text);}
  .link-btn{font-size:13px;color:var(--primary);font-weight:600;background:none;border:none;cursor:pointer;}
  .mini-tab{padding:6px 12px;border-radius:6px;border:none;font-size:12px;font-weight:600;cursor:pointer;background:none;color:var(--text-soft);font-family:'Instrument Sans',sans-serif;}
  .mini-tab.active{background:#fff;color:var(--primary);box-shadow:var(--shadow);}
  .empty-msg{text-align:center;padding:24px;color:var(--text-soft);font-size:13px;}

  .order-row{display:flex;align-items:center;gap:10px;padding:10px 12px;border-radius:10px;background:var(--bg);margin-bottom:8px;}
  .order-dot{width:8px;height:8px;border-radius:50%;flex-shrink:0;}
  .order-id{font-size:13px;font-weight:700;color:var(--text);}
  .order-meta{font-size:11px;color:var(--text-soft);}
  .status-badge{font-size:11px;font-weight:700;padding:3px 10px;border-radius:20px;white-space:nowrap;}
  .advance-btn{background:var(--primary-l);color:var(--primary);border:none;border-radius:8px;padding:6px 12px;font-size:12px;font-weight:700;cursor:pointer;white-space:nowrap;font-family:'Instrument Sans',sans-serif;}
  .filter-row{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:16px;}
  .filter-chip{padding:8px 14px;border-radius:20px;border:1.5px solid var(--border);background:#fff;font-size:12px;font-weight:600;cursor:pointer;transition:all .15s;display:flex;align-items:center;gap:6px;color:var(--text-soft);font-family:'Instrument Sans',sans-serif;}
  .filter-chip.active{background:var(--primary);border-color:var(--primary);color:#fff;}
  .chip-n{background:rgba(0,0,0,.08);border-radius:10px;padding:1px 6px;font-size:10px;}
  .filter-chip.active .chip-n{background:rgba(255,255,255,.2);}
  .order-card{background:#fff;border-radius:var(--radius);padding:16px;box-shadow:var(--shadow);border:1px solid var(--border);}
  .oc-header{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:10px;}
  .oc-id{font-family:'Sora',sans-serif;font-size:15px;font-weight:800;color:var(--text);}
  .oc-client{font-size:12px;color:var(--text-soft);margin-top:3px;}
  .oc-total{font-family:'Sora',sans-serif;font-size:16px;font-weight:800;color:var(--primary);}
  .oc-items{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px;}
  .oc-item{background:var(--bg);border-radius:8px;padding:4px 10px;font-size:12px;font-weight:600;}
  .oc-note{background:#FFFBEB;border:1px solid #FDE68A;border-radius:8px;padding:8px 12px;font-size:12px;color:#92400E;margin-bottom:10px;}
  .type-badge{background:var(--bg);color:var(--text-soft);font-size:11px;font-weight:600;padding:3px 8px;border-radius:20px;}
  .oc-actions{display:flex;gap:8px;margin-top:10px;}
  .btn-advance{flex:2;padding:10px;border-radius:10px;border:none;background:var(--primary);color:#fff;font-size:13px;font-weight:700;cursor:pointer;font-family:'Instrument Sans',sans-serif;}
  .btn-cancel{flex:1;padding:10px;border-radius:10px;border:1.5px solid var(--border);background:#fff;font-size:13px;font-weight:700;cursor:pointer;font-family:'Instrument Sans',sans-serif;color:#EF4444;}

  .cat-title{font-family:'Sora',sans-serif;font-size:16px;font-weight:800;color:var(--text);margin-bottom:12px;padding-bottom:8px;border-bottom:2px solid var(--border);}
  .menu-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:14px;}
  .menu-card{background:#fff;border-radius:var(--radius);overflow:hidden;box-shadow:var(--shadow);border:1px solid var(--border);transition:all .2s;}
  .menu-card:hover{box-shadow:var(--shadow-md);}
  .menu-card.unavail{opacity:.55;}
  .menu-card-img{width:100%;height:120px;object-fit:cover;}
  .menu-card-body{padding:12px;}
  .menu-card-name{font-size:14px;font-weight:700;color:var(--text);margin-bottom:2px;}
  .menu-card-price{font-size:14px;font-weight:800;color:var(--primary);}
  .menu-card-desc{font-size:11px;color:var(--text-soft);line-height:1.4;margin-bottom:10px;}
  .menu-card-actions{display:flex;align-items:center;gap:6px;flex-wrap:wrap;}
  .avail-btn{flex:1;padding:6px 10px;border-radius:8px;border:none;font-size:11px;font-weight:700;cursor:pointer;font-family:'Instrument Sans',sans-serif;}
  .avail-btn.on{background:#DCFCE7;color:#16A34A;}
  .avail-btn.off{background:#FEE2E2;color:#DC2626;}
  .icon-btn-sm{width:28px;height:28px;border-radius:8px;border:1.5px solid var(--border);background:#fff;display:flex;align-items:center;justify-content:center;cursor:pointer;}
  .icon-btn-sm.red{border-color:#FEE2E2;background:#FEE2E2;}
  .btn-primary{display:flex;align-items:center;gap:7px;background:var(--primary);color:#fff;border:none;border-radius:10px;padding:10px 18px;font-size:14px;font-weight:700;cursor:pointer;font-family:'Instrument Sans',sans-serif;transition:all .15s;}
  .btn-primary:hover{background:var(--primary-d);}
  .btn-secondary{padding:10px 18px;border-radius:10px;border:1.5px solid var(--border);background:#fff;font-size:14px;font-weight:700;cursor:pointer;font-family:'Instrument Sans',sans-serif;}
  .settings-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:16px;}
  .sf{display:flex;flex-direction:column;gap:12px;}
  .fl{font-size:11px;font-weight:700;color:var(--text-soft);text-transform:uppercase;letter-spacing:.5px;display:block;margin-bottom:5px;}
  .fi{width:100%;border:1.5px solid var(--border);border-radius:10px;padding:10px 14px;font-size:14px;font-family:'Instrument Sans',sans-serif;color:var(--text);outline:none;background:#fff;transition:border .15s;}
  .fi:focus{border-color:var(--primary);}

  .modal-ov{position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:200;display:flex;align-items:center;justify-content:center;overflow-y:auto;animation:fadeIn .2s;}
  @keyframes fadeIn{from{opacity:0;}to{opacity:1;}}
  .menu-modal{background:#fff;border-radius:20px;padding:28px;width:100%;max-width:440px;margin:16px;animation:popIn .3s cubic-bezier(.34,1.56,.64,1);max-height:90vh;overflow-y:auto;}
  @keyframes popIn{from{transform:scale(.9);opacity:0;}to{transform:scale(1);opacity:1;}}

  .pin-modal{background:#fff;border-radius:24px;padding:32px;width:100%;max-width:340px;margin:16px;max-height:92vh;max-height:92dvh;overflow-y:auto;animation:popIn .3s cubic-bezier(.34,1.56,.64,1);text-align:center;}
  .pin-title{font-family:'Sora',sans-serif;font-size:20px;font-weight:800;margin-bottom:6px;}
  .pin-sub{font-size:13px;color:var(--text-soft);margin-bottom:20px;}
  .pin-display{font-family:'Sora',sans-serif;font-size:32px;font-weight:800;letter-spacing:12px;color:var(--text);background:var(--bg);border-radius:12px;padding:14px;margin-bottom:20px;}
  .pin-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:12px;}
  .pin-key{padding:16px;border-radius:12px;border:1.5px solid var(--border);background:#fff;font-size:20px;font-weight:700;cursor:pointer;transition:all .15s;font-family:'Sora',sans-serif;}
  .pin-key:hover{background:var(--primary-l);border-color:var(--primary);}
  .pin-key:active{transform:scale(.94);}
  .pin-hint{font-size:12px;color:var(--text-soft);}

  .staff-wrap{min-height:100vh;background:#0F172A;display:flex;flex-direction:column;}
  .staff-topbar{display:flex;justify-content:space-between;align-items:center;padding:16px 24px;background:#1E293B;border-bottom:1px solid rgba(255,255,255,.1);}
  .staff-title{font-family:'Sora',sans-serif;font-size:20px;font-weight:800;color:#fff;}
  .staff-time{font-size:13px;color:#94A3B8;margin-top:2px;}
  .staff-exit-btn{background:rgba(255,255,255,.1);color:#fff;border:1.5px solid rgba(255,255,255,.2);border-radius:10px;padding:9px 16px;font-size:13px;font-weight:700;cursor:pointer;font-family:'Instrument Sans',sans-serif;}
  .staff-grid{flex:1;display:grid;grid-template-columns:repeat(3,1fr);gap:16px;padding:20px;align-items:start;}
  .staff-col{display:flex;flex-direction:column;gap:12px;}
  .staff-col-header{display:flex;justify-content:space-between;align-items:center;padding:10px 14px;border-radius:10px;font-size:14px;font-weight:700;}
  .staff-col-count{font-family:'Sora',sans-serif;font-size:20px;font-weight:800;}
  .staff-empty{text-align:center;padding:24px;color:#475569;font-size:13px;background:#1E293B;border-radius:12px;}
  .staff-card{background:#1E293B;border-radius:14px;padding:14px;transition:all .2s;}
  .staff-card:hover{background:#243447;}
  .staff-card-header{display:flex;align-items:center;gap:8px;margin-bottom:10px;}
  .staff-order-id{font-family:'Sora',sans-serif;font-size:16px;font-weight:800;color:#fff;}
  .staff-client{font-size:13px;font-weight:600;color:#94A3B8;flex:1;}
  .staff-time-badge{font-size:12px;font-weight:700;color:#F59E0B;background:rgba(245,158,11,.15);padding:3px 8px;border-radius:8px;}
  .staff-items{display:flex;flex-direction:column;gap:5px;margin-bottom:10px;}
  .staff-item{font-size:14px;font-weight:600;color:#E2E8F0;}
  .staff-qty{font-size:14px;font-weight:800;color:#FF6B2C;margin-right:2px;}
  .staff-note{background:rgba(245,158,11,.12);border:1px solid rgba(245,158,11,.3);border-radius:8px;padding:8px 12px;font-size:12px;color:#F59E0B;margin-bottom:10px;}
  .staff-meta{display:flex;justify-content:space-between;margin-bottom:12px;}
  .staff-type{font-size:12px;color:#64748B;font-weight:600;}
  .staff-total{font-size:14px;font-weight:800;color:#10B981;}
  .staff-advance-btn{width:100%;padding:12px;border-radius:10px;border:none;background:var(--primary);color:#fff;font-size:14px;font-weight:700;cursor:pointer;font-family:'Instrument Sans',sans-serif;}

  .photo-drop-zone{width:100%;height:160px;border:2px dashed var(--border);border-radius:14px;display:flex;align-items:center;justify-content:center;cursor:pointer;transition:all .2s;position:relative;overflow:hidden;background:var(--bg);}
  .photo-drop-zone:hover,.photo-drop-zone.drag-over{border-color:var(--primary);background:var(--primary-l);}
  .photo-drop-zone.has-image{border-style:solid;}
  .photo-preview{width:100%;height:100%;object-fit:cover;}
  .photo-overlay{position:absolute;inset:0;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;opacity:0;transition:opacity .2s;}
  .photo-drop-zone:hover .photo-overlay{opacity:1;}
  @media(hover:none){.photo-overlay{opacity:1;}}                 /* tactile : « Changer la photo » toujours visible */
  .photo-placeholder{display:flex;flex-direction:column;align-items:center;gap:8px;pointer-events:none;}
  .photo-hint{font-size:14px;font-weight:700;color:var(--text-soft);}
  .photo-hint-sub{font-size:11px;color:#94A3B8;text-align:center;}
  .photo-spinner{width:28px;height:28px;border:3px solid var(--border);border-top-color:var(--primary);border-radius:50%;animation:spin .8s linear infinite;}
  .photo-thumb{position:relative;width:64px;height:64px;border-radius:10px;overflow:hidden;border:1.5px solid var(--border);background:var(--bg);flex-shrink:0;}
  .photo-thumb img{width:100%;height:100%;object-fit:cover;display:block;cursor:zoom-in;}
  .photo-thumb.new{border-color:#86EFAC;}
  .photo-thumb.add{display:flex;align-items:center;justify-content:center;border-style:dashed;cursor:pointer;}
  .photo-thumb.add:hover{border-color:var(--primary);background:var(--primary-l);}
  .photo-thumb-x{position:absolute;top:2px;right:2px;width:18px;height:18px;border-radius:50%;border:none;background:rgba(220,38,38,.9);color:#fff;font-size:13px;line-height:1;cursor:pointer;display:flex;align-items:center;justify-content:center;}
  .photo-thumb-cover{position:absolute;bottom:2px;left:2px;width:18px;height:18px;border-radius:50%;border:none;background:rgba(245,158,11,.95);color:#fff;font-size:11px;cursor:pointer;display:flex;align-items:center;justify-content:center;}
  .photo-remove-btn{display:flex;align-items:center;gap:5px;font-size:12px;color:#EF4444;background:none;border:none;cursor:pointer;margin-top:6px;font-family:'Instrument Sans',sans-serif;font-weight:600;}

  /* ═══════════ GESTION (ventes, stocks, comptoir, notifications) ═══════════ */
  .tbl{width:100%;border-collapse:collapse;font-size:13px;}
  .tbl th{font-size:11px;text-transform:uppercase;letter-spacing:.4px;color:var(--text-soft);text-align:left;padding:8px 10px;border-bottom:2px solid var(--border);font-weight:700;white-space:nowrap;}
  .tbl td{padding:9px 10px;border-bottom:1px solid var(--border);vertical-align:middle;}
  .tbl tr:last-child td{border-bottom:none;}
  .tbl .num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap;}
  .tbl-wrap{overflow-x:auto;-webkit-overflow-scrolling:touch;}
  .stock-badge{display:inline-flex;align-items:center;gap:5px;font-size:12px;font-weight:800;padding:4px 10px;border-radius:20px;white-space:nowrap;}
  .stock-badge.ok{background:#DCFCE7;color:#15803D;} .stock-badge.low{background:#FEF3C7;color:#B45309;} .stock-badge.out{background:#FEE2E2;color:#DC2626;} .stock-badge.none{background:var(--bg);color:var(--text-soft);font-weight:600;}
  .pill-btn{padding:6px 10px;border-radius:8px;border:1.5px solid var(--border);background:#fff;font-size:12px;font-weight:700;cursor:pointer;font-family:inherit;color:var(--text);white-space:nowrap;transition:all .15s;display:inline-flex;align-items:center;gap:5px;}
  .pill-btn:hover{border-color:var(--primary);color:var(--primary);}
  .pill-btn.danger:hover{border-color:#EF4444;color:#EF4444;}
  .pill-btn.primary{background:var(--primary);border-color:var(--primary);color:#fff;} .pill-btn.primary:hover{background:var(--primary-d);color:#fff;}
  .pill-btn:disabled{opacity:.5;cursor:not-allowed;}
  .alert-banner{display:flex;align-items:center;gap:10px;background:#FEF2F2;border:1.5px solid #FECACA;color:#B91C1C;border-radius:12px;padding:10px 14px;font-size:13px;font-weight:600;margin-bottom:16px;cursor:pointer;flex-wrap:wrap;}
  .alert-banner.warn{background:#FFFBEB;border-color:#FDE68A;color:#92400E;}
  .alert-banner.ok{background:#F0FDF4;border-color:#BBF7D0;color:#166534;cursor:default;}
  .notif-wrap{position:relative;}
  .notif-badge{position:absolute;top:-5px;right:-5px;min-width:18px;height:18px;padding:0 5px;border-radius:9px;background:#EF4444;color:#fff;font-size:10px;font-weight:800;display:flex;align-items:center;justify-content:center;border:2px solid #fff;pointer-events:none;}
  .notif-panel{position:absolute;top:44px;right:0;width:330px;max-width:calc(100vw - 32px);background:#fff;border:1px solid var(--border);border-radius:14px;box-shadow:var(--shadow-md);z-index:80;overflow:hidden;animation:fadeUp .2s ease;}
  .notif-head{padding:12px 14px;border-bottom:1px solid var(--border);font-weight:800;font-size:13px;display:flex;justify-content:space-between;align-items:center;}
  .notif-item{display:flex;gap:10px;align-items:flex-start;padding:10px 14px;border-bottom:1px solid var(--border);cursor:pointer;font-size:13px;}
  .notif-item:hover{background:var(--bg);} .notif-item:last-child{border-bottom:none;}
  .notif-dot{width:8px;height:8px;border-radius:50%;flex-shrink:0;margin-top:5px;}
  .pay-row{display:flex;gap:8px;}
  .pay-btn{flex:1;display:flex;align-items:center;justify-content:center;gap:8px;padding:12px;border-radius:12px;border:1.5px solid var(--border);background:#fff;font-size:14px;font-weight:700;cursor:pointer;font-family:inherit;color:var(--text);transition:all .15s;}
  .pay-btn.active{border-color:var(--primary);background:var(--primary-l);color:var(--primary);}
  .pay-inline{display:flex;gap:6px;flex-wrap:wrap;align-items:center;}
  .counter-modal{max-width:640px;}
  .counter-list{max-height:42vh;overflow-y:auto;border:1.5px solid var(--border);border-radius:12px;}
  .counter-cat{font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.4px;color:var(--text-soft);padding:8px 12px 4px;background:var(--bg);position:sticky;top:0;z-index:1;}
  .counter-item{display:flex;align-items:center;gap:10px;padding:8px 12px;border-bottom:1px solid var(--border);cursor:pointer;user-select:none;}
  .counter-item:last-child{border-bottom:none;} .counter-item.disabled{opacity:.45;cursor:not-allowed;} .counter-item.in-cart{background:#FFF7ED;}
  .counter-name{font-size:14px;font-weight:600;} .counter-price{font-size:12px;font-weight:600;color:var(--text-soft);}
  .stepper{display:flex;align-items:center;gap:6px;} .stepper button{width:30px;height:30px;border-radius:8px;border:1.5px solid var(--border);background:#fff;cursor:pointer;display:flex;align-items:center;justify-content:center;} .stepper span{min-width:22px;text-align:center;font-weight:800;font-size:14px;}
  .counter-total{display:flex;justify-content:space-between;align-items:center;font-family:'Sora',sans-serif;font-size:20px;font-weight:800;padding:12px 0;}
  .bar-chart{display:flex;align-items:flex-end;gap:6px;height:110px;margin-top:12px;}
  .bar-col{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;gap:4px;min-width:0;height:100%;}
  .bar-val{font-size:10px;font-weight:700;color:#64748B;white-space:nowrap;} .bar-lbl{font-size:10px;color:#94A3B8;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%;}
  .bar{width:100%;border-radius:5px 5px 0 0;background:var(--border);transition:height .4s;}
  .bar.hi{background:var(--primary);}
  .grid2{display:grid;grid-template-columns:1fr 1fr;gap:16px;}
  .grid2>*{min-width:0;}
  .card{min-width:0;}
  /* Tableaux → cartes empilées sur téléphone */
  @media(max-width:700px){
    .tbl-cards thead{display:none;}
    .tbl-cards,.tbl-cards tbody,.tbl-cards tr,.tbl-cards td{display:block;width:100%;}
    .tbl-cards tr{border:1.5px solid var(--border);border-radius:12px;padding:10px 12px;margin-bottom:10px;background:#fff;}
    .tbl-cards td{padding:4px 0;border:none;text-align:left!important;}
    .tbl-cards td[data-label]::before{content:attr(data-label);display:block;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.4px;color:var(--text-soft);margin-bottom:2px;}
    .tbl-cards td.td-inline{display:inline-block;width:auto;margin-right:14px;vertical-align:top;}
    .notif-panel{position:fixed;left:12px;right:12px;top:calc(12px + env(safe-area-inset-top));width:auto;max-width:none;}
  }
  .closure-row{display:flex;justify-content:space-between;gap:12px;padding:8px 0;border-bottom:1px solid var(--border);font-size:13px;} .closure-row:last-child{border-bottom:none;}
  .closure-hist{display:flex;align-items:center;gap:10px;padding:10px 12px;background:var(--bg);border-radius:10px;margin-bottom:8px;cursor:pointer;font-size:13px;flex-wrap:wrap;}
  .form-3col{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;}

  /* ═══════════ RESPONSIVE ═══════════ */
  @media(max-width:1200px){
    .staff-grid{grid-template-columns:repeat(2,1fr);}
  }
  /* Tablette & mobile : la sidebar devient une barre de navigation fixée en bas */
  @media(max-width:900px){
    .app{flex-direction:column;}
    .sidebar,.sidebar.collapsed{position:fixed;top:auto;bottom:0;left:0;right:0;width:100%;height:auto;min-height:0;flex-direction:row;align-items:stretch;z-index:120;padding:0 4px env(safe-area-inset-bottom);border-top:1px solid rgba(255,255,255,.08);box-shadow:0 -6px 24px rgba(0,0,0,.25);transition:none;overflow:visible;}
    .sb-logo,.sb-resto{display:none;}
    .sb-nav{flex-direction:row;flex:1;padding:0;gap:0;justify-content:space-around;}
    .sb-footer{padding:0;border:0;display:flex;align-items:stretch;}
    .sb-item,.sb-footer .sb-item{flex-direction:column;justify-content:center;gap:4px;padding:8px 2px 7px;border-radius:0;width:auto;min-width:0;flex:1;margin:0!important;}
    .sb-footer .sb-item{flex:0 0 46px;}
    .sb-footer .sb-label{display:none;}
    .sb-item.active{background:none;box-shadow:inset 0 3px 0 var(--primary);}
    .sb-icon{width:auto;}
    .sb-label{font-size:10px;font-weight:600;max-width:100%;overflow:hidden;text-overflow:ellipsis;}
    .sb-badge,.sb-badge.mini{margin:0;position:absolute;top:3px;left:calc(50% + 4px);right:auto;padding:1px 5px;font-size:10px;}
    .main{padding-bottom:calc(66px + env(safe-area-inset-bottom));}
    .topbar{flex-wrap:wrap;gap:10px;padding:10px 14px 12px;}
    .topbar>div:last-child{flex-wrap:wrap;gap:8px;width:100%;}
    .topbar-state{padding:7px 12px!important;font-size:12px!important;}
    .page-title{font-size:17px;}
    .page-sub{font-size:11px;}
    .sb-footer .sb-item.sb-client{display:none;}
    .ws-ind-label{display:none;}
    .oc-total{white-space:nowrap;}
    .ap-long{display:none;}
  }
  @media(max-width:420px){
    .kpi-val{font-size:20px;}
    .kpi-card{padding:12px;}          /* « Voir le site client » : dans Paramètres sur mobile */
    .content{padding:20px 16px;}
    .staff-grid{grid-template-columns:1fr;padding:12px;gap:12px;}
    .staff-topbar{padding:12px 16px;}
    .oc-actions{flex-wrap:wrap;}
    .modal-ov{align-items:flex-end;}
    .menu-modal{margin:0;border-radius:20px 20px 0 0;max-height:92dvh;padding:22px 18px calc(22px + env(safe-area-inset-bottom));}
    .pin-modal{margin:12px;padding:24px;}
    .kpi-row{grid-template-columns:repeat(2,1fr);gap:10px;}
    .kpi-card{padding:14px;}
    .kpi-val{font-size:22px;}
    .fi,.notes-inp,input[type=time],textarea,select{font-size:16px!important;}
  }
  @media(max-width:900px){
    .grid2{grid-template-columns:1fr;}
  }
  @media(max-width:560px){
    .form-3col{grid-template-columns:1fr 1fr;}
    .order-row{flex-wrap:wrap;row-gap:8px;}
    .order-row>div:first-child{flex:1 1 100%!important;}
    .order-row .status-badge{margin-left:18px;}
    .order-row .advance-btn{margin-left:auto;}
    .hours-row{flex-wrap:wrap;row-gap:8px;}
    .hours-times{margin-left:0!important;width:100%;flex-wrap:wrap;}
    .hours-times input[type=time]{flex:1 1 96px;min-width:0;width:auto;}
    .hours-times input{flex:1;min-width:0;}
    .menu-grid{grid-template-columns:1fr 1fr;gap:10px;}
    .filter-chip{padding:7px 11px;font-size:11px;}
    .staff-btn{flex:1 1 auto;justify-content:center;margin-top:0;padding:9px 12px;}
    .menu-add-btn{width:100%;justify-content:center;padding:12px 16px;}
  }
  @media(max-width:480px){
    .sb-label{display:none;}
    .sb-item,.sb-footer .sb-item{padding:11px 2px;}
  }
  @media(max-width:340px){
    .kpi-row{grid-template-columns:1fr;}
    .menu-grid{grid-template-columns:1fr;}
  }
  ${TOUCH_CSS}
`;