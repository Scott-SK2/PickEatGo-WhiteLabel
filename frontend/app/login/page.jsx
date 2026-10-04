"use client";
import { TOUCH_CSS } from "../../lib/touch.css";
import { useState, useEffect } from "react";
import { useAuth } from "../../lib/AuthContext";
import { useBrand } from "../../lib/BrandContext";
import { useRouter } from "next/navigation";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000/api/v1";
const CUISINES = [
  "Américain","Français","Italien","Espagnol","Grec","Belge","Allemand",
  "Marocain","Tunisien","Algérien","Maghrébin","Méditerranéen","Africain","Afro européen","Caraïbéen",
  "Indien","Thaïlandais","Japonais","Chinois","Libanais","Mexicain",
  "Végétarien","Healthy",
  "Traditionnel","Gastronomique","Bistro / Brasserie",
  "Snack / Restauration rapide","Fast-food","Street food",
  "Cafétéria","Buffet à volonté","Food truck",
  "Salon de thé / Café","Pâtisserie / Boulangerie",
  "Bar à tapas","Grill / Steakhouse","Pizzeria","Crêperie",
  "Autre",
];

async function apiFetch(endpoint, opts = {}, token = null) {
  const headers = { "Content-Type": "application/json", ...opts.headers };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(`${API}${endpoint}`, { ...opts, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw data;
  return data;
}

const Ic = ({n,s=20,c="currentColor"}) => ({
  eye:    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>,
  eyeoff: <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>,
  check:  <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>,
  store:  <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2"/><path d="M7 2v20"/><path d="M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3zm0 0v7"/></svg>,
  user:   <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>,
  phone:  <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 13 19.79 19.79 0 0 1 1.61 4.33 2 2 0 0 1 3.6 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 9.91a16 16 0 0 0 6.18 6.18l.95-.95a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/></svg>,
  lock:   <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>,
  unlock: <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/></svg>,
}[n] || null);

export default function LoginPage() {
  const { login, getHomeRoute } = useAuth();
  const { single, brand, restaurant: brandRest, platformName } = useBrand();   // marque blanche : nom et logo du restaurant, pas d'inscription restaurateur
  const router = useRouter();
  // Réveille le serveur dès l'arrivée sur la page : la connexion qui suit ne subit pas le délai de démarrage
  useEffect(()=>{ fetch(`${API}/health/`,{cache:"no-store"}).catch(()=>{}); },[]);
  // Déjà connecté sur cet appareil : proposer de reprendre sa session plutôt que de ressaisir ses identifiants
  const [known, setKnown] = useState(null);
  useEffect(()=>{ try { const u = JSON.parse(localStorage.getItem("user")||"null"); if (u && localStorage.getItem("refresh")) setKnown(u); } catch {} },[]);
  const ROLE_LABEL = { restaurateur:"Restaurateur", admin:"Administrateur", client:"Client" };

  const [step, setStep]       = useState("login");
  const [role, setRole]       = useState("client");
  const [showPwd, setShowPwd] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState("");
  const [newUserToken, setNewUserToken] = useState(null);

  const [loginForm, setLoginForm] = useState({ email: "", password: "" });
  const [forgotEmail, setForgotEmail] = useState("");
  const [forgotMsg, setForgotMsg] = useState("");
  const [regForm, setRegForm]     = useState({
    first_name:"", last_name:"", email:"", phone:"",
    password:"", password2:"", phone_visible:true,
  });
  const [restForm, setRestForm] = useState({
    name:"", cuisines:[], address:"", city:"Bruxelles", phone:"", description:"", emoji:"🍽️"
  });
  const toggleCuisine = (c) => setRestForm(p => ({
    ...p,
    cuisines: p.cuisines.includes(c) ? p.cuisines.filter(x => x !== c) : [...p.cuisines, c],
  }));

  const FOOD_EMOJIS = [
    "🍔","🍕","🍣","🌮","🍜","🥗","🍝","🥩","🍗","🥪",
    "🌯","🥙","🧆","🍱","🥘","🫕","🍛","🦞","🍤","🥐",
    "🧇","🥞","🫔","🌽","🥨","🧀","🫙","🍺","☕","🧋",
  ];

  const setL = (k,v) => setLoginForm(p=>({...p,[k]:v}));
  const setR = (k,v) => setRegForm(p=>({...p,[k]:v}));
  const setF = (k,v) => setRestForm(p=>({...p,[k]:v}));

  const handleLogin = async (e) => {
    e.preventDefault(); setError(""); setLoading(true);
    try {
      const data = await login(loginForm.email, loginForm.password);
      router.push(getHomeRoute(data.user));
    } catch(err) { setError(err?.status === 401 || err?.status === 400 ? "Email ou mot de passe incorrect" : (err?.message || err?.detail || "Connexion impossible pour le moment")); }
    finally { setLoading(false); }
  };

  const handleForgot = async (e) => {
    e.preventDefault(); setError(""); setLoading(true);
    try {
      const d = await apiFetch("/auth/password-reset/", { method:"POST", body: JSON.stringify({ email: forgotEmail }) });
      setForgotMsg(d.detail || "E-mail envoyé si le compte existe.");
    } catch(err) { setError(err?.detail || "Envoi impossible pour le moment"); }
    finally { setLoading(false); }
  };

  const handleRegister = async (e) => {
    e.preventDefault(); setError("");
    if (!regForm.phone.trim()) { setError("Le numéro de téléphone est obligatoire"); return; }
    if (regForm.password !== regForm.password2) { setError("Les mots de passe ne correspondent pas"); return; }
    setLoading(true);
    try {
      const data = await apiFetch("/auth/register/", { method:"POST", body: JSON.stringify({
        first_name:regForm.first_name, last_name:regForm.last_name,
        email:regForm.email, phone:regForm.phone,
        password:regForm.password, password2:regForm.password2, role: single ? "client" : role,
        phone_visible: !!regForm.phone_visible,               // le choix « Masqué » est bien transmis au serveur
      })});
      localStorage.setItem("access",  data.access);
      localStorage.setItem("refresh", data.refresh);
      if (role === "restaurateur" && !single) { setNewUserToken(data.access); setStep("create_restaurant"); }
      else { const d = await login(regForm.email, regForm.password); router.push(getHomeRoute(d.user)); }
    } catch(err) {
      setError(Object.values(err||{}).flat().join(" · ") || "Erreur lors de l'inscription");
    } finally { setLoading(false); }
  };

  const handleCreateRestaurant = async (e) => {
    e.preventDefault(); setError(""); setLoading(true);
    try {
      await apiFetch("/restaurants/", { method:"POST", body: JSON.stringify({
        name:restForm.name, cuisine:restForm.cuisines, address:restForm.address,
        city:restForm.city, phone:restForm.phone, description:restForm.description,
        emoji:restForm.emoji,
      })}, newUserToken);
      const d = await login(regForm.email, regForm.password);
      router.push(getHomeRoute(d.user));
    } catch(err) {
      setError(Object.values(err||{}).flat().join(" · ") || "Erreur lors de la création du restaurant");
    } finally { setLoading(false); }
  };

  return (
    <><style>{CSS}</style>
    <div className="login-wrap">
      <div className="login-card">
        <div className="login-logo">
          {single && brandRest?.logo_url
            ? <img src={brandRest.logo_url} alt="" style={{width:44,height:44,borderRadius:12,objectFit:"cover"}}/>
            : <span className="logo-icon">{single ? (brandRest?.emoji || "🍽️") : "🍔"}</span>}
          <span className="logo-text">{single ? brand.app_name : "PickEatGo"}</span>
        </div>

        {step === "login" && known && (
          <div className="known-box">
            <p className="known-title">Vous êtes déjà connecté</p>
            <p className="known-sub">{known.first_name} {known.last_name} · {ROLE_LABEL[known.role] || known.role}</p>
            <button type="button" className="btn-primary" style={{marginTop:12}} onClick={()=>router.push(getHomeRoute(known))}>
              {known.role === "restaurateur" ? "Ouvrir mon tableau de bord" : known.role === "admin" ? "Ouvrir l'administration" : "Continuer"} →
            </button>
            <button type="button" className="link-btn" style={{marginTop:8}} onClick={()=>{localStorage.clear();setKnown(null);}}>Changer de compte</button>
          </div>
        )}
        {step === "login" && (<>
          <h1 className="login-title">Bon retour !</h1>
          <p className="login-sub">Connectez-vous à votre compte</p>
          <form onSubmit={handleLogin}>
            <div className="field"><label className="label">Email</label>
              <input className="input" type="email" placeholder="votre@email.com" value={loginForm.email} onChange={e=>setL("email",e.target.value)} required/></div>
            <div className="field"><label className="label">Mot de passe</label>
              <div className="input-pwd">
                <input className="input" type={showPwd?"text":"password"} placeholder="••••••••" value={loginForm.password} onChange={e=>setL("password",e.target.value)} required/>
                <button type="button" className="pwd-toggle" aria-label={showPwd?"Masquer le mot de passe":"Afficher le mot de passe"} onClick={()=>setShowPwd(p=>!p)}><Ic n={showPwd?"eyeoff":"eye"} s={16} c="#94A3B8"/></button>
              </div></div>
            {error&&<div className="error-msg">⚠️ {error}</div>}
            <button type="submit" className="btn-primary" disabled={loading}>{loading?<div className="spinner"/>:"Se connecter"}</button>
          </form>
          <button className="btn-link" style={{marginTop:12}} onClick={()=>{setStep("forgot");setError("");setForgotMsg("");setForgotEmail(loginForm.email);}}>Mot de passe oublié ?</button>
          <div className="divider"><span>Pas encore de compte ?</span></div>
          <button className="btn-secondary" onClick={()=>{setStep("register");setError("");}}>Créer un compte</button>
        </>)}

        {step === "forgot" && (<>
          <h1 className="login-title">Mot de passe oublié</h1>
          <p className="login-sub">Indiquez votre e-mail : nous vous envoyons un lien pour choisir un nouveau mot de passe.</p>
          {forgotMsg ? (
            <div className="info-box">📬 {forgotMsg}<br/><span style={{fontSize:12,color:"#64748B"}}>Pensez à vérifier vos courriers indésirables.</span></div>
          ) : (
            <form onSubmit={handleForgot}>
              <div className="field"><label className="label">Email</label>
                <input className="input" type="email" placeholder="votre@email.com" value={forgotEmail} onChange={e=>setForgotEmail(e.target.value)} required autoFocus/></div>
              {error&&<div className="error-msg">⚠️ {error}</div>}
              <button type="submit" className="btn-primary" disabled={loading}>{loading?<div className="spinner"/>:"Envoyer le lien"}</button>
            </form>
          )}
          <button className="btn-link" onClick={()=>{setStep("login");setError("");}}>← Retour à la connexion</button>
        </>)}

        {step === "register" && (<>
          <h1 className="login-title">Créer un compte</h1>
          {single ? (
            <p className="login-sub">Pour commander chez {brand.app_name} et suivre vos commandes.</p>
          ) : (
            <div className="role-selector">
              <button className={`role-btn ${role==="client"?"active":""}`} onClick={()=>setRole("client")}>
                <Ic n="user" s={20} c={role==="client"?"#FF6B2C":"#94A3B8"}/><span>Client</span><p>Commander dans les restaurants</p>
              </button>
              <button className={`role-btn ${role==="restaurateur"?"active":""}`} onClick={()=>setRole("restaurateur")}>
                <Ic n="store" s={20} c={role==="restaurateur"?"#FF6B2C":"#94A3B8"}/><span>Restaurateur</span><p>Gérer mon restaurant</p>
              </button>
            </div>
          )}
          <form onSubmit={handleRegister}>
            <div className="field-row">
              <div className="field"><label className="label">Prénom *</label>
                <input className="input" placeholder="Jean" value={regForm.first_name} onChange={e=>setR("first_name",e.target.value)} required/></div>
              <div className="field"><label className="label">Nom *</label>
                <input className="input" placeholder="Dupont" value={regForm.last_name} onChange={e=>setR("last_name",e.target.value)} required/></div>
            </div>
            <div className="field"><label className="label">Email *</label>
              <input className="input" type="email" placeholder="votre@email.com" value={regForm.email} onChange={e=>setR("email",e.target.value)} required/></div>

            {/* Téléphone obligatoire + visibilité */}
            <div className="field">
              <label className="label">Téléphone * <span style={{color:"#94A3B8",fontWeight:400,textTransform:"none",fontSize:10,letterSpacing:0}}>(obligatoire)</span></label>
              <div style={{display:"flex",gap:8,alignItems:"center"}}>
                <div style={{position:"relative",flex:1}}>
                  <span style={{position:"absolute",left:12,top:"50%",transform:"translateY(-50%)",pointerEvents:"none",display:"flex"}}><Ic n="phone" s={15} c="#94A3B8"/></span>
                  <input className="input" type="tel" placeholder="+32 470 12 34 56" style={{paddingLeft:36}}
                    value={regForm.phone} onChange={e=>setR("phone",e.target.value)} required/>
                </div>
                <button type="button"
                  title={regForm.phone_visible?"Visible par les restaurateurs — cliquer pour masquer":"Numéro masqué — cliquer pour rendre visible"}
                  onClick={()=>setR("phone_visible",!regForm.phone_visible)}
                  style={{display:"flex",alignItems:"center",gap:5,padding:"10px 12px",borderRadius:10,border:`1.5px solid ${regForm.phone_visible?"#DCFCE7":"#FEE2E2"}`,background:regForm.phone_visible?"#F0FDF4":"#FFF5F5",cursor:"pointer",whiteSpace:"nowrap",fontSize:12,fontWeight:700,color:regForm.phone_visible?"#16A34A":"#DC2626",fontFamily:"'Instrument Sans',sans-serif",flexShrink:0}}>
                  <Ic n={regForm.phone_visible?"unlock":"lock"} s={13} c={regForm.phone_visible?"#16A34A":"#DC2626"}/>
                  {regForm.phone_visible?"Visible":"Masqué"}
                </button>
              </div>
              <p style={{fontSize:11,color:"#94A3B8",marginTop:5,lineHeight:1.4}}>
                {regForm.phone_visible
                  ? (single ? `👁 Téléphone et e-mail visibles par ${brand.app_name}, pour vous contacter si besoin.` : "👁 Téléphone et e-mail visibles par les restaurateurs où vous commandez, pour vous contacter si besoin.")
                  : (single ? `🔒 Coordonnées masquées au restaurant. L'éditeur (${platformName}) y accède en cas de litige.` : "🔒 Coordonnées masquées aux restaurateurs. L'équipe PickEatGo y accède en cas de litige.")}
              </p>
            </div>

            <div className="field"><label className="label">Mot de passe * <span style={{color:"#94A3B8",fontWeight:400,textTransform:"none",fontSize:10,letterSpacing:0}}>(min. 8 caractères)</span></label>
              <div className="input-pwd">
                <input className="input" type={showPwd?"text":"password"} placeholder="Min. 8 caractères" value={regForm.password} onChange={e=>setR("password",e.target.value)} required/>
                <button type="button" className="pwd-toggle" aria-label={showPwd?"Masquer le mot de passe":"Afficher le mot de passe"} onClick={()=>setShowPwd(p=>!p)}><Ic n={showPwd?"eyeoff":"eye"} s={16} c="#94A3B8"/></button>
              </div></div>
            <div className="field"><label className="label">Confirmer le mot de passe *</label>
              <input className="input" type="password" placeholder="••••••••" value={regForm.password2} onChange={e=>setR("password2",e.target.value)} required/></div>

            {error&&<div className="error-msg">⚠️ {error}</div>}
            {role==="restaurateur"&&!single&&<div className="info-box">🏪 Après l'inscription, vous créerez votre restaurant</div>}
            <button type="submit" className="btn-primary" disabled={loading}>
              {loading?<div className="spinner"/>:role==="restaurateur"&&!single?"Continuer →":"Créer mon compte"}
            </button>
          </form>
          <button className="btn-link" onClick={()=>{setStep("login");setError("");}}>← Retour à la connexion</button>
        </>)}

        {step === "create_restaurant" && (<>
          <div className="step-badge">Étape 2 / 2</div>
          <h1 className="login-title">Votre restaurant</h1>
          <p className="login-sub">Renseignez les informations de votre établissement</p>
          <form onSubmit={handleCreateRestaurant}>
            <div className="field"><label className="label">Nom du restaurant *</label>
              <input className="input" placeholder="Ex: Burger House" value={restForm.name} onChange={e=>setF("name",e.target.value)} required/></div>
            <div className="field"><label className="label">Types de cuisine * {restForm.cuisines.length > 0 && <span style={{color:"#FF6B2C",fontWeight:700}}>({restForm.cuisines.length} sélectionné{restForm.cuisines.length > 1 ? "s" : ""})</span>}</label>
              <div className="cuisine-picker">
                {CUISINES.map(c => (
                  <label key={c} className={`cuisine-opt ${restForm.cuisines.includes(c) ? "selected" : ""}`}>
                    <input type="checkbox" style={{display:"none"}} checked={restForm.cuisines.includes(c)} onChange={()=>toggleCuisine(c)}/>
                    {c}
                  </label>
                ))}
              </div>
              {restForm.cuisines.length === 0 && <p style={{fontSize:11,color:"#EF4444",marginTop:4}}>Sélectionnez au moins un type</p>}
            </div>
            <div className="field"><label className="label">Adresse *</label>
              <input className="input" placeholder="12 Rue de la Paix" value={restForm.address} onChange={e=>setF("address",e.target.value)} required/></div>
            <div className="field-row">
              <div className="field"><label className="label">Ville</label>
                <input className="input" placeholder="Bruxelles" value={restForm.city} onChange={e=>setF("city",e.target.value)}/></div>
              <div className="field"><label className="label">Tél. restaurant</label>
                <input className="input" type="tel" placeholder="+32 2 123 45 67" value={restForm.phone} onChange={e=>setF("phone",e.target.value)}/></div>
            </div>
            <div className="field"><label className="label">Description</label>
              <textarea className="input textarea" placeholder="Décrivez votre restaurant..." rows={3} value={restForm.description} onChange={e=>setF("description",e.target.value)}/></div>
            {error&&<div className="error-msg">⚠️ {error}</div>}
            <div className="info-box">ℹ️ Votre restaurant sera validé par notre équipe avant d'être visible.</div>
            <button type="submit" className="btn-primary" disabled={loading||!restForm.name||!restForm.address||restForm.cuisines.length===0}>
              {loading?<div className="spinner"/>:<><Ic n="check" s={16} c="white"/> Créer mon restaurant</>}
            </button>
          </form>
        </>)}

      </div>
    </div></>
  );
}

const CSS = `
  *,*::before,*::after{box-sizing:border-box;margin:0;padding:0;}
  html,body{overflow-x:hidden;-webkit-text-size-adjust:100%;}
  body{font-family:'Instrument Sans',sans-serif;background:#F8FAFC;color:#1E293B;}
  .login-wrap{min-height:100vh;min-height:100dvh;display:flex;align-items:center;justify-content:center;padding:20px;background:linear-gradient(135deg,#FFF0E8 0%,#F8FAFC 50%,#EEF2FF 100%);}
  .login-card{background:#fff;border-radius:24px;padding:40px;width:100%;max-width:480px;box-shadow:0 8px 48px rgba(0,0,0,.1);}
  .known-box{background:#FFF7ED;border:1.5px solid #FDBA74;border-radius:16px;padding:16px 18px;margin-bottom:20px;text-align:center;}
  .known-title{font-weight:800;font-size:15px;color:#9A3412;}
  .known-sub{font-size:13px;color:#64748B;margin-top:2px;}
  .link-btn{background:none;border:none;color:#64748B;font-size:13px;text-decoration:underline;cursor:pointer;font-family:inherit;}
  .login-logo{display:flex;align-items:center;gap:10px;justify-content:center;margin-bottom:28px;}
  .logo-icon{font-size:32px;} .logo-text{font-family:'Sora',sans-serif;font-size:22px;font-weight:800;color:#1E293B;}
  .login-title{font-family:'Sora',sans-serif;font-size:22px;font-weight:800;color:#1E293B;text-align:center;margin-bottom:6px;}
  .login-sub{font-size:14px;color:#64748B;text-align:center;margin-bottom:24px;}
  .field{display:flex;flex-direction:column;gap:6px;margin-bottom:16px;}
  .field-row{display:grid;grid-template-columns:1fr 1fr;gap:12px;}
  .label{font-size:11px;font-weight:700;color:#64748B;text-transform:uppercase;letter-spacing:.5px;}
  .input{width:100%;border:1.5px solid #E2E8F0;border-radius:10px;padding:11px 14px;font-size:14px;font-family:'Instrument Sans',sans-serif;color:#1E293B;outline:none;background:#fff;transition:border .15s;}
  .input:focus{border-color:#FF6B2C;} .textarea{resize:vertical;min-height:80px;}
  .cuisine-picker{display:flex;flex-wrap:wrap;gap:6px;padding:10px;border:1.5px solid #E2E8F0;border-radius:10px;max-height:200px;overflow-y:auto;background:#fff;}
  .cuisine-opt{font-size:12px;font-weight:500;padding:5px 10px;border-radius:20px;border:1.5px solid #E2E8F0;cursor:pointer;background:#F8FAFC;color:#475569;transition:all .15s;user-select:none;}
  .cuisine-opt.selected{background:#FF6B2C;color:#fff;border-color:#FF6B2C;font-weight:600;}
  .input-pwd{position:relative;} .input-pwd .input{padding-right:44px;}
  .pwd-toggle{position:absolute;right:12px;top:50%;transform:translateY(-50%);background:none;border:none;cursor:pointer;padding:4px;}
  .role-selector{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:20px;}
  .role-btn{padding:14px 10px;border-radius:12px;border:2px solid #E2E8F0;background:#fff;cursor:pointer;transition:all .15s;text-align:center;display:flex;flex-direction:column;align-items:center;gap:6px;font-family:'Instrument Sans',sans-serif;}
  .role-btn span:first-of-type{font-size:14px;font-weight:700;color:#1E293B;} .role-btn p{font-size:11px;color:#94A3B8;line-height:1.3;}
  .role-btn.active{border-color:#FF6B2C;background:#FFF0E8;} .role-btn.active span:first-of-type{color:#FF6B2C;}
  .btn-primary{width:100%;padding:13px;border-radius:12px;border:none;background:#FF6B2C;color:#fff;font-size:15px;font-weight:700;cursor:pointer;font-family:'Instrument Sans',sans-serif;display:flex;align-items:center;justify-content:center;gap:8px;transition:background .15s;margin-top:4px;}
  .btn-primary:hover:not(:disabled){background:#E55A1F;} .btn-primary:disabled{opacity:.6;cursor:not-allowed;}
  .btn-secondary{width:100%;padding:12px;border-radius:12px;border:1.5px solid #E2E8F0;background:#fff;font-size:14px;font-weight:700;cursor:pointer;font-family:'Instrument Sans',sans-serif;color:#1E293B;transition:all .15s;}
  .btn-secondary:hover{border-color:#FF6B2C;color:#FF6B2C;}
  .btn-link{display:block;width:100%;text-align:center;margin-top:16px;background:none;border:none;color:#64748B;font-size:13px;font-weight:600;cursor:pointer;font-family:'Instrument Sans',sans-serif;}
  .btn-link:hover{color:#FF6B2C;}
  .divider{display:flex;align-items:center;gap:10px;margin:20px 0;}
  .divider::before,.divider::after{content:'';flex:1;height:1px;background:#E2E8F0;}
  .divider span{font-size:12px;color:#94A3B8;white-space:nowrap;}
  .error-msg{background:#FEF2F2;border:1.5px solid #FECACA;color:#DC2626;border-radius:10px;padding:10px 14px;font-size:13px;font-weight:600;margin-bottom:12px;}
  .info-box{background:#EFF6FF;border:1.5px solid #BFDBFE;color:#1D4ED8;border-radius:10px;padding:10px 14px;font-size:13px;margin-bottom:16px;line-height:1.5;}
  .step-badge{background:#FFF0E8;color:#FF6B2C;font-size:12px;font-weight:700;padding:4px 12px;border-radius:20px;display:inline-block;margin-bottom:12px;}
  .spinner{width:20px;height:20px;border:2.5px solid rgba(255,255,255,.3);border-top-color:#fff;border-radius:50%;animation:spin .7s linear infinite;}
  @keyframes spin{to{transform:rotate(360deg);}}

  /* ═══════════ RESPONSIVE ═══════════ */
  @media(max-width:768px){
    .input,.textarea,select{font-size:16px;} /* évite le zoom iOS au focus */
  }
  @media(max-width:480px){
    .login-wrap{padding:12px;padding-top:calc(20px + env(safe-area-inset-top));align-items:flex-start;}
    .login-card{padding:28px 20px;border-radius:20px;}
    .login-title{font-size:20px;}
    .field-row{grid-template-columns:1fr;}
  }
  ${TOUCH_CSS}
`;
