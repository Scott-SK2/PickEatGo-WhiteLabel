"use client";
/**
 * dashboard/shared.jsx — helpers partagés par le dashboard restaurateur
 * (client HTTP, icônes, constantes, formatage).
 */

export const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000/api/v1";

import { apiFetch as coreFetch, apiFetchRaw } from "../../lib/api";

/** Client HTTP du dashboard : JWT avec refresh automatique, nouvelles tentatives si le serveur ne répond pas. */
export const apiFetch = (endpoint, options = {}) => coreFetch(endpoint, options);
export const get    = (url)       => apiFetch(url);
export const post   = (url, body) => apiFetch(url, { method:"POST",  body:JSON.stringify(body) });
export const patch  = (url, body) => apiFetch(url, { method:"PATCH", body:JSON.stringify(body) });
export const put    = (url, body) => apiFetch(url, { method:"PUT",   body:JSON.stringify(body) });
export const del    = (url)       => apiFetch(url, { method:"DELETE" });
export const upload = (url, fd)   => apiFetch(url, { method:"POST",  body:fd });

/** Télécharge un fichier protégé par JWT (export CSV / Excel). */
export async function downloadFile(endpoint, filename) {
  const res = await apiFetchRaw(endpoint);
  if (!res.ok) throw new Error(`Export impossible (${res.status})`);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; document.body.appendChild(a); a.click();
  a.remove(); URL.revokeObjectURL(url);
}

// ─── Formatage ───────────────────────────────────────────────────────────────
export const money = (v) => `${parseFloat(v || 0).toFixed(2)} €`;
export const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
};
export const shiftISO = (days) => {
  const d = new Date(); d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
};
export const fmtDate = (iso) => iso ? new Date(iso + (iso.length === 10 ? "T00:00:00" : "")).toLocaleDateString("fr-BE", { day:"2-digit", month:"short", year: iso.length === 10 ? undefined : "numeric" }) : "";
export const fmtDateTime = (iso) => iso ? new Date(iso).toLocaleString("fr-BE", { day:"2-digit", month:"2-digit", hour:"2-digit", minute:"2-digit" }) : "";

// ─── Constantes ──────────────────────────────────────────────────────────────
export const STATUS_CONFIG = {
  nouvelle:   {label:"Nouvelle",   color:"#3B82F6",bg:"#EFF6FF",next:"confirmee",  nextLabel:"Confirmer"},
  confirmee:  {label:"Confirmée",  color:"#F59E0B",bg:"#FFFBEB",next:"en_cuisine", nextLabel:"En cuisine"},
  en_cuisine: {label:"En cuisine", color:"#8B5CF6",bg:"#F5F3FF",next:"prete",      nextLabel:"Prête !"},
  prete:      {label:"Prête 🎉",   color:"#10B981",bg:"#ECFDF5",next:"recuperee",  nextLabel:"Récupérée"},
  en_livraison:{label:"En livraison 🛵",color:"#0EA5E9",bg:"#F0F9FF",next:"recuperee",nextLabel:"Livrée"},
  recuperee:  {label:"Récupérée",  color:"#6B7280",bg:"#F9FAFB",next:null,         nextLabel:null},
  annulee:    {label:"Annulée",    color:"#EF4444",bg:"#FEF2F2",next:null,         nextLabel:null},
};
/** Étape suivante d'une commande selon son type (une livraison passe par « En livraison »). */
export const nextStep = (order) => {
  const sc = STATUS_CONFIG[order.status] || STATUS_CONFIG.nouvelle;
  if (order.status === "prete" && order.order_type === "livraison") return { next: "en_livraison", nextLabel: "Partie en livraison" };
  if (order.status === "recuperee" && order.order_type === "livraison") return { next: null, nextLabel: null };
  return { next: sc.next, nextLabel: sc.nextLabel };
};
/** Étape à laquelle on encaisse : à la remise, ou à la livraison pour une commande livrée. */
export const payStep = (order) => order.order_type === "livraison" ? "en_livraison" : "prete";
export const statusLabel = (order) => order.status === "recuperee" && order.order_type === "livraison" ? "Livrée" : (STATUS_CONFIG[order.status] || {}).label || order.status;
export const PAYMENT_LABELS = { especes:"💵 Espèces", carte:"💳 Carte", en_ligne:"🌐 En ligne", "":"Non renseigné" };
export const TYPE_LABELS    = { sur_place:"🪑 Sur place", emporter:"🥡 Emporter", livraison:"🛵 Livraison", comptoir:"🧾 Comptoir" };
export const REASON_LABELS  = { vente:"Vente", reappro:"Réappro", perte:"Perte", inventaire:"Inventaire", annulation:"Annulation", ajustement:"Ajustement" };
export const REASON_COLORS  = { vente:"#3B82F6", reappro:"#10B981", perte:"#EF4444", inventaire:"#6366F1", annulation:"#F59E0B", ajustement:"#64748B" };
export const UNIT_LABELS    = { g:"g", kg:"kg", ml:"ml", l:"l", pc:"pièce(s)" };
/** Quantité décimale → texte court (12.500 → "12,5"). */
export const qty = (v, unit) => {
  const n = parseFloat(v || 0);
  const s = Number.isInteger(n) ? String(n) : n.toFixed(3).replace(/\.?0+$/, "").replace(".", ",");
  return unit ? `${s} ${UNIT_LABELS[unit] || unit}` : s;
};

// ─── Icônes ──────────────────────────────────────────────────────────────────
export const Ic = ({n,s=18,c="currentColor"}) => ({
  dashboard:<svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>,
  orders:   <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>,
  menu:     <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18M3 12h18M3 18h18"/></svg>,
  stats:    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>,
  sales:    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 2h16v20l-3-2-2 2-3-2-3 2-2-2-3 2z"/><path d="M8 7h8M8 11h8M8 15h5"/></svg>,
  stock:    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 8l-9-5-9 5v8l9 5 9-5z"/><path d="M3 8l9 5 9-5"/><path d="M12 13v8"/></svg>,
  settings: <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06-.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>,
  staff:    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>,
  check:    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>,
  x:        <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>,
  plus:     <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2.5" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>,
  minus:    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2.5" strokeLinecap="round"><line x1="5" y1="12" x2="19" y2="12"/></svg>,
  edit:     <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>,
  trash:    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>,
  bell:     <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>,
  clock:    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>,
  euro:     <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round"><path d="M4 10h12M4 14h12"/><path d="M19 6a7 7 0 1 0 0 12"/></svg>,
  logout:   <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>,
  photo:    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>,
  refresh:  <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>,
  download: <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>,
  cash:     <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="3"/><path d="M6 12h.01M18 12h.01"/></svg>,
  card:     <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/></svg>,
  warning:  <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>,
  lock:     <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>,
  search:   <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>,
  leaf:     <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10z"/><path d="M2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 13 12"/></svg>,
  truck:    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="1" y="3" width="15" height="13"/><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg>,
  list:     <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>,
}[n] || null);
