"use client";
/**
 * admin/instance.jsx — Fiche de l'instance (console éditeur, mode mono-restaurant).
 * Source : GET /api/v1/branding/instance/ (réservé au rôle administration).
 * Affiche : licencié, domaine, version déployée, date de mise en service, état des services
 * (base, Redis, Cloudinary, SMTP, clés push), activité et journal technique récent.
 */
import { useEffect, useState } from "react";

const fmtDate = (iso) => iso ? new Date(iso).toLocaleString("fr-BE", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";
const fmtDay = (iso) => iso ? new Date(iso).toLocaleDateString("fr-BE", { day: "2-digit", month: "long", year: "numeric" }) : "—";

function Dot({ ok, label, detail }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 12px", borderRadius: 10, background: ok ? "#F0FDF4" : "#FEF2F2", border: `1px solid ${ok ? "#BBF7D0" : "#FECACA"}` }}>
      <span style={{ width: 9, height: 9, borderRadius: "50%", background: ok ? "#16A34A" : "#DC2626", flexShrink: 0 }} />
      <span style={{ fontSize: 13, fontWeight: 700, color: "#1E293B" }}>{label}</span>
      <span style={{ fontSize: 12, color: "#64748B", marginLeft: "auto", textAlign: "right", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 220 }}>{detail}</span>
    </div>
  );
}

function Row({ k, v, mono = false }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "7px 0", borderBottom: "1px solid #F1F5F9", fontSize: 13 }}>
      <span style={{ color: "#64748B", fontWeight: 600, flexShrink: 0 }}>{k}</span>
      <span style={{ fontWeight: 600, color: "#1E293B", textAlign: "right", fontFamily: mono ? "ui-monospace, Menlo, monospace" : "inherit", fontSize: mono ? 12 : 13, overflowWrap: "anywhere" }}>{v || "—"}</span>
    </div>
  );
}

export function useInstanceInfo(enabled, get, refreshKey = 0) {
  const [info, setInfo] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    get("/branding/instance/").then((d) => { if (!cancelled) { setInfo(d); setError(null); } }).catch((e) => { if (!cancelled) setError(e.message); });
    return () => { cancelled = true; };
  }, [enabled, get, refreshKey]);
  return { info, error };
}

export default function InstanceCard({ info, error, compact = false }) {
  if (error) return <div className="empty-sm">Fiche d'instance indisponible : {error}</div>;
  if (!info) return <div className="empty-sm">Chargement de la fiche d'instance…</div>;
  const { licensee, domain, version, services, activity, log } = info;
  const commit = version.commit ? version.commit.slice(0, 10) : "";
  return (
    <div>
      <div className="card-hd"><h3 className="card-title">🧾 Fiche de l'instance</h3><span style={{ fontSize: 12, color: "#64748B" }}>Mode {info.mode} · fuseau {info.timezone}{info.powered_by_badge ? " · mention « propulsé par » affichée" : " · mention « propulsé par » retirée"}</span></div>
      <div style={{ display: "grid", gridTemplateColumns: compact ? "1fr" : "repeat(auto-fit,minmax(260px,1fr))", gap: 18 }}>
        <div>
          <p className="kpi-label">Licencié</p>
          <Row k="Application" v={licensee.app_name} />
          <Row k="Restaurant" v={licensee.restaurant_name} />
          <Row k="Titulaire" v={licensee.owner_name ? `${licensee.owner_name} · ${licensee.owner_email}` : licensee.owner_email} />
          <Row k="Mise en service" v={fmtDay(licensee.since)} />
          <Row k="Identifiant" v={licensee.restaurant_id} mono />
        </div>
        <div>
          <p className="kpi-label">Domaine et version</p>
          <Row k="Domaine public" v={domain.frontend_url ? <a href={domain.frontend_url} target="_blank" rel="noopener noreferrer" style={{ color: "#6366F1" }}>{domain.frontend_url}</a> : "—"} />
          <Row k="API" v={domain.api_url} mono />
          <Row k="Version déployée" v={commit ? `${commit}${version.branch ? ` (${version.branch})` : ""}` : "inconnue (hors Render)"} mono />
          <Row k="Dernier démarrage" v={fmtDate(version.started_at)} />
          <Row k="Environnement" v={`${version.env}${version.debug ? " · DEBUG" : ""}${version.service ? ` · ${version.service}` : ""}`} />
        </div>
        <div>
          <p className="kpi-label">Services</p>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <Dot ok={!!services.database} label="Base de données" detail={services.database} />
            <Dot ok={services.redis} label="Redis (temps réel, cache)" detail={services.redis ? "configuré" : "mémoire locale (1 processus)"} />
            <Dot ok={services.cloudinary} label="Images Cloudinary" detail={services.cloudinary ? `dossier ${services.cloudinary_folder}` : "stockage local"} />
            <Dot ok={services.smtp} label="E-mails SMTP" detail={services.smtp ? services.email_from : "console (non envoyés)"} />
            <Dot ok={services.push} label="Clés push VAPID" detail={services.push ? services.push_contact : "non configurées"} />
          </div>
        </div>
        <div>
          <p className="kpi-label">Activité</p>
          <Row k="Commandes (hors annulées)" v={activity.orders} />
          <Row k="Chiffre d'affaires traité" v={`${parseFloat(activity.revenue || 0).toFixed(2)} €`} />
          <Row k="Clients inscrits" v={activity.clients} />
          <Row k="Clients actifs (30 j)" v={activity.active_clients_30d} />
          <Row k="Dernière commande" v={fmtDate(activity.last_order_at)} />
        </div>
      </div>
      {!compact && (
        <div style={{ marginTop: 18 }}>
          <p className="kpi-label">Journal technique récent (avertissements et erreurs du processus)</p>
          {(!log || log.length === 0) ? <div className="empty-sm">Aucun avertissement depuis le dernier démarrage.</div> : (
            <div style={{ maxHeight: 260, overflowY: "auto", border: "1px solid #E2E8F0", borderRadius: 10, fontFamily: "ui-monospace, Menlo, monospace", fontSize: 11 }}>
              {log.map((l, i) => (
                <div key={i} style={{ display: "flex", gap: 10, padding: "6px 10px", borderBottom: "1px solid #F1F5F9", color: l.level === "ERROR" || l.level === "CRITICAL" ? "#B91C1C" : "#92400E" }}>
                  <span style={{ color: "#94A3B8", flexShrink: 0 }}>{fmtDate(l.time)}</span>
                  <span style={{ fontWeight: 700, flexShrink: 0 }}>{l.level}</span>
                  <span style={{ color: "#64748B", flexShrink: 0 }}>{l.logger}</span>
                  <span style={{ overflowWrap: "anywhere" }}>{l.message}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
