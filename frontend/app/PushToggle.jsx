"use client";
/**
 * PushToggle — active / désactive les notifications push sur cet appareil.
 *   variant "banner" : encart discret (page de suivi de commande)
 *   variant "row"    : ligne avec interrupteur (profil client, paramètres restaurateur)
 */
import { useEffect, useState } from "react";
import { getPushState, enablePush, disablePush, sendTestPush } from "../lib/push";

export default function PushToggle({ variant = "row", label = "Notifications sur cet appareil", hint, withTest = false, onMessage }) {
  const [state, setState] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const refresh = () => getPushState().then(setState).catch(() => setState({ supported: false }));
  useEffect(() => { refresh(); }, []);

  const say = (text, ok = true) => { setMsg(text); onMessage && onMessage(text, ok); };
  const toggle = async () => {
    if (!state) return;
    setBusy(true); setMsg("");
    try {
      if (state.subscribed) { await disablePush(); say("Notifications désactivées sur cet appareil."); }
      else { await enablePush(); say("Notifications activées ✓"); }
      await refresh();
    } catch (e) { say(e.message, false); }
    finally { setBusy(false); }
  };
  const test = async () => {
    setBusy(true);
    try { const n = await sendTestPush(); say(n ? "Notification de test envoyée." : "Aucun appareil abonné.", !!n); }
    catch (e) { say(e.message, false); }
    finally { setBusy(false); }
  };

  if (!state || !state.supported) return null;                          // navigateur sans push : rien à afficher
  if (!state.enabled && variant === "banner") return null;              // serveur non configuré : pas de bannière
  const denied = state.permission === "denied";

  if (variant === "banner") {
    if (state.subscribed) return null;
    return (
      <div style={{ margin: "14px 0", background: "#EFF6FF", border: "1px solid #BFDBFE", borderRadius: 12, padding: "12px 14px", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <span style={{ fontSize: 13, color: "#1E3A8A", flex: 1, minWidth: 180 }}>🔔 Recevez une notification dès que votre commande est prête, même si l'application est fermée.</span>
        {denied
          ? <span style={{ fontSize: 12, color: "#B45309" }}>Notifications bloquées dans le navigateur.</span>
          : <button onClick={toggle} disabled={busy} style={{ background: "#1D4ED8", color: "#fff", border: "none", borderRadius: 10, padding: "8px 14px", fontWeight: 700, fontSize: 13, cursor: "pointer", fontFamily: "inherit" }}>{busy ? "…" : "Activer"}</button>}
        {msg && <span style={{ fontSize: 12, width: "100%", color: "#475569" }}>{msg}</span>}
      </div>
    );
  }

  return (
    <div style={{ padding: "10px 0" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <div style={{ flex: 1 }}>
          <p style={{ fontWeight: 700, fontSize: 14 }}>🔔 {label}</p>
          <p style={{ fontSize: 12, color: "#64748B", marginTop: 2 }}>
            {!state.enabled ? "Pas encore disponible sur ce serveur (clés VAPID absentes)."
              : denied ? "Bloquées par le navigateur : autorisez-les dans ses réglages du site."
              : hint || (state.subscribed ? "Actives sur cet appareil." : "Désactivées sur cet appareil.")}
          </p>
        </div>
        <button onClick={toggle} disabled={busy || !state.enabled || denied} aria-label={state.subscribed ? "Désactiver" : "Activer"}
          style={{ width: 54, height: 32, borderRadius: 16, border: "none", cursor: "pointer", position: "relative", background: state.subscribed ? "#16A34A" : "#CBD5E1", opacity: (!state.enabled || denied) ? .5 : 1, transition: "background .2s" }}>
          <span style={{ position: "absolute", top: 3, left: state.subscribed ? 25 : 3, width: 26, height: 26, borderRadius: "50%", background: "#fff", transition: "left .2s", boxShadow: "0 1px 3px rgba(0,0,0,.3)" }} />
        </button>
      </div>
      {withTest && state.subscribed && <button onClick={test} disabled={busy} style={{ marginTop: 8, background: "none", border: "1.5px solid #E2E8F0", borderRadius: 8, padding: "6px 10px", fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>Envoyer une notification de test</button>}
      {msg && <p style={{ fontSize: 12, color: "#475569", marginTop: 6 }}>{msg}</p>}
    </div>
  );
}
