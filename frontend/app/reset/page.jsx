"use client";
import { TOUCH_CSS } from "../../lib/touch.css";
import { useBrand } from "../../lib/BrandContext";
/** /reset?uid=…&token=… — nouveau mot de passe depuis le lien reçu par e-mail. */
import { Suspense, useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000/api/v1";

function ResetForm() {
  const params = useSearchParams();
  const router = useRouter();
  const uid = params.get("uid") || "", token = params.get("token") || "";
  // Le jeton ne reste pas dans l'historique du navigateur
  useEffect(() => { if (uid && token) window.history.replaceState(null, "", "/reset"); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const [pwd, setPwd] = useState(""); const [pwd2, setPwd2] = useState("");
  const [msg, setMsg] = useState(null); const [loading, setLoading] = useState(false); const [done, setDone] = useState(false);

  const submit = async (e) => {
    e.preventDefault(); setMsg(null);
    if (pwd.length < 8) { setMsg({ ok: false, text: "Minimum 8 caractères." }); return; }
    if (pwd !== pwd2) { setMsg({ ok: false, text: "Les mots de passe ne correspondent pas." }); return; }
    setLoading(true);
    try {
      const r = await fetch(`${API}/auth/password-reset/confirm/`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ uid, token, new_password: pwd }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.detail || "Lien invalide.");
      setDone(true); setMsg({ ok: true, text: d.detail });
      setTimeout(() => router.push("/login"), 2500);
    } catch (err) { setMsg({ ok: false, text: err.message }); }
    finally { setLoading(false); }
  };

  if (!uid || !token) return <div className="error-msg">⚠️ Lien incomplet. Refaites une demande depuis la page de connexion.</div>;
  return (
    <form onSubmit={submit}>
      <div className="field"><label className="label">Nouveau mot de passe</label>
        <input className="input" type="password" placeholder="Min. 8 caractères" value={pwd} onChange={e => setPwd(e.target.value)} required autoFocus /></div>
      <div className="field"><label className="label">Confirmer</label>
        <input className="input" type="password" placeholder="••••••••" value={pwd2} onChange={e => setPwd2(e.target.value)} required /></div>
      {msg && <div className={msg.ok ? "info-box" : "error-msg"}>{msg.ok ? "✓ " : "⚠️ "}{msg.text}{msg.ok && " Redirection…"}</div>}
      {!done && <button type="submit" className="btn-primary" disabled={loading}>{loading ? "…" : "Enregistrer le mot de passe"}</button>}
    </form>
  );
}

function BrandLogo() {
  const { single, brand, restaurant } = useBrand();     // marque blanche : nom et logo du restaurant
  return (
    <div className="login-logo">
      {single && restaurant?.logo_url
        ? <img src={restaurant.logo_url} alt="" style={{width:44,height:44,borderRadius:12,objectFit:"cover"}}/>
        : <span className="logo-icon">{single ? (restaurant?.emoji || "🍽️") : "🍔"}</span>}
      <span className="logo-text">{single ? brand.app_name : "PickEatGo"}</span>
    </div>
  );
}

export default function ResetPage() {
  return (
    <><style>{CSS}</style>
    <div className="login-wrap">
      <div className="login-card">
        <BrandLogo/>
        <h1 className="login-title">Nouveau mot de passe</h1>
        <p className="login-sub">Choisissez un mot de passe que vous n'utilisez nulle part ailleurs.</p>
        <Suspense fallback={null}><ResetForm /></Suspense>
        <a className="btn-link" href="/login">← Retour à la connexion</a>
      </div>
    </div></>
  );
}

const CSS = `
  *,*::before,*::after{box-sizing:border-box;margin:0;padding:0;}
  body{font-family:'Instrument Sans',sans-serif;background:#F8FAFC;color:#1E293B;}
  .login-wrap{min-height:100vh;min-height:100dvh;display:flex;align-items:center;justify-content:center;padding:20px;background:linear-gradient(135deg,#FFF0E8 0%,#F8FAFC 50%,#EEF2FF 100%);}
  .login-card{background:#fff;border-radius:24px;padding:40px;width:100%;max-width:440px;box-shadow:0 8px 48px rgba(0,0,0,.1);}
  .login-logo{display:flex;align-items:center;gap:10px;justify-content:center;margin-bottom:28px;}
  .logo-icon{font-size:32px;} .logo-text{font-family:'Sora',sans-serif;font-size:22px;font-weight:800;}
  .login-title{font-family:'Sora',sans-serif;font-size:22px;font-weight:800;text-align:center;margin-bottom:6px;}
  .login-sub{font-size:14px;color:#64748B;text-align:center;margin-bottom:24px;}
  .field{display:flex;flex-direction:column;gap:6px;margin-bottom:16px;}
  .label{font-size:11px;font-weight:700;color:#64748B;text-transform:uppercase;letter-spacing:.5px;}
  .input{width:100%;border:1.5px solid #E2E8F0;border-radius:10px;padding:11px 14px;font-size:16px;font-family:inherit;outline:none;}
  .input:focus{border-color:#FF6B2C;}
  .btn-primary{width:100%;padding:13px;border-radius:12px;border:none;background:#FF6B2C;color:#fff;font-size:15px;font-weight:700;cursor:pointer;font-family:inherit;}
  .btn-primary:disabled{opacity:.6;}
  .btn-link{display:block;text-align:center;margin-top:16px;color:#64748B;font-size:13px;font-weight:600;text-decoration:none;}
  .error-msg{background:#FEF2F2;border:1.5px solid #FECACA;color:#DC2626;border-radius:10px;padding:10px 14px;font-size:13px;font-weight:600;margin-bottom:12px;}
  .info-box{background:#F0FDF4;border:1.5px solid #BBF7D0;color:#166534;border-radius:10px;padding:10px 14px;font-size:13px;margin-bottom:12px;}
  @media(max-width:480px){.login-wrap{padding:12px;align-items:flex-start;}.login-card{padding:28px 20px;}}
  ${TOUCH_CSS}
`;
