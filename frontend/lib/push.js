/**
 * lib/push.js — notifications push côté navigateur (service worker + Web Push).
 *
 *   getPushState()      → { supported, permission, enabled (serveur), subscribed }
 *   enablePush()        → demande la permission, s'abonne, enregistre l'abonnement côté API
 *   disablePush()       → se désabonne (navigateur + API)
 */
const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000/api/v1";

import { apiFetchRaw } from "./api";
// Toutes les requêtes passent par le client central (JWT renouvelé automatiquement)

export function isPushSupported() {
  return typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

export async function registerServiceWorker() {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return null;
  try { return await navigator.serviceWorker.register("/sw.js"); } catch { return null; }
}

function urlBase64ToUint8Array(base64) {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  return Uint8Array.from([...raw].map(c => c.charCodeAt(0)));
}

async function serverKey() {
  try { const r = await fetch(`${API}/notifications/push/key/`); const d = await r.json(); return d.enabled ? d.public_key : null; }
  catch { return null; }
}

export async function getPushState() {
  const state = { supported: isPushSupported(), permission: "default", enabled: false, subscribed: false };
  if (!state.supported) return state;
  state.permission = Notification.permission;
  state.enabled = !!(await serverKey());
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = reg && (await reg.pushManager.getSubscription());
    if (sub) {
      const r = await apiFetchRaw(`/notifications/push/subscription/?endpoint=${encodeURIComponent(sub.endpoint)}`);
      state.subscribed = r.ok ? (await r.json()).subscribed : false;
    }
  } catch {}
  return state;
}

export async function enablePush() {
  if (!isPushSupported()) throw new Error("Notifications non prises en charge par ce navigateur.");
  const key = await serverKey();
  if (!key) throw new Error("Les notifications ne sont pas encore activées sur le serveur.");
  const reg = (await navigator.serviceWorker.getRegistration()) || (await registerServiceWorker());
  if (!reg) throw new Error("Service worker indisponible.");
  const permission = await Notification.requestPermission();
  if (permission !== "granted") throw new Error("Permission refusée. Autorisez les notifications dans les réglages du navigateur.");
  await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(key) });
  const r = await apiFetchRaw(`/notifications/push/subscription/`, { method: "POST", body: JSON.stringify(sub.toJSON()) });
  if (!r.ok) throw new Error("Impossible d'enregistrer l'abonnement.");
  return true;
}

export async function disablePush() {
  if (!isPushSupported()) return;
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = reg && (await reg.pushManager.getSubscription());
  if (!sub) return;
  await apiFetchRaw(`/notifications/push/subscription/`, { method: "DELETE", body: JSON.stringify({ endpoint: sub.endpoint }) }).catch(() => {});
  await sub.unsubscribe().catch(() => {});
}

export async function sendTestPush() {
  const r = await apiFetchRaw(`/notifications/push/test/`, { method: "POST" });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.detail || "Envoi impossible");
  return d.sent;
}
