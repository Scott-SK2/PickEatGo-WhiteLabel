"use client";
import { TOUCH_CSS } from "../../lib/touch.css";
import { useHistoryPage } from "../../lib/useHistoryPage";
import { useState, useEffect, useCallback, useRef } from "react";
import { useAuth } from "../../lib/AuthContext";
import { apiFetch as coreFetch } from "../../lib/api";
import { useBrand } from "../../lib/BrandContext";
import InstanceCard, { useInstanceInfo } from "./instance";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000/api/v1";

// Client HTTP partagé : JWT avec refresh automatique, nouvelles tentatives si le serveur ne répond pas
const apiFetch = (endpoint, opts = {}) => coreFetch(endpoint, opts);
const get   = (url)       => apiFetch(url);
const patch = (url, body) => apiFetch(url, { method: "PATCH", body: JSON.stringify(body) });
const del   = (url)       => apiFetch(url, { method: "DELETE" });


const MODEL_LABELS = {
  commission:{label:"Commission",color:"#6366F1",bg:"#EEF2FF",desc:"% sur chaque commande"},
  abonnement:{label:"Abonnement",color:"#10B981",bg:"#ECFDF5",desc:"Frais mensuel fixe"},
  mixte:     {label:"Mixte",     color:"#F59E0B",bg:"#FFFBEB",desc:"Abonnement + commission réduite"},
};

const Sparkline = ({data,color}) => {
  const max=Math.max(...data),min=Math.min(...data),w=80,h=30;
  const pts=data.map((v,i)=>`${(i/(data.length-1))*w},${h-((v-min)/(max-min||1))*h}`).join(" ");
  return <svg width={w} height={h} style={{overflow:"visible"}}><polyline points={pts} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round"/><polyline points={`0,${h} ${pts} ${w},${h}`} fill={color} fillOpacity=".1" stroke="none"/></svg>;
};

const DonutChart = ({data}) => {
  const total=data.reduce((s,d)=>s+d.v,0)||1; let offset=0;
  const r=40,cx=50,cy=50,circ=2*Math.PI*r;
  return (
    <div style={{display:"flex",alignItems:"center",gap:24}}>
      <svg width={100} height={100} style={{transform:"rotate(-90deg)"}}>
        {data.map((d,i)=>{const pct=d.v/total,dash=pct*circ,seg=<circle key={i} cx={cx} cy={cy} r={r} fill="none" stroke={d.color} strokeWidth="14" strokeDasharray={`${dash} ${circ}`} strokeDashoffset={-offset*circ}/>;offset+=pct;return seg;})}
      </svg>
      <div style={{display:"flex",flexDirection:"column",gap:8}}>
        {data.map((d,i)=>(
          <div key={i} style={{display:"flex",alignItems:"center",gap:8}}>
            <div style={{width:10,height:10,borderRadius:3,background:d.color,flexShrink:0}}/>
            <span style={{fontSize:12,color:"#64748B"}}>{d.label}</span>
            <span style={{fontSize:12,fontWeight:700,color:"#1E293B",marginLeft:"auto",paddingLeft:8}}>{d.v}</span>
          </div>
        ))}
      </div>
    </div>
  );
};

const RestBadge = ({status}) => {
  const cfg={active:{label:"Actif",bg:"#DCFCE7",color:"#16A34A"},pending:{label:"En attente",bg:"#FEF9C3",color:"#CA8A04"},suspended:{label:"Suspendu",bg:"#FEE2E2",color:"#DC2626"}}[status]||{label:status,bg:"#F1F5F9",color:"#64748B"};
  return <span style={{background:cfg.bg,color:cfg.color,fontSize:11,fontWeight:700,padding:"3px 10px",borderRadius:20}}>{cfg.label}</span>;
};

const Toggle = ({on,onChange,label}) => (
  <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"12px 0",borderBottom:"1px solid #F1F5F9"}}>
    <span style={{fontSize:14,color:"#1E293B",fontWeight:500}}>{label}</span>
    <button onClick={()=>onChange(!on)} style={{width:44,height:24,borderRadius:12,background:on?"#6366F1":"#E2E8F0",border:"none",cursor:"pointer",position:"relative",transition:"background .2s",flexShrink:0}}>
      <div style={{width:18,height:18,borderRadius:"50%",background:"white",position:"absolute",top:3,left:on?23:3,transition:"left .2s",boxShadow:"0 1px 4px rgba(0,0,0,.2)"}}/>
    </button>
  </div>
);

/** Horloge du bandeau, isolée : seule elle se re-rend chaque seconde. */
function AdminClock(){
  const [now,setNow]=useState(new Date());
  useEffect(()=>{const t=setInterval(()=>setNow(new Date()),1000);return()=>clearInterval(t);},[]);
  return <p className="page-sub">{now.toLocaleDateString("fr-BE",{weekday:"long",day:"numeric",month:"long"})} · {now.toLocaleTimeString("fr-BE",{hour:"2-digit",minute:"2-digit"})}</p>;
}

const Ic = ({n,s=18,c="currentColor"}) => {
  const icons = {
    dashboard:  <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>,
    restaurants:<svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2"/><path d="M7 2v20"/><path d="M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3zm0 0v7"/></svg>,
    users:      <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>,
    reports:    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>,
    contracts:  <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/><line x1="6" y1="8" x2="14" y2="8"/><line x1="6" y1="12" x2="10" y2="12"/></svg>,
    stats:      <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>,
    settings:   <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06-.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>,
    check:      <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>,
    x:          <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>,
    ban:        <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>,
    unlock:     <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/></svg>,
    trash:      <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>,
    search:     <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>,
    bell:       <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>,
    star:       <svg width={s} height={s} viewBox="0 0 24 24" fill={c} stroke={c} strokeWidth="0.5"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>,
    euro:       <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round"><path d="M4 10h12M4 14h12"/><path d="M19 6a7 7 0 1 0 0 12"/></svg>,
    logout:     <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>,
    refresh:    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>,
    orders:     <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>,
    edit:       <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>,
    note:       <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>,
  };
  return icons[n] || null;
};

export default function AdminDashboard() {
  const {user, logout} = useAuth();
  // Édition Marque Blanche : en mode mono-restaurant, le rôle administration devient la console de l'éditeur
  // (fiche de l'instance, utilisateurs, signalements, statistiques) ; validation et contrats disparaissent.
  const brandCtx = useBrand();
  const single = brandCtx.single;
  const [instanceTick, setInstanceTick] = useState(0);
  const { info: instance, error: instanceError } = useInstanceInfo(single && !!user && user.role === "admin", get, instanceTick);

  const [page, setPage]               = useState("dashboard");
  useHistoryPage(page, setPage, { home: "dashboard", pages: ["dashboard","restaurants","users","contracts","reports","stats","settings","instance"] });   // bouton Retour du téléphone = écran précédent ; rechargement = même écran
  const [search, setSearch]           = useState("");
  const [restFilter, setRestFilter]   = useState("all");
  const [userFilter, setUserFilter]   = useState("all");
  const [selectedRest, setSelectedRest] = useState(null);
  const [selectedUser, setSelectedUser] = useState(null);
  const [confirmModal, setConfirmModal] = useState(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [toast, setToast]             = useState(null);
  const [loading, setLoading]         = useState(true);

  const [contractSelected, setContractSelected] = useState(null);
  const [contractEditMode, setContractEditMode] = useState(false);
  const [contractDraft, setContractDraft]       = useState(null);
  const [contractFilter, setContractFilter]     = useState("all");
  const [contractSearch, setContractSearch]     = useState("");
  const [contractSaving, setContractSaving]     = useState(false);

  const [restaurants, setRestaurants] = useState([]);
  const [users, setUsers]             = useState([]);
  const [orders, setOrders]           = useState([]);
  const [reports, setReports]         = useState([]);

  const toastTimer=useRef(null);
  const showToast=(msg,type="success")=>{setToast({msg,type});clearTimeout(toastTimer.current);toastTimer.current=setTimeout(()=>setToast(null),3000);};

  const loadAll = useCallback(async()=>{
    setLoading(true);
    try {
      const [rd,ud,od,rpd] = await Promise.all([
        get("/restaurants/?ordering=-created_at&page_size=100"),
        get("/auth/users/?page_size=100").catch(()=>({results:[]})),
        get("/orders/?ordering=-created_at&page_size=100").catch(()=>({results:[]})),
        get("/restaurants/reports/?ordering=-created_at&page_size=100").catch(()=>({results:[]})),
      ]);
      setRestaurants(rd.results||[]);
      setUsers(ud.results||[]);
      setOrders(od.results||[]);
      setReports(rpd.results||[]);
    } catch(e){showToast("Erreur : "+e.message,"error");}
    finally{setLoading(false);}
  },[]);
  useEffect(()=>{loadAll();},[loadAll]);

  const validateRest=async(id)=>{try{await patch(`/restaurants/${id}/validate/`,{});setRestaurants(p=>p.map(r=>r.id===id?{...r,status:"active"}:r));setConfirmModal(null);setSelectedRest(null);showToast("Restaurant validé ✓");}catch(e){showToast(e.message,"error");}};
  const suspendRest =async(id)=>{try{await patch(`/restaurants/${id}/suspend/`,{});setRestaurants(p=>p.map(r=>r.id===id?{...r,status:"suspended"}:r));setConfirmModal(null);setSelectedRest(null);showToast("Restaurant suspendu");}catch(e){showToast(e.message,"error");}};
  const deleteRest  =async(id)=>{try{await del(`/restaurants/${id}/`);setRestaurants(p=>p.filter(r=>r.id!==id));setConfirmModal(null);setSelectedRest(null);showToast("Supprimé");}catch(e){showToast(e.message,"error");}};
  const blockUser   =async(id)=>{try{await patch(`/auth/users/${id}/`,{is_active:false});setUsers(p=>p.map(u=>u.id===id?{...u,is_active:false}:u));setConfirmModal(null);setSelectedUser(null);showToast("Utilisateur bloqué");}catch(e){showToast(e.message,"error");}};
  const unblockUser =async(id)=>{try{await patch(`/auth/users/${id}/`,{is_active:true});setUsers(p=>p.map(u=>u.id===id?{...u,is_active:true}:u));setConfirmModal(null);showToast("Débloqué ✓");}catch(e){showToast(e.message,"error");}};
  const deleteUser  =async(id)=>{try{await del(`/auth/users/${id}/`);setUsers(p=>p.filter(u=>u.id!==id));setConfirmModal(null);setSelectedUser(null);showToast("Compte supprimé");}catch(e){showToast(e.message,"error");}};
  const resolveReport=async(id)=>{try{await patch(`/restaurants/reports/${id}/resolve/`,{});setReports(p=>p.map(r=>r.id===id?{...r,status:"resolved"}:r));showToast("Signalement résolu ✓");}catch(e){showToast(e.message,"error");}};
  const dismissReport=async(id)=>{try{await patch(`/restaurants/reports/${id}/`,{status:"dismissed"});setReports(p=>p.map(r=>r.id===id?{...r,status:"dismissed"}:r));showToast("Signalement classé");}catch(e){showToast(e.message,"error");}};

  const openContractView=(r)=>{setContractSelected(r);setContractDraft(null);setContractEditMode(false);};
  const openContractEdit=(r)=>{
    setContractSelected(r);
    setContractDraft({
      contract_model:r.contract_model||"commission",
      commission_pct:parseFloat(r.commission_pct||5),
      monthly_fee:parseFloat(r.monthly_fee||0),
      featured_fee:parseFloat(r.featured_fee||19),
      is_featured:r.is_featured||false,
      admin_manages_menu:r.admin_manages_menu||false,
      contract_paid:r.contract_paid||false,
      contract_notes:r.contract_notes||"",
      invoicing_day:r.invoicing_day||1,
    });
    setContractEditMode(true);
  };

  const saveContract=async()=>{
    if(!contractSelected||!contractDraft)return;
    setContractSaving(true);
    try{
      const num=(v,d=0)=>{const n=parseFloat(String(v??"").replace(",","."));return isNaN(n)?d:n;};
      const result=await patch(`/restaurants/${contractSelected.id}/contract/`,{...contractDraft,
        commission_pct:num(contractDraft.commission_pct),monthly_fee:num(contractDraft.monthly_fee),featured_fee:num(contractDraft.featured_fee),
        invoicing_day:Math.min(28,Math.max(1,parseInt(contractDraft.invoicing_day)||1))});
      setRestaurants(p=>p.map(r=>r.id===contractSelected.id?{...r,...result}:r));
      setContractSelected(p=>({...p,...result}));
      setContractEditMode(false);
      showToast("Contrat sauvegardé ✓");
    }catch(e){showToast(e.message,"error");}
    finally{setContractSaving(false);}
  };

  const markPaid=async(id)=>{
    try{
      const result=await patch(`/restaurants/${id}/contract/`,{contract_paid:true});
      setRestaurants(p=>p.map(r=>r.id===id?{...r,...result}:r));
      if(contractSelected?.id===id)setContractSelected(p=>({...p,...result}));
      showToast("Marqué comme payé ✓");
    }catch(e){showToast(e.message,"error");}
  };

  const pendingRests  =restaurants.filter(r=>r.status==="pending");
  const pendingReports=reports.filter(r=>r.status==="pending");
  const clientUsers   =users.filter(u=>u.role==="client");
  const restoUsers    =users.filter(u=>u.role==="restaurateur");
  const totalOrders   =orders.length;
  const totalDue      =restaurants.reduce((s,r)=>s+parseFloat(r.monthly_due||0),0);
  const unpaidCount   =restaurants.filter(r=>!r.contract_paid&&parseFloat(r.monthly_due||0)>0).length;
  const adminMenuCount=restaurants.filter(r=>r.admin_manages_menu).length;

  const filteredRests=restaurants.filter(r=>restFilter==="all"||r.status===restFilter).filter(r=>r.name?.toLowerCase().includes(search.toLowerCase())||r.owner_email?.toLowerCase().includes(search.toLowerCase()));
  const filteredUsers=users.filter(u=>u.role==="client"||u.role==="restaurateur").filter(u=>userFilter==="all"||(userFilter==="active"?u.is_active:!u.is_active)).filter(u=>u.first_name?.toLowerCase().includes(search.toLowerCase())||u.email?.toLowerCase().includes(search.toLowerCase()));
  const filteredContracts=restaurants.filter(r=>contractFilter==="all"||r.contract_model===contractFilter).filter(r=>r.name?.toLowerCase().includes(contractSearch.toLowerCase())||r.owner_email?.toLowerCase().includes(contractSearch.toLowerCase()));

  const _n=(v)=>{const n=parseFloat(String(v??"").replace(",","."));return isNaN(n)?0:n;};
  const calcPreview=(d,rev)=>{let t=0;if(d.contract_model==="commission"||d.contract_model==="mixte")t+=_n(rev)*_n(d.commission_pct)/100;if(d.contract_model==="abonnement"||d.contract_model==="mixte")t+=_n(d.monthly_fee);if(d.is_featured)t+=_n(d.featured_fee);return t.toFixed(2);};

  const NAV=(single?[
    {id:"dashboard",  label:"Dashboard",   icon:"dashboard",   badge:null},
    {id:"instance",   label:"Instance",    icon:"restaurants", badge:null},
    {id:"users",      label:"Utilisateurs",icon:"users",       badge:null},
    {id:"reports",    label:"Signalements",icon:"reports",     badge:pendingReports.length>0?pendingReports.length:null},
    {id:"stats",      label:"Statistiques",icon:"stats",       badge:null},
    {id:"settings",   label:"Paramètres",  icon:"settings",    badge:null},
  ]:[
    {id:"dashboard",  label:"Dashboard",   icon:"dashboard",   badge:null},
    {id:"restaurants",label:"Restaurants", icon:"restaurants", badge:pendingRests.length>0?pendingRests.length:null},
    {id:"users",      label:"Utilisateurs",icon:"users",       badge:null},
    {id:"reports",    label:"Signalements",icon:"reports",     badge:pendingReports.length>0?pendingReports.length:null},
    {id:"contracts",  label:"Contrats",    icon:"contracts",   badge:unpaidCount>0?unpaidCount:null},
    {id:"stats",      label:"Statistiques",icon:"stats",       badge:null},
    {id:"settings",   label:"Paramètres",  icon:"settings",    badge:null},
  ]);
  const revenueDone = orders.filter(o=>o.status==="recuperee").reduce((s,o)=>s+parseFloat(o.total_price||0),0);

  if(!user)return(<><style>{CSS}</style><div style={{display:"flex",alignItems:"center",justifyContent:"center",minHeight:"100vh",background:"#0F172A",color:"#fff",textAlign:"center"}}><div><p style={{fontSize:48,marginBottom:16}}>⚡</p><h2 style={{fontFamily:"'Sora',sans-serif",fontSize:24,marginBottom:12}}>Accès restreint</h2><button onClick={()=>window.location.href="/login"} style={{background:"#6366F1",color:"#fff",border:"none",borderRadius:12,padding:"12px 24px",fontSize:16,fontWeight:700,cursor:"pointer"}}>Se connecter</button></div></div></>);
  if(loading)return(<><style>{CSS}</style><div style={{display:"flex",alignItems:"center",justifyContent:"center",minHeight:"100vh",background:"#F8FAFC",flexDirection:"column",gap:16}}><div style={{width:40,height:40,border:"3px solid #E2E8F0",borderTop:"3px solid #6366F1",borderRadius:"50%",animation:"spin .8s linear infinite"}}/><p style={{color:"#64748B",fontFamily:"'Instrument Sans',sans-serif"}}>Chargement...</p></div></>);

  return (
    <><style>{CSS}</style>
    {toast&&<div style={{position:"fixed",top:"calc(12px + env(safe-area-inset-top))",right:12,left:12,maxWidth:"calc(100vw - 24px)",marginLeft:"auto",width:"max-content",zIndex:1000,background:toast.type==="error"?"#FEF2F2":"#DCFCE7",color:toast.type==="error"?"#DC2626":"#16A34A",border:`1.5px solid ${toast.type==="error"?"#FCA5A5":"#86EFAC"}`,borderRadius:12,padding:"12px 20px",fontWeight:700,fontSize:14,boxShadow:"0 8px 24px rgba(0,0,0,.12)",animation:"fadeUp .3s ease"}}>{toast.type==="error"?"⚠️":"✓"} {toast.msg}</div>}

    <div className="app">
      <aside className={`sidebar ${sidebarOpen?"":"collapsed"}`}>
        <div className="sb-logo" onClick={()=>setSidebarOpen(o=>!o)}>
          <div className="sb-logo-icon">⚡</div>
          {sidebarOpen&&<div><p className="sb-logo-title">{single?brandCtx.brand.app_name:"PickEatGo"}</p><p className="sb-logo-sub">{single?"Console éditeur":"Admin Panel"}</p></div>}
        </div>
        <nav className="sb-nav">
          {NAV.map(item=>(
            <button key={item.id} className={`sb-item ${page===item.id?"active":""}`} onClick={()=>{setPage(item.id);setSearch("");setContractSearch("");}}>
              <span className="sb-icon"><Ic n={item.icon} s={19} c={page===item.id?"#fff":"#94A3B8"}/></span>
              {sidebarOpen&&<span className="sb-label">{item.label}</span>}
              {item.badge&&<span className={`sb-badge ${!sidebarOpen?"mini":""}`}>{item.badge}</span>}
            </button>
          ))}
        </nav>
        <div className="sb-footer">
          <div className="sb-admin">
            <div className="sb-av">{user.first_name?.[0]||"A"}</div>
            {sidebarOpen&&<div><p className="sb-admin-name">{user.first_name} {user.last_name}</p><p className="sb-admin-role">{single?`Éditeur · ${brandCtx.platformName}`:"Super administrateur"}</p></div>}
          </div>
          <button className="sb-item" style={{marginTop:4}} onClick={()=>{logout();window.location.href="/login";}}>
            <span className="sb-icon"><Ic n="logout" s={17} c="#64748B"/></span>
            {sidebarOpen&&<span className="sb-label" style={{color:"#64748B"}}>Déconnexion</span>}
          </button>
        </div>
      </aside>

      <main className="main">
        <header className="topbar">
          <div>
            <h1 className="page-title">{{dashboard:"Vue d'ensemble",restaurants:"Restaurants",users:"Utilisateurs",reports:"Signalements",contracts:"Contrats & Facturation",stats:"Statistiques",settings:"Paramètres",instance:"Fiche de l'instance"}[page]}</h1>
            <AdminClock/>
          </div>
          <div style={{display:"flex",alignItems:"center",gap:12}}>
            {(pendingReports.length>0||pendingRests.length>0)&&(
              <div className="alert-pill" onClick={()=>setPage(pendingRests.length>0?"restaurants":"reports")}>
                <span className="live-dot"/>
                {pendingRests.length>0?`${pendingRests.length} restaurant(s) à valider`:`${pendingReports.length} signalement(s)`}
              </div>
            )}
            <button className="icon-btn-top" onClick={()=>{loadAll();setInstanceTick(t=>t+1);}}><Ic n="refresh" s={17} c="#64748B"/></button>
            <button className="icon-btn-top"><Ic n="bell" s={19} c="#64748B"/></button>
            <div className="admin-chip"><div className="admin-av">{user.first_name?.[0]||"A"}</div><span>Admin</span></div>
          </div>
        </header>

        <div className="content">

          {page==="dashboard"&&(
            <div className="fade-in">
              <div className="kpi-row">
                {(single?[
                  {label:"Commandes de l'instance",value:instance?.activity?.orders??totalOrders,sub:instance?.activity?.last_order_at?`dernière le ${new Date(instance.activity.last_order_at).toLocaleDateString("fr-BE")}`:"hors annulées",color:"#6366F1",icon:"orders",spark:null},
                  {label:"Chiffre d'affaires traité",value:`${parseFloat(instance?.activity?.revenue??revenueDone).toFixed(0)} €`,sub:"commandes récupérées",color:"#10B981",icon:"euro",spark:null},
                  {label:"Clients",value:instance?.activity?.clients??clientUsers.length,sub:`${instance?.activity?.active_clients_30d??0} actifs sur 30 jours`,color:"#F59E0B",icon:"users",spark:null},
                  {label:"Signalements",value:pendingReports.length,sub:pendingReports.length?"à traiter":"✓ aucun en attente",color:pendingReports.length?"#EF4444":"#64748B",icon:"reports",spark:null},
                ]:[
                  {label:"Restaurants actifs",value:restaurants.filter(r=>r.status==="active").length,sub:`/ ${restaurants.length} inscrits`,color:"#6366F1",icon:"restaurants",spark:[3,4,4,5,5,6,restaurants.filter(r=>r.status==="active").length]},
                  {label:"Utilisateurs clients",value:clientUsers.length,sub:`${restoUsers.length} restaurateurs`,color:"#10B981",icon:"users",spark:[45,52,58,61,67,71,clientUsers.length]},
                  {label:"Commandes totales",value:totalOrders,sub:"Toutes plateformes",color:"#F59E0B",icon:"orders",spark:[300,380,420,450,490,520,totalOrders]},
                  {label:"Revenus dus ce mois",value:`${totalDue.toFixed(0)} €`,sub:unpaidCount>0?`⚠ ${unpaidCount} impayé(s)`:"✓ Tout à jour",color:"#EF4444",icon:"euro",spark:[180,220,190,240,230,250,totalDue]},
                ]).map((k,i)=>(
                  <div key={i} className="kpi-card" style={{animationDelay:`${i*.07}s`}}>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:14}}>
                      <div><p className="kpi-label">{k.label}</p><p className="kpi-val">{k.value}</p><p className="kpi-sub">{k.sub}</p></div>
                      <div style={{width:44,height:44,borderRadius:12,background:k.color+"18",display:"flex",alignItems:"center",justifyContent:"center"}}><Ic n={k.icon} s={20} c={k.color}/></div>
                    </div>
                    {k.spark&&<Sparkline data={k.spark} color={k.color}/>}
                  </div>
                ))}
              </div>
              {single&&(
                <div className="card" style={{marginBottom:20}}>
                  <InstanceCard info={instance} error={instanceError} compact/>
                  <button className="link-btn" style={{marginTop:12}} onClick={()=>setPage("instance")}>Fiche complète et journal technique →</button>
                </div>
              )}
              <div className="dash-grid">
                {!single&&<div className="card">
                  <div className="card-hd"><h3 className="card-title">🕐 En attente de validation</h3><button className="link-btn" onClick={()=>setPage("restaurants")}>Voir tout →</button></div>
                  {pendingRests.length===0?<div className="empty-sm">✅ Aucun restaurant en attente</div>:pendingRests.map(r=>(
                    <div key={r.id} className="pending-row">
                      <span style={{fontSize:22}}>🏪</span>
                      <div style={{flex:1}}><p className="pending-name">{r.name}</p><p className="pending-sub">{r.owner_email||"—"} · {Array.isArray(r.cuisine)?r.cuisine.join(", "):r.cuisine||"—"}</p></div>
                      <div style={{display:"flex",gap:6}}>
                        <button className="act-btn green" onClick={()=>validateRest(r.id)}><Ic n="check" s={13} c="#16A34A"/></button>
                        <button className="act-btn red"   onClick={()=>suspendRest(r.id)}><Ic n="x"     s={13} c="#DC2626"/></button>
                      </div>
                    </div>
                  ))}
                </div>}
                {!single&&<div className="card">
                  <div className="card-hd"><h3 className="card-title">💰 Contrats impayés</h3><button className="link-btn" onClick={()=>setPage("contracts")}>Gérer →</button></div>
                  {restaurants.filter(r=>!r.contract_paid&&parseFloat(r.monthly_due||0)>0).length===0
                    ?<div className="empty-sm">✅ Toutes les factures sont à jour</div>
                    :restaurants.filter(r=>!r.contract_paid&&parseFloat(r.monthly_due||0)>0).map(r=>(
                      <div key={r.id} className="pending-row" style={{borderLeft:"3px solid #EF4444"}}>
                        <span style={{fontSize:22}}>🏪</span>
                        <div style={{flex:1}}><p className="pending-name">{r.name}</p><p className="pending-sub">{MODEL_LABELS[r.contract_model]?.label||r.contract_model}</p></div>
                        <span style={{fontFamily:"'Sora',sans-serif",fontWeight:800,color:"#EF4444",fontSize:14}}>{parseFloat(r.monthly_due||0).toFixed(2)} €</span>
                      </div>
                    ))}
                </div>}
                {!single&&<div className="card"><div className="card-hd"><h3 className="card-title">Statut restaurants</h3></div><DonutChart data={[{label:"Actifs",v:restaurants.filter(r=>r.status==="active").length,color:"#10B981"},{label:"En attente",v:restaurants.filter(r=>r.status==="pending").length,color:"#F59E0B"},{label:"Suspendus",v:restaurants.filter(r=>r.status==="suspended").length,color:"#EF4444"}]}/></div>}
                {single&&<div className="card"><div className="card-hd"><h3 className="card-title">📋 Signalements en attente</h3><button className="link-btn" onClick={()=>setPage("reports")}>Voir tout →</button></div>
                  {pendingReports.length===0?<div className="empty-sm">✅ Aucun signalement en attente</div>:pendingReports.slice(0,5).map(r=>(
                    <div key={r.id} className="pending-row"><span style={{fontSize:22}}>⚠️</span><div style={{flex:1}}><p className="pending-name">{r.reporter_name||"Client"}</p><p className="pending-sub">{r.reason}</p></div></div>
                  ))}
                </div>}
                <div className="card"><div className="card-hd"><h3 className="card-title">👥 Répartition utilisateurs</h3></div><DonutChart data={[{label:"Clients",v:clientUsers.length,color:"#6366F1"},{label:"Restaurateurs",v:restoUsers.length,color:"#10B981"},{label:"Bloqués",v:users.filter(u=>!u.is_active).length,color:"#EF4444"}]}/></div>
              </div>
            </div>
          )}

          {page==="instance"&&single&&(
            <div className="fade-in"><div className="card"><InstanceCard info={instance} error={instanceError}/></div></div>
          )}

          {page==="restaurants"&&!single&&(
            <div className="fade-in">
              <div className="toolbar">
                <div className="search-bar"><Ic n="search" s={16} c="#94A3B8"/><input placeholder="Rechercher..." value={search} onChange={e=>setSearch(e.target.value)}/></div>
                <div className="filter-chips">
                  {[["all","Tous"],["active","Actifs"],["pending","En attente"],["suspended","Suspendus"]].map(([f,l])=>(
                    <button key={f} className={`chip ${restFilter===f?"active":""}`} onClick={()=>setRestFilter(f)}>{l}<span className="chip-count">{f==="all"?restaurants.length:restaurants.filter(r=>r.status===f).length}</span></button>
                  ))}
                </div>
              </div>
              <div className="table-wrap">
                <table className="data-table">
                  <thead><tr><th>Restaurant</th><th>Propriétaire</th><th>Cuisine</th><th>Commandes</th><th>Note</th><th>Statut</th><th>Actions</th></tr></thead>
                  <tbody>
                    {filteredRests.map(r=>(
                      <tr key={r.id} className="table-row" onClick={()=>setSelectedRest(r)}>
                        <td><div style={{display:"flex",alignItems:"center",gap:10}}><span style={{fontSize:22}}>🏪</span><div><p className="td-main">{r.name}</p><p className="td-sub">{r.address?.split(",")[0]}</p></div></div></td>
                        <td><p className="td-main">{r.owner_name||"—"}</p><p className="td-sub">{r.owner_email||"—"}</p></td>
                        <td><span className="cuisine-tag">{Array.isArray(r.cuisine)?r.cuisine.join(", "):r.cuisine||"—"}</span></td>
                        <td className="td-num">{r.total_orders||0}</td>
                        <td>{r.avg_rating?<span style={{display:"flex",alignItems:"center",gap:4}}><Ic n="star" s={13} c="#F59E0B"/><span style={{fontSize:13,fontWeight:700}}>{parseFloat(r.avg_rating).toFixed(1)}</span></span>:<span style={{color:"#94A3B8",fontSize:12}}>—</span>}</td>
                        <td><RestBadge status={r.status}/></td>
                        <td onClick={e=>e.stopPropagation()}><div style={{display:"flex",gap:6}}>
                          {r.status==="pending"   &&<button className="act-btn green"  onClick={()=>validateRest(r.id)}><Ic n="check"  s={13} c="#16A34A"/></button>}
                          {r.status==="active"    &&<button className="act-btn yellow" onClick={()=>setConfirmModal({type:"suspend_rest",id:r.id,name:r.name})}><Ic n="ban" s={13} c="#CA8A04"/></button>}
                          {r.status==="suspended" &&<button className="act-btn green"  onClick={()=>validateRest(r.id)}><Ic n="unlock" s={13} c="#16A34A"/></button>}
                          <button className="act-btn red"    onClick={()=>setConfirmModal({type:"delete_rest",id:r.id,name:r.name})}><Ic n="trash" s={13} c="#DC2626"/></button>
                          <button className="act-btn indigo" onClick={()=>{setPage("contracts");openContractEdit(r);}} title="Contrat"><Ic n="contracts" s={13} c="#6366F1"/></button>
                        </div></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {filteredRests.length===0&&<div className="empty-sm">Aucun restaurant trouvé</div>}
              </div>
              {selectedRest&&(
                <div className="detail-panel" onClick={()=>setSelectedRest(null)}>
                  <div className="detail-box" onClick={e=>e.stopPropagation()}>
                    <div className="detail-header">
                      <div style={{display:"flex",alignItems:"center",gap:12}}><span style={{fontSize:36}}>🏪</span><div><h3 className="detail-name">{selectedRest.name}</h3><RestBadge status={selectedRest.status}/></div></div>
                      <button className="icon-btn-top" onClick={()=>setSelectedRest(null)}><Ic n="x" s={18} c="#64748B"/></button>
                    </div>
                    <div className="detail-grid">
                      {[["Propriétaire",selectedRest.owner_name||"—"],["Email",selectedRest.owner_email||"—"],["Téléphone",selectedRest.phone||"—"],["Adresse",selectedRest.address||"—"],["Cuisine",Array.isArray(selectedRest.cuisine)?selectedRest.cuisine.join(", "):selectedRest.cuisine||"—"],["Commandes",selectedRest.total_orders||0],["Note",selectedRest.avg_rating?`⭐ ${parseFloat(selectedRest.avg_rating).toFixed(1)}/5`:"—"],["Contrat",MODEL_LABELS[selectedRest.contract_model]?.label||"—"]].map(([k,v])=>(
                        <div key={k} className="detail-field"><p className="detail-key">{k}</p><p className="detail-val">{v}</p></div>
                      ))}
                    </div>
                    <div className="detail-footer">
                      {selectedRest.status==="pending"   &&<button className="full-btn green"  onClick={()=>validateRest(selectedRest.id)}>✓ Valider</button>}
                      {selectedRest.status==="active"    &&<button className="full-btn yellow" onClick={()=>setConfirmModal({type:"suspend_rest",id:selectedRest.id,name:selectedRest.name})}>⊘ Suspendre</button>}
                      {selectedRest.status==="suspended" &&<button className="full-btn green"  onClick={()=>validateRest(selectedRest.id)}>↺ Réactiver</button>}
                      <button className="full-btn red"    onClick={()=>setConfirmModal({type:"delete_rest",id:selectedRest.id,name:selectedRest.name})}>✕ Supprimer</button>
                      <button className="full-btn indigo" onClick={()=>{setPage("contracts");openContractEdit(selectedRest);setSelectedRest(null);}}>📋 Gérer le contrat</button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {page==="users"&&(
            <div className="fade-in">
              <div className="toolbar">
                <div className="search-bar"><Ic n="search" s={16} c="#94A3B8"/><input placeholder="Rechercher..." value={search} onChange={e=>setSearch(e.target.value)}/></div>
                <div className="filter-chips">
                  {[["all","Tous"],["active","Actifs"],["blocked","Bloqués"]].map(([f,l])=>(
                    <button key={f} className={`chip ${userFilter===f?"active":""}`} onClick={()=>setUserFilter(f)}>{l}<span className="chip-count">{f==="all"?filteredUsers.length:f==="active"?filteredUsers.filter(u=>u.is_active).length:filteredUsers.filter(u=>!u.is_active).length}</span></button>
                  ))}
                </div>
              </div>
              <div className="table-wrap">
                <table className="data-table">
                  <thead><tr><th>Utilisateur</th><th>Email</th><th>Rôle</th><th>Inscrit le</th><th>Statut</th><th>Actions</th></tr></thead>
                  <tbody>
                    {filteredUsers.map(u=>(
                      <tr key={u.id} className="table-row" onClick={()=>setSelectedUser(u)}>
                        <td><div style={{display:"flex",alignItems:"center",gap:10}}><div className="user-av-sm">{u.first_name?.[0]||"?"}</div><p className="td-main">{u.first_name} {u.last_name}</p></div></td>
                        <td><p className="td-sub">{u.email}</p></td>
                        <td><span className="cuisine-tag" style={{background:u.role==="restaurateur"?"#FFF7ED":"#EFF6FF",color:u.role==="restaurateur"?"#C2410C":"#1D4ED8"}}>{u.role}</span></td>
                        <td className="td-sub">{u.created_at?.split("T")[0]||"—"}</td>
                        <td><span style={{background:u.is_active?"#DCFCE7":"#FEE2E2",color:u.is_active?"#16A34A":"#DC2626",fontSize:11,fontWeight:700,padding:"3px 10px",borderRadius:20}}>{u.is_active?"Actif":"Bloqué"}</span></td>
                        <td onClick={e=>e.stopPropagation()}><div style={{display:"flex",gap:6}}>
                          {u.is_active?<button className="act-btn yellow" onClick={()=>setConfirmModal({type:"block_user",id:u.id,name:`${u.first_name} ${u.last_name}`})}><Ic n="ban" s={13} c="#CA8A04"/></button>:<button className="act-btn green" onClick={()=>unblockUser(u.id)}><Ic n="unlock" s={13} c="#16A34A"/></button>}
                          <button className="act-btn red" onClick={()=>setConfirmModal({type:"delete_user",id:u.id,name:`${u.first_name} ${u.last_name}`})}><Ic n="trash" s={13} c="#DC2626"/></button>
                        </div></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {filteredUsers.length===0&&<div className="empty-sm">Aucun utilisateur trouvé</div>}
              </div>
              {selectedUser&&(
                <div className="detail-panel" onClick={()=>setSelectedUser(null)}>
                  <div className="detail-box" onClick={e=>e.stopPropagation()}>
                    <div className="detail-header">
                      <div style={{display:"flex",alignItems:"center",gap:12}}><div className="user-av-lg">{selectedUser.first_name?.[0]||"?"}</div><div><h3 className="detail-name">{selectedUser.first_name} {selectedUser.last_name}</h3><span style={{background:selectedUser.is_active?"#DCFCE7":"#FEE2E2",color:selectedUser.is_active?"#16A34A":"#DC2626",fontSize:11,fontWeight:700,padding:"3px 10px",borderRadius:20}}>{selectedUser.is_active?"Actif":"Bloqué"}</span></div></div>
                      <button className="icon-btn-top" onClick={()=>setSelectedUser(null)}><Ic n="x" s={18} c="#64748B"/></button>
                    </div>
                    <div className="detail-grid">
                      {[["Email",selectedUser.email],["Rôle",selectedUser.role],["Inscrit",selectedUser.created_at?.split("T")[0]||"—"],["Statut",selectedUser.is_active?"Actif":"Bloqué"]].map(([k,v])=>(
                        <div key={k} className="detail-field"><p className="detail-key">{k}</p><p className="detail-val">{v}</p></div>
                      ))}
                    </div>
                    <div className="detail-footer">
                      {selectedUser.is_active?<button className="full-btn yellow" onClick={()=>setConfirmModal({type:"block_user",id:selectedUser.id,name:`${selectedUser.first_name} ${selectedUser.last_name}`})}>⊘ Bloquer</button>:<button className="full-btn green" onClick={()=>unblockUser(selectedUser.id)}>↺ Débloquer</button>}
                      <button className="full-btn red" onClick={()=>setConfirmModal({type:"delete_user",id:selectedUser.id,name:`${selectedUser.first_name} ${selectedUser.last_name}`})}>✕ Supprimer</button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {page==="reports"&&(
            <div className="fade-in">
              <div style={{display:"flex",gap:12,marginBottom:20,flexWrap:"wrap"}}>
                {[{label:"En attente",count:reports.filter(r=>r.status==="pending").length,color:"#F59E0B"},{label:"Résolus",count:reports.filter(r=>r.status==="resolved").length,color:"#10B981"},{label:"Classés",count:reports.filter(r=>r.status==="dismissed").length,color:"#94A3B8"}].map((s,i)=>(
                  <div key={i} className="report-stat"><span style={{fontSize:22,fontWeight:800,color:s.color}}>{s.count}</span><span style={{fontSize:12,color:"#64748B",fontWeight:600}}>{s.label}</span></div>
                ))}
              </div>
              {reports.length===0?<div className="card"><div className="empty-sm">✅ Aucun signalement</div></div>:(
                <div style={{display:"flex",flexDirection:"column",gap:12}}>
                  {reports.map(r=>(
                    <div key={r.id} className={`report-card ${r.status}`}>
                      <div className="report-card-header">
                        <div style={{display:"flex",alignItems:"center",gap:10}}>
                          <div className="report-type-badge">🍽️ Restaurant</div>
                          {r.severity&&<span style={{background:"#FEF9C3",color:"#92400E",fontSize:11,fontWeight:700,padding:"3px 8px",borderRadius:20}}>{r.severity}</span>}
                          <span style={{fontSize:12,color:"#64748B"}}>{r.created_at?.split("T")[0]}</span>
                        </div>
                        <span className="report-status-tag">{r.status==="pending"?"⏳ En attente":r.status==="resolved"?"✅ Résolu":"🗂 Classé"}</span>
                      </div>
                      <div className="report-body">
                        <div style={{flex:1}}><p className="report-label">Restaurant</p><p className="report-val">{r.restaurant_name||"—"}</p></div>
                        <div className="report-arrow">→</div>
                        <div style={{flex:1}}><p className="report-label">Signalé par</p><p className="report-val">{r.reporter_name||"Anonyme"}</p></div>
                      </div>
                      <div className="report-reason-box"><span>📝</span> {r.reason}</div>
                      {r.status==="pending"&&(
                        <div className="report-actions">
                          <button className="full-btn green sm" onClick={()=>resolveReport(r.id)}><Ic n="check" s={13} c="white"/> Résoudre</button>
                          <button className="full-btn grey sm"  onClick={()=>dismissReport(r.id)}>Classer sans suite</button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {page==="contracts"&&!single&&(
            <div className="fade-in">
              <div className="kpi-stripe">
                <div className="kpi-stripe-item"><p className="kpi-stripe-l">Revenus dus ce mois</p><p className="kpi-stripe-v" style={{color:"#6366F1"}}>{totalDue.toFixed(2)} €</p></div>
                <div className="kpi-stripe-sep"/>
                <div className="kpi-stripe-item"><p className="kpi-stripe-l">Factures impayées</p><p className="kpi-stripe-v" style={{color:unpaidCount>0?"#EF4444":"#10B981"}}>{unpaidCount>0?`${unpaidCount} en retard`:"✓ Tout à jour"}</p></div>
                <div className="kpi-stripe-sep"/>
                <div className="kpi-stripe-item"><p className="kpi-stripe-l">Menus gérés admin</p><p className="kpi-stripe-v" style={{color:adminMenuCount>0?"#F59E0B":"#64748B"}}>{adminMenuCount} restaurant{adminMenuCount>1?"s":""}</p></div>
                <div className="kpi-stripe-sep"/>
                <div className="kpi-stripe-item"><p className="kpi-stripe-l">Partenaires actifs</p><p className="kpi-stripe-v">{restaurants.filter(r=>r.status==="active").length} / {restaurants.length}</p></div>
              </div>
              <div className="toolbar">
                <div className="search-bar"><Ic n="search" s={16} c="#94A3B8"/><input placeholder="Rechercher un restaurant..." value={contractSearch} onChange={e=>setContractSearch(e.target.value)}/></div>
                <div className="filter-chips">
                  {[["all","Tous"],["commission","Commission"],["abonnement","Abonnement"],["mixte","Mixte"]].map(([f,l])=>(
                    <button key={f} className={`chip ${contractFilter===f?"active":""}`} onClick={()=>setContractFilter(f)}>{l}</button>
                  ))}
                </div>
              </div>
              <div className="contracts-layout">
                <div style={{display:"flex",flexDirection:"column",gap:12}}>
                  {filteredContracts.map(r=>{
                    const due=parseFloat(r.monthly_due||0),ml=MODEL_LABELS[r.contract_model]||MODEL_LABELS.commission,isSel=contractSelected?.id===r.id;
                    return(
                      <div key={r.id} className={`rc ${isSel?"rc-active":""} ${!r.contract_paid&&due>0?"rc-unpaid":""}`} onClick={()=>openContractView(r)}>
                        <div className="rc-top">
                          <span style={{fontSize:28,flexShrink:0}}>🏪</span>
                          <div style={{flex:1}}>
                            <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:2}}>
                              <p className="rc-name">{r.name}</p>
                              {r.admin_manages_menu&&<span className="tag-admin-menu">👨‍💼 Admin menu</span>}
                              <RestBadge status={r.status}/>
                            </div>
                            <p className="rc-owner">{r.owner_email||"—"}</p>
                          </div>
                          <div style={{display:"flex",flexDirection:"column",alignItems:"flex-end",gap:4}}>
                            <span className="model-pill" style={{background:ml.bg,color:ml.color}}>{ml.label}</span>
                            {!r.contract_paid&&due>0&&<span className="tag-unpaid">⚠ Impayé</span>}
                          </div>
                        </div>
                        <div className="rc-bottom">
                          <div className="rc-metric"><p className="rc-ml">Dû ce mois</p><p className="rc-mv" style={{color:"#6366F1"}}>{due.toFixed(2)} €</p></div>
                          <div className="rc-metric"><p className="rc-ml">Revenu</p><p className="rc-mv">{parseFloat(r.total_revenue||0).toFixed(0)} €</p></div>
                          <div className="rc-metric"><p className="rc-ml">Commandes</p><p className="rc-mv">{r.total_orders||0}</p></div>
                          <button className="rc-edit-btn" onClick={e=>{e.stopPropagation();openContractEdit(r);}}><Ic n="edit" s={13} c="#6366F1"/> Modifier</button>
                        </div>
                      </div>
                    );
                  })}
                  {filteredContracts.length===0&&<div className="card"><div className="empty-sm">Aucun restaurant trouvé</div></div>}
                </div>

                {contractSelected&&(
                  <div className="cp">
                    <div className="cp-header">
                      <div style={{display:"flex",alignItems:"center",gap:12}}>
                        <span style={{fontSize:32}}>🏪</span>
                        <div><h2 className="cp-name">{contractSelected.name}</h2><p className="cp-owner">{contractSelected.owner_email}</p></div>
                      </div>
                      <div style={{display:"flex",gap:8}}>
                        {!contractEditMode&&<button className="cp-edit-btn" onClick={()=>openContractEdit(contractSelected)}><Ic n="edit" s={14} c="#6366F1"/> Modifier</button>}
                        <button className="cp-close-btn" onClick={()=>{setContractSelected(null);setContractEditMode(false);}}><Ic n="x" s={15} c="#64748B"/></button>
                      </div>
                    </div>
                    <div className="cp-body">
                      {!contractEditMode&&(
                        <>
                          <div className="calc-box">
                            <p className="calc-title">💰 Calcul automatique ce mois</p>
                            <div className="calc-rows">
                              {(contractSelected.contract_model==="commission"||contractSelected.contract_model==="mixte")&&(
                                <div className="calc-row"><span>Commission {contractSelected.commission_pct}% sur {parseFloat(contractSelected.total_revenue||0).toFixed(0)} €</span><span className="calc-amt">+ {(parseFloat(contractSelected.total_revenue||0)*parseFloat(contractSelected.commission_pct||0)/100).toFixed(2)} €</span></div>
                              )}
                              {(contractSelected.contract_model==="abonnement"||contractSelected.contract_model==="mixte")&&parseFloat(contractSelected.monthly_fee||0)>0&&(
                                <div className="calc-row"><span>Abonnement mensuel</span><span className="calc-amt">+ {parseFloat(contractSelected.monthly_fee||0).toFixed(2)} €</span></div>
                              )}
                              {contractSelected.is_featured&&parseFloat(contractSelected.featured_fee||0)>0&&(
                                <div className="calc-row"><span>Mise en avant</span><span className="calc-amt">+ {parseFloat(contractSelected.featured_fee||0).toFixed(2)} €</span></div>
                              )}
                              <div className="calc-total"><span>Total dû</span><span>{parseFloat(contractSelected.monthly_due||0).toFixed(2)} €</span></div>
                            </div>
                            <div className="calc-footer">
                              <div>
                                <p style={{fontSize:11,color:"#64748B",marginBottom:4}}>Paiement</p>
                                <span style={{fontSize:11,fontWeight:700,padding:"3px 10px",borderRadius:20,background:contractSelected.contract_paid?"#DCFCE7":"#FEE2E2",color:contractSelected.contract_paid?"#16A34A":"#DC2626"}}>{contractSelected.contract_paid?"✓ Payé":"⚠ En attente"}</span>
                              </div>
                              {!contractSelected.contract_paid&&parseFloat(contractSelected.monthly_due||0)>0&&(
                                <button className="btn-paid" onClick={()=>markPaid(contractSelected.id)}><Ic n="check" s={13} c="white"/> Marquer payé</button>
                              )}
                            </div>
                          </div>
                          <div className="cp-section"><p className="cp-section-title">Modèle contractuel</p>
                            <div className="info-grid2">
                              {[["Modèle",<span key="m" className="model-pill lg" style={{background:MODEL_LABELS[contractSelected.contract_model]?.bg,color:MODEL_LABELS[contractSelected.contract_model]?.color}}>{MODEL_LABELS[contractSelected.contract_model]?.label||contractSelected.contract_model}</span>],["Commission",parseFloat(contractSelected.commission_pct||0)>0?`${contractSelected.commission_pct}%`:"—"],["Abonnement",parseFloat(contractSelected.monthly_fee||0)>0?`${parseFloat(contractSelected.monthly_fee).toFixed(2)} €`:"—"],["Mise en avant",contractSelected.is_featured?`${parseFloat(contractSelected.featured_fee||0).toFixed(2)} €/mois`:"Non"],["Facturation le",`${contractSelected.invoicing_day||1} du mois`],["Admin menu",contractSelected.admin_manages_menu?"✓ Oui":"Non"]].map(([k,v])=>(
                                <div key={k} className="info-cell"><p className="info-k">{k}</p><p className="info-v">{v}</p></div>
                              ))}
                            </div>
                          </div>
                          {contractSelected.contract_notes&&(
                            <div className="cp-section"><p className="cp-section-title">Notes internes</p>
                              <div className="notes-box"><Ic n="note" s={14} c="#94A3B8"/><p style={{fontSize:13,color:"#4B5563",lineHeight:1.6}}>{contractSelected.contract_notes}</p></div>
                            </div>
                          )}
                        </>
                      )}
                      {contractEditMode&&contractDraft&&(
                        <>
                          <div className="cp-section"><p className="cp-section-title">Modèle de facturation</p>
                            <div className="model-selector">
                              {Object.entries(MODEL_LABELS).map(([key,ml])=>(
                                <button key={key} className={`model-option ${contractDraft.contract_model===key?"mo-active":""}`} style={contractDraft.contract_model===key?{borderColor:ml.color,background:ml.bg}:{}} onClick={()=>setContractDraft(d=>({...d,contract_model:key}))}>
                                  <p className="mo-label" style={contractDraft.contract_model===key?{color:ml.color}:{}}>{ml.label}</p>
                                  <p className="mo-desc">{ml.desc}</p>
                                </button>
                              ))}
                            </div>
                          </div>
                          <div className="cp-section"><p className="cp-section-title">Conditions financières</p>
                            <div style={{display:"flex",flexDirection:"column",gap:14}}>
                              {(contractDraft.contract_model==="commission"||contractDraft.contract_model==="mixte")&&(
                                <div>
                                  <label className="field-lbl">Commission (%)</label>
                                  <div style={{display:"flex",alignItems:"center",gap:8}}>
                                    <input type="text" inputMode="decimal" className="field-inp" value={contractDraft.commission_pct} onChange={e=>setContractDraft(d=>({...d,commission_pct:e.target.value}))}/>
                                    <span style={{fontSize:13,color:"#64748B"}}>%</span>
                                  </div>
                                  <p style={{fontSize:12,color:"#6366F1",marginTop:5,fontWeight:500}}>→ Sur {parseFloat(contractSelected.total_revenue||0).toFixed(0)} € = <strong>{(parseFloat(contractSelected.total_revenue||0)*contractDraft.commission_pct/100).toFixed(2)} €</strong></p>
                                </div>
                              )}
                              {(contractDraft.contract_model==="abonnement"||contractDraft.contract_model==="mixte")&&(
                                <div>
                                  <label className="field-lbl">Abonnement mensuel (€)</label>
                                  <div style={{display:"flex",alignItems:"center",gap:8}}>
                                    <input type="text" inputMode="decimal" className="field-inp" value={contractDraft.monthly_fee} onChange={e=>setContractDraft(d=>({...d,monthly_fee:e.target.value}))}/>
                                    <span style={{fontSize:13,color:"#64748B"}}>€/mois</span>
                                  </div>
                                </div>
                              )}
                              <div>
                                <label className="field-lbl">Jour de facturation</label>
                                <div style={{display:"flex",alignItems:"center",gap:8}}>
                                  <input type="text" inputMode="numeric" className="field-inp" value={contractDraft.invoicing_day} onChange={e=>setContractDraft(d=>({...d,invoicing_day:e.target.value}))}/>
                                  <span style={{fontSize:13,color:"#64748B"}}>du mois</span>
                                </div>
                              </div>
                            </div>
                          </div>
                          <div className="cp-section"><p className="cp-section-title">Options</p>
                            <Toggle label="Mise en avant sur la plateforme" on={contractDraft.is_featured} onChange={v=>setContractDraft(d=>({...d,is_featured:v}))}/>
                            {contractDraft.is_featured&&(
                              <div style={{marginTop:10}}>
                                <label className="field-lbl">Tarif mise en avant (€/mois)</label>
                                <div style={{display:"flex",alignItems:"center",gap:8}}>
                                  <input type="text" inputMode="decimal" className="field-inp" value={contractDraft.featured_fee} onChange={e=>setContractDraft(d=>({...d,featured_fee:e.target.value}))}/>
                                  <span style={{fontSize:13,color:"#64748B"}}>€/mois</span>
                                </div>
                              </div>
                            )}
                            <Toggle label="Admin gère le menu de ce restaurant" on={contractDraft.admin_manages_menu} onChange={v=>setContractDraft(d=>({...d,admin_manages_menu:v}))}/>
                            {contractDraft.admin_manages_menu&&<div className="banner-yellow">👨‍💼 Vous aurez accès complet au menu. Le restaurateur ne pourra plus modifier son menu.</div>}
                            <Toggle label="Marquer comme payé ce mois" on={contractDraft.contract_paid} onChange={v=>setContractDraft(d=>({...d,contract_paid:v}))}/>
                          </div>
                          <div className="cp-section"><p className="cp-section-title">Notes internes</p>
                            <textarea className="notes-inp" rows={3} placeholder="Conditions négociées, historique..." value={contractDraft.contract_notes} onChange={e=>setContractDraft(d=>({...d,contract_notes:e.target.value}))}/>
                          </div>
                          <div className="preview-box">
                            <p style={{fontSize:11,fontWeight:700,color:"#64748B",textTransform:"uppercase",letterSpacing:".5px",marginBottom:12}}>Aperçu calcul mensuel</p>
                            <div className="calc-rows">
                              {(contractDraft.contract_model==="commission"||contractDraft.contract_model==="mixte")&&<div className="calc-row"><span>Commission {contractDraft.commission_pct}%</span><span className="calc-amt">+ {(parseFloat(contractSelected.total_revenue||0)*contractDraft.commission_pct/100).toFixed(2)} €</span></div>}
                              {(contractDraft.contract_model==="abonnement"||contractDraft.contract_model==="mixte")&&contractDraft.monthly_fee>0&&<div className="calc-row"><span>Abonnement</span><span className="calc-amt">+ {parseFloat(contractDraft.monthly_fee).toFixed(2)} €</span></div>}
                              {contractDraft.is_featured&&contractDraft.featured_fee>0&&<div className="calc-row"><span>Mise en avant</span><span className="calc-amt">+ {parseFloat(contractDraft.featured_fee).toFixed(2)} €</span></div>}
                              <div className="calc-total"><span>Total</span><span>{calcPreview(contractDraft,contractSelected.total_revenue)} €</span></div>
                            </div>
                          </div>
                        </>
                      )}
                    </div>
                    {contractEditMode&&(
                      <div className="cp-footer">
                        <button className="cp-btn-cancel" onClick={()=>setContractEditMode(false)}>Annuler</button>
                        <button className="cp-btn-save" onClick={saveContract} disabled={contractSaving}>
                          {contractSaving?<><div style={{width:14,height:14,border:"2px solid rgba(255,255,255,.3)",borderTop:"2px solid white",borderRadius:"50%",animation:"spin .8s linear infinite",display:"inline-block",marginRight:8}}/> Sauvegarde...</>:<><Ic n="check" s={14} c="white"/> Sauvegarder</>}
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}

          {page==="stats"&&(
            <div className="fade-in">
              <div className="kpi-row" style={{marginBottom:24}}>
                {(single
                  ?[{label:"Commandes",value:instance?.activity?.orders??totalOrders,color:"#6366F1"},{label:"Chiffre d'affaires traité",value:`${parseFloat(instance?.activity?.revenue??revenueDone).toFixed(0)} €`,color:"#10B981"},{label:"Clients inscrits",value:clientUsers.length,color:"#F59E0B"},{label:"Clients actifs (30 j)",value:instance?.activity?.active_clients_30d??"—",color:"#EF4444"}]
                  :[{label:"Commandes totales",value:totalOrders,color:"#6366F1"},{label:"Restaurants actifs",value:restaurants.filter(r=>r.status==="active").length,color:"#10B981"},{label:"Clients inscrits",value:clientUsers.length,color:"#F59E0B"},{label:"Revenus ce mois",value:`${totalDue.toFixed(0)} €`,color:"#EF4444"}]).map((k,i)=>(
                  <div key={i} className="kpi-card" style={{animationDelay:`${i*.07}s`}}><p className="kpi-label">{k.label}</p><p className="kpi-val" style={{color:k.color}}>{k.value}</p></div>
                ))}
              </div>
              <div className="dash-grid">
                {single&&<div className="card"><div className="card-hd"><h3 className="card-title">Commandes par statut</h3></div><DonutChart data={[{label:"Récupérées",v:orders.filter(o=>o.status==="recuperee").length,color:"#10B981"},{label:"En cours",v:orders.filter(o=>!["recuperee","annulee"].includes(o.status)).length,color:"#F59E0B"},{label:"Annulées",v:orders.filter(o=>o.status==="annulee").length,color:"#EF4444"}]}/></div>}
                {single&&<div className="card"><div className="card-hd"><h3 className="card-title">Modes de commande</h3></div><DonutChart data={[{label:"À emporter",v:orders.filter(o=>o.order_type==="emporter").length,color:"#6366F1"},{label:"Sur place",v:orders.filter(o=>o.order_type==="sur_place").length,color:"#10B981"},{label:"Livraison",v:orders.filter(o=>o.order_type==="livraison").length,color:"#0EA5E9"},{label:"Comptoir",v:orders.filter(o=>o.order_type==="comptoir").length,color:"#F59E0B"}]}/></div>}
                {!single&&<div className="card"><div className="card-hd"><h3 className="card-title">Statut restaurants</h3></div><DonutChart data={[{label:"Actifs",v:restaurants.filter(r=>r.status==="active").length,color:"#10B981"},{label:"En attente",v:restaurants.filter(r=>r.status==="pending").length,color:"#F59E0B"},{label:"Suspendus",v:restaurants.filter(r=>r.status==="suspended").length,color:"#EF4444"}]}/></div>}
                {!single&&<div className="card"><div className="card-hd"><h3 className="card-title">Modèles contractuels</h3></div><DonutChart data={[{label:"Commission",v:restaurants.filter(r=>r.contract_model==="commission").length,color:"#6366F1"},{label:"Abonnement",v:restaurants.filter(r=>r.contract_model==="abonnement").length,color:"#10B981"},{label:"Mixte",v:restaurants.filter(r=>r.contract_model==="mixte").length,color:"#F59E0B"}]}/></div>}
              </div>
            </div>
          )}

          {page==="settings"&&(
            <div className="fade-in">
              <div className="settings-grid">
                <div className="card"><div className="card-hd"><h3 className="card-title">{single?"Instance":"Informations plateforme"}</h3></div>
                  {single ? (
                    <div className="sf">{[["Application",brandCtx.brand.app_name],["Éditeur",brandCtx.platformName],["Mode","mono-restaurant (APP_MODE=single)"],["Fuseau de référence",brandCtx.timezone],["Mention « propulsé par »",brandCtx.badge?"affichée (POWERED_BY_BADGE=true)":"retirée (POWERED_BY_BADGE=false)"]].map(([l,v])=>(
                      <div key={l}><label className="fl">{l}</label><input className="fi" readOnly value={v} style={{background:"#F8FAFC",color:"#64748B"}}/></div>
                    ))}<p style={{fontSize:11,color:"#94A3B8"}}>Ces réglages sont des variables d'instance : ils se modifient dans l'hébergement, puis redéploiement.</p></div>
                  ) : (<>
                    <div className="sf">{[["Nom","PickEatGo"],["Email","admin@pickeatgo.be"],["Pays","Belgique"],["Devise","EUR (€)"]].map(([l,v])=>(
                      <div key={l}><label className="fl">{l}</label><input className="fi" defaultValue={v}/></div>
                    ))}</div>
                    <button className="full-btn indigo" style={{marginTop:16}} onClick={()=>showToast("Paramètres sauvegardés ✓")}>Sauvegarder</button>
                  </>)}
                </div>
                <div className="card"><div className="card-hd"><h3 className="card-title">Accès rapide</h3></div>
                  <div style={{display:"flex",flexDirection:"column",gap:8}}>
                    <a href={`${API.replace(/\/api\/v1\/?$/, "")}/admin/`} target="_blank" rel="noopener noreferrer" style={{display:"flex",alignItems:"center",gap:10,padding:"12px 16px",background:"var(--bg)",borderRadius:10,textDecoration:"none",color:"var(--text)",fontWeight:600,fontSize:14}}>⚙️ Admin Django</a>
                    <a href={`${API.replace(/\/api\/v1\/?$/, "")}/api/docs/`} target="_blank" rel="noopener noreferrer" style={{display:"flex",alignItems:"center",gap:10,padding:"12px 16px",background:"var(--bg)",borderRadius:10,textDecoration:"none",color:"var(--text)",fontWeight:600,fontSize:14}}>📚 Documentation API</a>
                    <button onClick={loadAll} style={{display:"flex",alignItems:"center",gap:10,padding:"12px 16px",background:"var(--bg)",borderRadius:10,border:"none",cursor:"pointer",fontWeight:600,fontSize:14,fontFamily:"'Instrument Sans',sans-serif",color:"var(--text)"}}>🔄 Actualiser les données</button>
                  </div>
                </div>
              </div>
            </div>
          )}

        </div>
      </main>

      {confirmModal&&(
        <div className="modal-overlay" onClick={()=>setConfirmModal(null)}>
          <div className="confirm-modal" onClick={e=>e.stopPropagation()}>
            <div style={{fontSize:40,marginBottom:12,textAlign:"center"}}>{confirmModal.type.includes("delete")?"🗑️":confirmModal.type.includes("block")?"🚫":"⊘"}</div>
            <h3 className="confirm-title">{{suspend_rest:"Suspendre ce restaurant ?",delete_rest:"Supprimer ce restaurant ?",block_user:"Bloquer cet utilisateur ?",delete_user:"Supprimer ce compte ?"}[confirmModal.type]}</h3>
            <p className="confirm-sub"><strong>{confirmModal.name}</strong> sera {confirmModal.type.includes("delete")?"définitivement supprimé(e)":confirmModal.type==="block_user"?"bloqué(e)":"suspendu(e)"}.</p>
            <div style={{display:"flex",gap:10,marginTop:20}}>
              <button className="full-btn grey" onClick={()=>setConfirmModal(null)}>Annuler</button>
              <button className="full-btn red" onClick={()=>{
                if(confirmModal.type==="suspend_rest")suspendRest(confirmModal.id);
                else if(confirmModal.type==="delete_rest")deleteRest(confirmModal.id);
                else if(confirmModal.type==="block_user")blockUser(confirmModal.id);
                else if(confirmModal.type==="delete_user")deleteUser(confirmModal.id);
              }}>Confirmer</button>
            </div>
          </div>
        </div>
      )}
    </div></>
  );
}

const CSS = `
  *,*::before,*::after{box-sizing:border-box;margin:0;padding:0;}
  :root{--primary:#6366F1;--primary-d:#4F46E5;--primary-l:#EEF2FF;--dark:#0F172A;--text:#1E293B;--text-soft:#64748B;--bg:#F8FAFC;--white:#fff;--border:#E2E8F0;--success:#10B981;--warn:#F59E0B;--danger:#EF4444;--radius:14px;--shadow:0 2px 12px rgba(0,0,0,.06);--shadow-md:0 4px 24px rgba(0,0,0,.1);}
  html,body{overflow-x:hidden;-webkit-text-size-adjust:100%;}
  body{font-family:'Instrument Sans',sans-serif;background:var(--bg);color:var(--text);}
  img{max-width:100%;}
  .app{display:flex;min-height:100vh;min-height:100dvh;}
  .fade-in{animation:fadeUp .4s ease both;}
  @keyframes fadeUp{from{opacity:0;transform:translateY(10px);}to{opacity:1;transform:translateY(0);}}
  @keyframes spin{to{transform:rotate(360deg);}}
  @keyframes blink{0%,100%{opacity:1;}50%{opacity:.4;}}
  .sidebar{width:240px;min-height:100vh;background:var(--dark);display:flex;flex-direction:column;position:sticky;top:0;height:100vh;transition:width .3s cubic-bezier(.34,1.56,.64,1);flex-shrink:0;overflow:hidden;}
  .sidebar.collapsed{width:64px;}
  .sb-logo{padding:20px 14px 16px;display:flex;align-items:center;gap:10px;cursor:pointer;border-bottom:1px solid rgba(255,255,255,.07);margin-bottom:10px;}
  .sb-logo-icon{width:36px;height:36px;border-radius:10px;background:var(--primary);display:flex;align-items:center;justify-content:center;font-size:18px;flex-shrink:0;}
  .sb-logo-title{font-family:'Sora',sans-serif;font-size:15px;font-weight:800;color:#fff;white-space:nowrap;}
  .sb-logo-sub{font-size:10px;color:#94A3B8;text-transform:uppercase;letter-spacing:1px;margin-top:1px;}
  .sb-nav{flex:1;padding:0 10px;display:flex;flex-direction:column;gap:2px;}
  .sb-item{display:flex;align-items:center;gap:10px;padding:10px 12px;border-radius:10px;border:none;background:none;cursor:pointer;transition:all .15s;width:100%;text-align:left;position:relative;}
  .sb-item:hover{background:rgba(255,255,255,.06);}
  .sb-item.active{background:rgba(99,102,241,.25);}
  .sb-icon{flex-shrink:0;width:22px;display:flex;align-items:center;justify-content:center;}
  .sb-label{font-size:14px;font-weight:600;color:#94A3B8;white-space:nowrap;}
  .sb-item.active .sb-label{color:#A5B4FC;}
  .sb-badge{background:var(--danger);color:#fff;font-size:11px;font-weight:800;padding:2px 7px;border-radius:20px;margin-left:auto;}
  .sb-badge.mini{position:absolute;top:5px;right:5px;padding:2px 5px;}
  .sb-footer{padding:12px 10px 20px;border-top:1px solid rgba(255,255,255,.07);}
  .sb-admin{display:flex;align-items:center;gap:10px;padding:10px 12px;background:rgba(255,255,255,.05);border-radius:10px;margin-bottom:6px;}
  .sb-av{width:34px;height:34px;border-radius:9px;background:var(--primary);display:flex;align-items:center;justify-content:center;font-weight:800;color:#fff;font-size:14px;flex-shrink:0;}
  .sb-admin-name{font-size:13px;font-weight:700;color:#fff;white-space:nowrap;}
  .sb-admin-role{font-size:10px;color:#94A3B8;margin-top:1px;}
  .live-dot{width:7px;height:7px;border-radius:50%;background:var(--success);display:inline-block;animation:blink 2s infinite;}
  .main{flex:1;display:flex;flex-direction:column;min-width:0;}
  .topbar{background:#fff;border-bottom:1px solid var(--border);padding:16px 28px;display:flex;align-items:center;justify-content:space-between;position:sticky;top:0;z-index:50;}
  .page-title{font-family:'Sora',sans-serif;font-size:20px;font-weight:800;color:var(--text);}
  .page-sub{font-size:12px;color:var(--text-soft);margin-top:2px;text-transform:capitalize;}
  .alert-pill{background:#FEF9C3;color:#92400E;border:1.5px solid #FDE68A;font-size:12px;font-weight:700;padding:6px 14px;border-radius:20px;display:flex;align-items:center;gap:6px;cursor:pointer;}
  .icon-btn-top{width:38px;height:38px;border-radius:10px;border:1.5px solid var(--border);background:#fff;display:flex;align-items:center;justify-content:center;cursor:pointer;transition:all .15s;}
  .icon-btn-top:hover{border-color:var(--primary);background:var(--primary-l);}
  .admin-chip{display:flex;align-items:center;gap:8px;background:var(--bg);border-radius:10px;padding:6px 14px 6px 6px;font-size:14px;font-weight:600;}
  .admin-av{width:28px;height:28px;border-radius:8px;background:var(--primary);color:#fff;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:800;}
  .content{padding:24px 28px;flex:1;}
  .kpi-row{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:16px;margin-bottom:24px;}
  .kpi-card{background:#fff;border-radius:var(--radius);padding:20px;box-shadow:var(--shadow);border:1px solid var(--border);animation:fadeUp .4s ease both;transition:box-shadow .2s;}
  .kpi-card:hover{box-shadow:var(--shadow-md);}
  .kpi-label{font-size:11px;font-weight:700;color:var(--text-soft);text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px;}
  .kpi-val{font-family:'Sora',sans-serif;font-size:28px;font-weight:800;color:var(--text);line-height:1.1;}
  .kpi-sub{font-size:12px;color:var(--text-soft);margin-top:4px;}
  .card{background:#fff;border-radius:var(--radius);padding:20px;box-shadow:var(--shadow);border:1px solid var(--border);}
  .card-hd{display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;}
  .card-title{font-family:'Sora',sans-serif;font-size:15px;font-weight:700;color:var(--text);}
  .link-btn{font-size:13px;color:var(--primary);font-weight:600;background:none;border:none;cursor:pointer;}
  .dash-grid{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:4px;}
  @media(max-width:900px){.dash-grid{grid-template-columns:minmax(0,1fr);}.card{min-width:0;}}
  .pending-row{display:flex;align-items:center;gap:10px;padding:10px 12px;border-radius:10px;background:var(--bg);margin-bottom:8px;flex-wrap:wrap;}
  .pending-row>div{min-width:0;}
  .pending-name,.pending-sub{overflow-wrap:anywhere;}
  .pending-name{font-size:13px;font-weight:700;color:var(--text);}
  .pending-sub{font-size:11px;color:var(--text-soft);}
  .empty-sm{text-align:center;padding:20px;color:var(--text-soft);font-size:13px;}
  .act-btn{width:28px;height:28px;border-radius:8px;border:none;display:flex;align-items:center;justify-content:center;cursor:pointer;transition:all .15s;flex-shrink:0;}
  .act-btn.green{background:#DCFCE7;}.act-btn.green:hover{background:#BBF7D0;}
  .act-btn.red{background:#FEE2E2;}.act-btn.red:hover{background:#FECACA;}
  .act-btn.yellow{background:#FEF9C3;}.act-btn.yellow:hover{background:#FDE68A;}
  .act-btn.indigo{background:#EEF2FF;}.act-btn.indigo:hover{background:#C7D2FE;}
  .toolbar{display:flex;gap:12px;margin-bottom:20px;flex-wrap:wrap;}
  .search-bar{display:flex;align-items:center;gap:8px;background:#fff;border:1.5px solid var(--border);border-radius:10px;padding:9px 14px;flex:1;min-width:200px;}
  .search-bar input{flex:1;border:none;outline:none;font-size:14px;font-family:'Instrument Sans',sans-serif;color:var(--text);background:transparent;}
  .search-bar input::placeholder{color:var(--text-soft);}
  .filter-chips{display:flex;gap:6px;flex-wrap:wrap;}
  .chip{padding:8px 14px;border-radius:20px;border:1.5px solid var(--border);background:#fff;font-size:13px;font-weight:600;cursor:pointer;transition:all .15s;color:var(--text-soft);display:flex;align-items:center;gap:6px;font-family:'Instrument Sans',sans-serif;}
  .chip.active{background:var(--primary);border-color:var(--primary);color:#fff;}
  .chip-count{background:rgba(0,0,0,.08);border-radius:10px;padding:1px 6px;font-size:11px;}
  .chip.active .chip-count{background:rgba(255,255,255,.2);color:#fff;}
  .table-wrap{background:#fff;border-radius:var(--radius);border:1px solid var(--border);overflow:auto;box-shadow:var(--shadow);}
  .data-table{width:100%;border-collapse:collapse;min-width:700px;}
  .data-table thead tr{border-bottom:2px solid var(--border);}
  .data-table th{padding:12px 16px;text-align:left;font-size:11px;font-weight:700;color:var(--text-soft);text-transform:uppercase;letter-spacing:.5px;white-space:nowrap;}
  .data-table tbody tr{border-bottom:1px solid var(--border);transition:background .12s;}
  .table-row{cursor:pointer;}.table-row:hover{background:#F8FAFC;}
  .data-table td{padding:13px 16px;vertical-align:middle;}
  .td-main{font-size:14px;font-weight:600;color:var(--text);}
  .td-sub{font-size:11px;color:var(--text-soft);margin-top:2px;}
  .td-num{font-size:14px;font-weight:700;color:var(--text);}
  .cuisine-tag{background:var(--primary-l);color:var(--primary);font-size:11px;font-weight:700;padding:3px 10px;border-radius:20px;}
  .user-av-sm{width:32px;height:32px;border-radius:9px;background:var(--primary-l);color:var(--primary);display:flex;align-items:center;justify-content:center;font-weight:800;font-size:14px;flex-shrink:0;}
  .detail-panel{position:fixed;inset:0;background:rgba(0,0,0,.4);z-index:150;display:flex;align-items:center;justify-content:flex-end;}
  .detail-box{background:#fff;width:100%;max-width:420px;height:100%;overflow-y:auto;display:flex;flex-direction:column;animation:slideR .3s cubic-bezier(.34,1.56,.64,1);}
  @keyframes slideR{from{transform:translateX(100%);}to{transform:translateX(0);}}
  .detail-header{display:flex;justify-content:space-between;align-items:flex-start;padding:24px;border-bottom:1px solid var(--border);}
  .detail-name{font-family:'Sora',sans-serif;font-size:18px;font-weight:800;color:var(--text);margin-bottom:8px;}
  .detail-grid{display:grid;grid-template-columns:1fr 1fr;gap:0;padding:0 24px;flex:1;}
  .detail-field{padding:16px 0;border-bottom:1px solid var(--border);}
  .detail-key{font-size:11px;font-weight:700;color:var(--text-soft);text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px;}
  .detail-val{font-size:14px;font-weight:600;color:var(--text);}
  .detail-footer{padding:20px 24px;border-top:1px solid var(--border);display:flex;flex-direction:column;gap:8px;}
  .user-av-lg{width:50px;height:50px;border-radius:14px;background:var(--primary-l);color:var(--primary);display:flex;align-items:center;justify-content:center;font-weight:800;font-size:22px;}
  .full-btn{width:100%;padding:11px;border-radius:10px;border:none;font-size:14px;font-weight:700;cursor:pointer;transition:all .15s;font-family:'Instrument Sans',sans-serif;display:flex;align-items:center;justify-content:center;gap:6px;}
  .full-btn.green{background:#DCFCE7;color:#16A34A;}.full-btn.green:hover{background:#BBF7D0;}
  .full-btn.red{background:#FEE2E2;color:#DC2626;}.full-btn.red:hover{background:#FECACA;}
  .full-btn.yellow{background:#FEF9C3;color:#92400E;}.full-btn.yellow:hover{background:#FDE68A;}
  .full-btn.grey{background:var(--bg);color:var(--text-soft);}.full-btn.grey:hover{background:var(--border);}
  .full-btn.indigo{background:var(--primary);color:#fff;}.full-btn.indigo:hover{background:var(--primary-d);}
  .full-btn.sm{width:auto;padding:8px 14px;font-size:12px;}
  .report-stat{background:#fff;border:1px solid var(--border);border-radius:12px;padding:14px 20px;display:flex;align-items:center;gap:10px;box-shadow:var(--shadow);}
  .report-card{background:#fff;border-radius:var(--radius);padding:20px;border:1px solid var(--border);box-shadow:var(--shadow);}
  .report-card.resolved{opacity:.65;}.report-card.dismissed{opacity:.45;}
  .report-card-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;flex-wrap:wrap;gap:8px;}
  .report-type-badge{font-size:12px;font-weight:700;padding:4px 10px;border-radius:20px;background:#FFF7ED;color:#C2410C;}
  .report-status-tag{font-size:12px;font-weight:700;color:var(--text-soft);}
  .report-body{display:flex;align-items:center;gap:12px;background:var(--bg);border-radius:10px;padding:12px 16px;margin-bottom:12px;}
  .report-arrow{font-size:18px;color:var(--text-soft);}
  .report-label{font-size:10px;font-weight:700;color:var(--text-soft);text-transform:uppercase;letter-spacing:.5px;margin-bottom:3px;}
  .report-val{font-size:14px;font-weight:700;color:var(--text);}
  .report-reason-box{background:#FFFBEB;border:1px solid #FDE68A;border-radius:8px;padding:10px 14px;font-size:13px;color:#92400E;display:flex;gap:6px;margin-bottom:14px;}
  .report-actions{display:flex;gap:8px;flex-wrap:wrap;}
  .kpi-stripe{background:#fff;border:1px solid var(--border);border-radius:var(--radius);padding:20px 28px;display:flex;align-items:center;margin-bottom:20px;box-shadow:var(--shadow);}
  .kpi-stripe-item{flex:1;text-align:center;}
  .kpi-stripe-sep{width:1px;height:36px;background:var(--border);flex-shrink:0;}
  .kpi-stripe-l{font-size:11px;font-weight:700;color:var(--text-soft);text-transform:uppercase;letter-spacing:.5px;margin-bottom:5px;}
  .kpi-stripe-v{font-family:'Sora',sans-serif;font-size:20px;font-weight:800;color:var(--text);}
  .contracts-layout{display:grid;grid-template-columns:1fr 420px;gap:20px;align-items:start;}
  @media(max-width:1100px){.contracts-layout{grid-template-columns:1fr;}}
  .rc{background:#fff;border:1.5px solid var(--border);border-radius:var(--radius);padding:18px;cursor:pointer;transition:all .2s;box-shadow:var(--shadow);}
  .rc:hover{box-shadow:var(--shadow-md);border-color:#CBD5E1;}
  .rc-active{border-color:var(--primary);box-shadow:0 0 0 3px rgba(99,102,241,.12);}
  .rc-unpaid{border-left:4px solid var(--danger);}
  .rc-top{display:flex;align-items:flex-start;gap:12px;margin-bottom:14px;flex-wrap:wrap;}
  .rc-top>div{min-width:0;}
  .rc{min-width:0;}
  .rc-bottom{flex-wrap:wrap;}
  .rc-metric{flex:1 1 70px;}
  .rc-name{font-family:'Sora',sans-serif;font-size:15px;font-weight:700;color:var(--text);}
  .rc-owner{font-size:12px;color:var(--text-soft);margin-top:2px;}
  .rc-bottom{display:flex;align-items:center;gap:12px;background:var(--bg);border-radius:10px;padding:10px 14px;}
  .rc-metric{flex:1;text-align:center;}
  .rc-ml{font-size:10px;font-weight:700;color:var(--text-soft);text-transform:uppercase;letter-spacing:.4px;margin-bottom:3px;}
  .rc-mv{font-family:'Sora',sans-serif;font-size:15px;font-weight:800;color:var(--text);}
  .model-pill{font-size:11px;font-weight:700;padding:3px 10px;border-radius:20px;white-space:nowrap;}
  .model-pill.lg{padding:5px 14px;font-size:12px;}
  .tag-unpaid{font-size:11px;font-weight:700;background:#FEE2E2;color:#DC2626;padding:3px 8px;border-radius:20px;}
  .tag-admin-menu{font-size:10px;font-weight:700;background:#FEF9C3;color:#92400E;padding:2px 8px;border-radius:20px;}
  .rc-edit-btn{display:flex;align-items:center;gap:5px;background:var(--primary-l);color:var(--primary);border:none;border-radius:8px;padding:7px 12px;font-size:12px;font-weight:700;cursor:pointer;white-space:nowrap;transition:all .15s;font-family:'Instrument Sans',sans-serif;flex-shrink:0;}
  .rc-edit-btn:hover{background:var(--primary);color:#fff;}
  .cp{background:#fff;border:1.5px solid var(--border);border-radius:var(--radius);box-shadow:var(--shadow-md);position:sticky;top:20px;display:flex;flex-direction:column;max-height:calc(100vh - 120px);overflow:hidden;}
  .cp-header{padding:20px;border-bottom:1px solid var(--border);display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-shrink:0;}
  .cp-name{font-family:'Sora',sans-serif;font-size:18px;font-weight:800;color:var(--text);}
  .cp-owner{font-size:12px;color:var(--text-soft);margin-top:3px;}
  .cp-edit-btn{display:flex;align-items:center;gap:5px;background:var(--primary-l);color:var(--primary);border:none;border-radius:8px;padding:8px 14px;font-size:13px;font-weight:700;cursor:pointer;font-family:'Instrument Sans',sans-serif;white-space:nowrap;}
  .cp-edit-btn:hover{background:var(--primary);color:#fff;}
  .cp-close-btn{width:32px;height:32px;border-radius:8px;border:1.5px solid var(--border);background:#fff;display:flex;align-items:center;justify-content:center;cursor:pointer;}
  .cp-body{flex:1;overflow-y:auto;padding:20px;}
  .cp-footer{padding:16px 20px;border-top:1px solid var(--border);display:flex;gap:10px;flex-shrink:0;}
  .cp-btn-cancel{flex:1;padding:12px;border-radius:10px;border:1.5px solid var(--border);background:#fff;font-size:14px;font-weight:700;cursor:pointer;font-family:'Instrument Sans',sans-serif;}
  .cp-btn-save{flex:2;padding:12px;border-radius:10px;border:none;background:var(--primary);color:#fff;font-size:14px;font-weight:700;cursor:pointer;font-family:'Instrument Sans',sans-serif;display:flex;align-items:center;justify-content:center;gap:6px;transition:background .15s;}
  .cp-btn-save:hover:not(:disabled){background:var(--primary-d);}
  .cp-btn-save:disabled{opacity:.7;cursor:not-allowed;}
  .cp-section{margin-bottom:20px;}
  .cp-section-title{font-size:11px;font-weight:700;color:var(--text-soft);text-transform:uppercase;letter-spacing:.5px;margin-bottom:12px;}
  .calc-box{background:linear-gradient(135deg,#EEF2FF,#E0E7FF);border:1.5px solid #C7D2FE;border-radius:12px;padding:16px;margin-bottom:20px;}
  .calc-title{font-size:13px;font-weight:700;color:#4338CA;margin-bottom:12px;}
  .calc-rows{display:flex;flex-direction:column;gap:8px;}
  .calc-row{display:flex;justify-content:space-between;align-items:center;font-size:13px;color:#4B5563;}
  .calc-amt{font-weight:700;color:#4338CA;}
  .calc-total{display:flex;justify-content:space-between;align-items:center;padding-top:10px;border-top:2px solid #A5B4FC;font-family:'Sora',sans-serif;font-size:16px;font-weight:800;color:#3730A3;margin-top:4px;}
  .calc-footer{display:flex;justify-content:space-between;align-items:center;margin-top:14px;padding-top:12px;border-top:1px solid #C7D2FE;}
  .btn-paid{display:flex;align-items:center;gap:6px;background:#6366F1;color:#fff;border:none;border-radius:8px;padding:8px 14px;font-size:12px;font-weight:700;cursor:pointer;font-family:'Instrument Sans',sans-serif;}
  .btn-paid:hover{background:var(--primary-d);}
  .info-grid2{display:grid;grid-template-columns:1fr 1fr;gap:10px;}
  .info-cell{background:var(--bg);border-radius:10px;padding:10px 12px;}
  .info-k{font-size:10px;font-weight:700;color:var(--text-soft);text-transform:uppercase;letter-spacing:.4px;margin-bottom:4px;}
  .info-v{font-size:14px;font-weight:700;color:var(--text);}
  .notes-box{background:var(--bg);border-radius:10px;padding:12px 14px;display:flex;gap:10px;}
  .notes-inp{width:100%;border:1.5px solid var(--border);border-radius:10px;padding:10px 14px;font-size:13px;font-family:'Instrument Sans',sans-serif;color:var(--text);outline:none;resize:none;background:#fff;transition:border .15s;}
  .notes-inp:focus{border-color:var(--primary);}
  .model-selector{display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:4px;}
  .model-option{padding:12px 10px;border-radius:10px;border:1.5px solid var(--border);background:#fff;cursor:pointer;transition:all .15s;text-align:left;font-family:'Instrument Sans',sans-serif;}
  .model-option:hover{border-color:#CBD5E1;}
  .mo-label{font-size:13px;font-weight:700;color:var(--text);margin-bottom:3px;}
  .mo-desc{font-size:10px;color:var(--text-soft);line-height:1.4;}
  .field-lbl{font-size:11px;font-weight:700;color:var(--text-soft);text-transform:uppercase;letter-spacing:.4px;display:block;margin-bottom:6px;}
  .field-inp{border:1.5px solid var(--border);border-radius:10px;padding:10px 14px;font-size:15px;font-weight:700;font-family:'Sora',sans-serif;color:var(--text);outline:none;background:#fff;transition:border .15s;width:120px;}
  .field-inp:focus{border-color:var(--primary);}
  .preview-box{background:var(--bg);border:1.5px solid var(--border);border-radius:12px;padding:16px;margin-top:4px;}
  .banner-yellow{background:#FFFBEB;border:1px solid #FDE68A;color:#92400E;border-radius:10px;padding:12px 14px;font-size:12px;line-height:1.6;margin-top:10px;}
  .modal-overlay{position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:300;display:flex;align-items:center;justify-content:center;}
  .confirm-modal{background:#fff;border-radius:20px;padding:32px;width:100%;max-width:400px;margin:16px;text-align:center;}
  .confirm-title{font-family:'Sora',sans-serif;font-size:18px;font-weight:800;color:var(--text);margin-bottom:8px;}
  .confirm-sub{font-size:14px;color:var(--text-soft);line-height:1.6;}
  .mini-tab{padding:6px 12px;border-radius:6px;border:none;font-size:12px;font-weight:600;cursor:pointer;background:none;color:var(--text-soft);font-family:'Instrument Sans',sans-serif;}
  .mini-tab.active{background:#fff;color:var(--primary);box-shadow:var(--shadow);}
  .settings-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:20px;}
  .sf{display:flex;flex-direction:column;gap:14px;}
  .fl{font-size:11px;font-weight:700;color:var(--text-soft);text-transform:uppercase;letter-spacing:.5px;display:block;margin-bottom:5px;}
  .fi{width:100%;border:1.5px solid var(--border);border-radius:10px;padding:10px 14px;font-size:14px;font-family:'Instrument Sans',sans-serif;color:var(--text);outline:none;background:#fff;transition:border .15s;}
  .fi:focus{border-color:var(--primary);}

  /* ═══════════ RESPONSIVE ═══════════ */
  /* Tablette & mobile : la sidebar devient une barre de navigation fixée en bas */
  @media(max-width:900px){
    .app{flex-direction:column;}
    .sidebar,.sidebar.collapsed{position:fixed;top:auto;bottom:0;left:0;right:0;width:100%;height:auto;min-height:0;flex-direction:row;align-items:stretch;z-index:120;padding:0 4px env(safe-area-inset-bottom);border-top:1px solid rgba(255,255,255,.08);box-shadow:0 -6px 24px rgba(0,0,0,.25);transition:none;overflow:visible;}
    .sb-logo,.sb-admin{display:none;}
    .sb-nav{flex-direction:row;flex:1;padding:0;gap:0;justify-content:space-around;}
    .sb-footer{padding:0;border:0;display:flex;align-items:stretch;}
    .sb-item,.sb-footer .sb-item{flex-direction:column;justify-content:center;gap:4px;padding:8px 2px 7px;border-radius:0;width:auto;min-width:0;flex:1;margin:0!important;}
    .sb-footer .sb-item{flex:0 0 44px;}
    .sb-footer .sb-label{display:none;}
    .sb-item.active{background:none;box-shadow:inset 0 3px 0 var(--primary);}
    .sb-icon{width:auto;}
    .sb-label{font-size:9px;font-weight:600;max-width:100%;overflow:hidden;text-overflow:ellipsis;}
    .sb-badge,.sb-badge.mini{margin:0;position:absolute;top:3px;left:calc(50% + 4px);right:auto;padding:1px 5px;font-size:10px;}
    .main{padding-bottom:calc(66px + env(safe-area-inset-bottom));}
    .topbar{flex-wrap:wrap;gap:10px;padding:12px 16px;}
    .topbar>div:last-child{flex-wrap:wrap;gap:8px;width:100%;}
    .page-title{font-size:18px;}
    .content{padding:16px;}
    .kpi-row{grid-template-columns:repeat(2,1fr);gap:10px;}
    .kpi-card{padding:14px;}
    .kpi-val{font-size:22px;}
    .detail-box{max-width:none;}
    .detail-grid{grid-template-columns:1fr;}
    .detail-header,.detail-footer{padding:18px 16px;}
    .detail-grid{padding:0 16px;}
    .kpi-stripe{flex-wrap:wrap;gap:12px;padding:16px;}
    .kpi-stripe-item{flex:1 1 40%;}
    .kpi-stripe-sep{display:none;}
    .contracts-layout{grid-template-columns:1fr;}
    .cp{position:static;max-height:none;}
    .model-selector{grid-template-columns:1fr;}
    .admin-chip span{display:none;}
    .admin-chip{padding:6px;}
    .search-bar{min-width:0;flex-basis:100%;}
    .confirm-modal{margin:12px;padding:24px;}
    .report-body{flex-wrap:wrap;}
    .fi,.notes-inp,.field-inp,textarea,select{font-size:16px!important;}
  }
  @media(max-width:400px){
    .sb-label{display:none;}
    .sb-item,.sb-footer .sb-item{padding:11px 2px;}
  }
  @media(max-width:340px){
    .kpi-row{grid-template-columns:1fr;}
    .info-grid2{grid-template-columns:1fr;}
  }
  ${TOUCH_CSS}
`;