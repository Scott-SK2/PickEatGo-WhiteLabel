"use client";
/**
 * dashboard/myapp.jsx — Carte « Mon application » (Paramètres, mode mono-restaurant).
 *
 * Blocs : Identité (nom, nom court, slogan, texte d'accueil, aperçu barre du haut et écran d'accueil),
 * Icônes (envoi ou génération depuis le logo, aperçus 192 / 512 / maskable, image de partage),
 * Coordonnées et réseaux, Textes légaux (modèles pré-remplis, indicateur « à compléter »),
 * Lien et QR code, État de publication.
 *
 * Toutes les écritures passent par PATCH /branding/ et POST /branding/icons/ ; la réponse
 * (marque + état de publication) remplace l'état local et le contexte de marque est rafraîchi.
 */
import { useEffect, useRef, useState } from "react";
import { useBrand } from "../../lib/BrandContext";
import { apiFetch, upload, Ic } from "./shared";
import { LEGAL_TEMPLATES } from "./legalTemplates";

const LIMITS = { app_name: 40, short_name: 12, tagline: 120, welcome_text: 300 };
const SOCIALS = [["website", "Site web", "https://www.monrestaurant.be"], ["facebook", "Facebook", "https://facebook.com/monrestaurant"], ["instagram", "Instagram", "https://instagram.com/monrestaurant"], ["tiktok", "TikTok", "https://tiktok.com/@monrestaurant"]];

function Counter({ value, max }) {
  const n = (value || "").length;
  return <span style={{ fontSize: 11, color: n > max ? "#DC2626" : "#94A3B8", fontWeight: 600 }}>{n}/{max}</span>;
}

function Field({ label, max, value, onChange, placeholder, textarea = false, rows = 3, hint }) {
  return (
    <div>
      <label className="fl" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>{label}{max && <Counter value={value} max={max} />}</label>
      {textarea
        ? <textarea className="fi" rows={rows} value={value || ""} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
        : <input className="fi" value={value || ""} placeholder={placeholder} maxLength={max ? max + 20 : undefined} onChange={(e) => onChange(e.target.value)} />}
      {hint && <p style={{ fontSize: 11, color: "#94A3B8", marginTop: 4 }}>{hint}</p>}
    </div>
  );
}

/** Aperçu en direct : barre du haut du site client et icône sur un écran d'accueil. */
function LivePreview({ form, restaurant, icon }) {
  const logo = icon || restaurant?.logo_url;
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 14, alignItems: "stretch" }}>
      <div style={{ border: "1.5px solid var(--border)", borderRadius: 12, overflow: "hidden", background: "#F8F9FB" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 12px", background: "#fff", borderBottom: "1px solid var(--border)" }}>
          {logo ? <img src={logo} alt="" style={{ width: 28, height: 28, borderRadius: 8, objectFit: "cover" }} /> : <span style={{ fontSize: 20 }}>{restaurant?.emoji || "🍽️"}</span>}
          <span style={{ fontFamily: "'Sora',sans-serif", fontWeight: 800, fontSize: 14, color: "#1E293B", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{form.app_name || "Nom de l'application"}</span>
          <span style={{ marginLeft: "auto", fontSize: 11, fontWeight: 700, color: "#FF6B2C", background: "#FFF0E8", borderRadius: 8, padding: "4px 8px" }}>Carte</span>
          <span style={{ width: 26, height: 26, borderRadius: 8, background: "#FF6B2C" }} />
        </div>
        <div style={{ padding: "14px 12px" }}>
          <p style={{ fontFamily: "'Sora',sans-serif", fontWeight: 800, fontSize: 16, color: "#1E293B", lineHeight: 1.2 }}>{form.tagline || "Commandez en ligne, récupérez sur place."}</p>
          <p style={{ fontSize: 11, color: "#64748B", marginTop: 6, lineHeight: 1.4 }}>{form.welcome_text || "Votre texte d'accueil apparaîtra ici."}</p>
          <span style={{ display: "inline-block", marginTop: 10, fontSize: 11, fontWeight: 700, color: "#fff", background: "#FF6B2C", borderRadius: 8, padding: "6px 10px" }}>Commander →</span>
        </div>
      </div>
      <div style={{ width: 92, borderRadius: 16, background: "linear-gradient(160deg,#1E293B,#334155)", padding: "14px 8px", display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }} title="Écran d'accueil du téléphone">
        <div style={{ width: 52, height: 52, borderRadius: 14, background: "#fff", overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 4px 12px rgba(0,0,0,.3)" }}>
          {logo ? <img src={logo} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <span style={{ fontSize: 26 }}>{restaurant?.emoji || "🍽️"}</span>}
        </div>
        <span style={{ fontSize: 10, color: "#fff", fontWeight: 600, textAlign: "center", maxWidth: 80, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{form.short_name || "Nom court"}</span>
      </div>
    </div>
  );
}

function IconPreview({ src, size, label, mask }) {
  const px = 72;
  const style = { width: px, height: px, objectFit: "cover", background: "#fff", borderRadius: mask === "ios" ? px * 0.22 : mask === "android" ? "50%" : 12 };
  return (
    <div style={{ textAlign: "center" }}>
      <div style={{ width: px, height: px, borderRadius: style.borderRadius, border: "1.5px dashed var(--border)", overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto", background: "#F8FAFC" }}>
        {src ? <img src={src} alt="" style={style} /> : <span style={{ fontSize: 10, color: "#94A3B8" }}>{size}</span>}
      </div>
      <p style={{ fontSize: 11, color: "#64748B", marginTop: 6, fontWeight: 600 }}>{label}</p>
    </div>
  );
}

function QrBlock({ url }) {
  const canvasRef = useRef(null);
  const [dataUrl, setDataUrl] = useState(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!url) return;
    let cancelled = false;
    import("qrcode").then((QR) => QR.toDataURL(url, { width: 512, margin: 2, color: { dark: "#0F172A", light: "#FFFFFF" } }))
      .then((d) => { if (!cancelled) setDataUrl(d); })
      .catch(() => setDataUrl(null));
    return () => { cancelled = true; };
  }, [url]);
  const copy = async () => { try { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch {} };
  return (
    <div style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
      <div style={{ width: 132, height: 132, border: "1.5px solid var(--border)", borderRadius: 12, overflow: "hidden", background: "#fff", display: "flex", alignItems: "center", justifyContent: "center" }}>
        {dataUrl ? <img ref={canvasRef} src={dataUrl} alt="QR code de l'application" style={{ width: "100%", height: "100%" }} /> : <span style={{ fontSize: 11, color: "#94A3B8" }}>QR…</span>}
      </div>
      <div style={{ flex: 1, minWidth: 220 }}>
        <label className="fl">Adresse publique de l'application</label>
        <div style={{ display: "flex", gap: 8 }}>
          <input className="fi" readOnly value={url} style={{ flex: 1, fontWeight: 600 }} onFocus={(e) => e.target.select()} />
          <button className="btn-secondary" onClick={copy}>{copied ? "Copié ✓" : "Copier"}</button>
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
          <a className="btn-primary" style={{ textDecoration: "none", pointerEvents: dataUrl ? "auto" : "none", opacity: dataUrl ? 1 : .5 }} href={dataUrl || "#"} download="qr-code-application.png">⬇ Télécharger le QR code (PNG)</a>
          <a className="btn-secondary" style={{ textDecoration: "none" }} href={url} target="_blank" rel="noopener noreferrer">Ouvrir le site ↗</a>
        </div>
        <p style={{ fontSize: 11, color: "#94A3B8", marginTop: 8 }}>À imprimer sur la vitrine, les tickets et les flyers : le client scanne, commande et installe l'application.</p>
      </div>
    </div>
  );
}

export default function MyAppCard({ restaurant, showToast }) {
  const brandCtx = useBrand();
  const [form, setForm] = useState(null);
  const [publication, setPublication] = useState(brandCtx.publication);
  const [saving, setSaving] = useState(false);
  const [iconBusy, setIconBusy] = useState(false);
  const [section, setSection] = useState("identity");
  const brand = brandCtx.brand;

  useEffect(() => {
    if (form) return;
    setForm({
      app_name: brand.app_name || restaurant?.name || "", short_name: brand.short_name || "", tagline: brand.tagline || "", welcome_text: brand.welcome_text || "",
      social_links: { ...(brand.social_links || {}) },
      legal_name: brand.legal_name || "", company_number: brand.company_number || "", vat_number: brand.vat_number || restaurant?.vat_number || "",
      legal_address: brand.legal_address || restaurant?.address || "", publisher: brand.publisher || "",
      terms_text: brand.terms_text || "", privacy_text: brand.privacy_text || "", sender_name: brand.sender_name || "",
    });
    setPublication(brandCtx.publication);
  }, [brand, brandCtx.publication, form, restaurant]);

  if (!form) return null;
  const set = (k) => (v) => setForm((p) => ({ ...p, [k]: v }));
  const publicUrl = (publication?.public_url && !/localhost|127\.0\.0\.1/.test(publication.public_url)) ? publication.public_url : (typeof window !== "undefined" ? window.location.origin : "");

  const save = async (fields) => {
    const body = {};
    (fields || Object.keys(form)).forEach((k) => { body[k] = form[k]; });
    for (const [k, max] of Object.entries(LIMITS)) if (k in body && (body[k] || "").length > max) { showToast(`« ${k === "app_name" ? "Nom de l'application" : k === "short_name" ? "Nom court" : k === "tagline" ? "Slogan" : "Texte d'accueil"} » dépasse ${max} caractères`, "error"); return; }
    if ("app_name" in body && !body.app_name.trim()) { showToast("Le nom de l'application est obligatoire", "error"); return; }
    if ("short_name" in body && !body.short_name.trim()) { showToast("Le nom court est obligatoire", "error"); return; }
    setSaving(true);
    try {
      const r = await apiFetch("/branding/", { method: "PATCH", body: JSON.stringify(body) });
      setPublication(r.publication);
      await brandCtx.refresh();
      showToast("Mon application : enregistré ✓");
    } catch (e) { showToast(e.message, "error"); }
    finally { setSaving(false); }
  };

  const sendIcons = async (file, kind = "icons") => {
    if (file) {
      if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) { showToast("Format non supporté (JPEG, PNG, WebP)", "error"); return; }
      if (file.size > 5 * 1024 * 1024) { showToast("Image trop grande (max 5 MB)", "error"); return; }
    }
    setIconBusy(true);
    try {
      const fd = new FormData();
      fd.append("kind", kind);
      if (file) fd.append("image", file); else fd.append("source", "logo");
      const r = await upload("/branding/icons/", fd);
      setPublication(r.publication);
      await brandCtx.refresh();
      showToast(kind === "share" ? "Image de partage mise à jour ✓" : "Icônes générées ✓");
    } catch (e) { showToast(e.message, "error"); }
    finally { setIconBusy(false); }
  };

  const legalMissing = (brand.missing_legal_fields || []);
  const TABS = [["identity", "Identité"], ["icons", "Icônes"], ["contact", "Coordonnées & réseaux"], ["legal", `Textes légaux${legalMissing.length ? " ⚠" : ""}`], ["link", "Lien & QR code"], ["status", `Publication${publication && !publication.ready ? " ⚠" : " ✓"}`]];

  return (
    <>
      <div className="card-hd" style={{ flexWrap: "wrap", gap: 8 }}>
        <h3 className="card-title">📱 Mon application</h3>
        <span style={{ fontSize: 12, color: "#64748B" }}>Nom, icônes, textes et mentions légales de l'application à votre marque. Visible immédiatement sur le site, le manifest, les e-mails et les tickets.</span>
      </div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 16 }}>
        {TABS.map(([k, l]) => <button key={k} className={`filter-chip ${section === k ? "active" : ""}`} onClick={() => setSection(k)}>{l}</button>)}
      </div>

      {section === "identity" && (
        <div className="grid2">
          <div className="sf">
            <Field label="Nom de l'application *" max={LIMITS.app_name} value={form.app_name} onChange={set("app_name")} placeholder={restaurant?.name} hint="Barre du haut, titre d'onglet, nom d'installation, e-mails, tickets." />
            <Field label="Nom court *" max={LIMITS.short_name} value={form.short_name} onChange={set("short_name")} placeholder="Sous l'icône" hint="Affiché sous l'icône de l'écran d'accueil." />
            <Field label="Slogan" max={LIMITS.tagline} value={form.tagline} onChange={set("tagline")} placeholder="Commander. Récupérer. C'est tout." />
            <Field label="Texte d'accueil" max={LIMITS.welcome_text} value={form.welcome_text} onChange={set("welcome_text")} textarea rows={3} placeholder="Quelques mots pour accueillir vos clients…" />
            <Field label="Nom d'expéditeur des e-mails" max={60} value={form.sender_name} onChange={set("sender_name")} placeholder={form.app_name || "Nom de l'application"} hint={`Les e-mails partent de « ${form.sender_name || form.app_name || "…"}${brandCtx.badge ? " via " + brandCtx.platformName : ""} » ; l'adresse technique reste celle de l'éditeur.`} />
            <button className="btn-primary" style={{ justifyContent: "center" }} disabled={saving} onClick={() => save(["app_name", "short_name", "tagline", "welcome_text", "sender_name"])}>{saving ? "Enregistrement…" : <><Ic n="check" s={14} c="white" /> Enregistrer l'identité</>}</button>
          </div>
          <div>
            <label className="fl">Aperçu en direct</label>
            <LivePreview form={form} restaurant={restaurant} icon={brand.icon_192_url} />
          </div>
        </div>
      )}

      {section === "icons" && (
        <div>
          <p style={{ fontSize: 12, color: "#64748B", marginBottom: 14 }}>Envoyez une image carrée (512 px minimum conseillé) ou générez les icônes depuis votre logo. Les trois tailles (192, 512 et « maskable » Android) sont produites automatiquement, avec une marge de sécurité.</p>
          <div style={{ display: "flex", gap: 20, flexWrap: "wrap", alignItems: "flex-start" }}>
            <IconPreview src={brand.icon_192_url} size="192" label="192 px" />
            <IconPreview src={brand.icon_512_url} size="512" label="512 px" />
            <IconPreview src={brand.icon_192_url} size="iOS" label="Aperçu iOS" mask="ios" />
            <IconPreview src={brand.icon_maskable_url} size="Android" label="Aperçu Android" mask="android" />
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 14, flexWrap: "wrap" }}>
            <label className="btn-primary" style={{ cursor: "pointer", opacity: iconBusy ? .6 : 1 }}>
              {iconBusy ? "Traitement…" : "📷 Envoyer une image carrée"}
              <input type="file" accept="image/jpeg,image/png,image/webp" style={{ display: "none" }} disabled={iconBusy} onChange={(e) => { sendIcons(e.target.files[0]); e.target.value = ""; }} />
            </label>
            <button className="btn-secondary" disabled={iconBusy || !restaurant?.logo_url} title={restaurant?.logo_url ? "" : "Ajoutez d'abord un logo"} onClick={() => sendIcons(null)}>✨ Générer depuis le logo</button>
          </div>
          <div style={{ marginTop: 22, paddingTop: 16, borderTop: "1px solid var(--border)" }}>
            <label className="fl">Image de partage (réseaux sociaux, messageries) · 1200 × 630 px conseillé</label>
            <div style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap", marginTop: 6 }}>
              <div style={{ width: 200, height: 105, borderRadius: 10, border: "1.5px dashed var(--border)", overflow: "hidden", background: "#F8FAFC", display: "flex", alignItems: "center", justifyContent: "center" }}>
                {brand.share_image_url || restaurant?.banner_url
                  ? <img src={brand.share_image_url || restaurant.banner_url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                  : <span style={{ fontSize: 11, color: "#94A3B8" }}>Par défaut : la bannière</span>}
              </div>
              <label className="btn-secondary" style={{ cursor: "pointer" }}>
                🖼 Changer l'image de partage
                <input type="file" accept="image/jpeg,image/png,image/webp" style={{ display: "none" }} disabled={iconBusy} onChange={(e) => { sendIcons(e.target.files[0], "share"); e.target.value = ""; }} />
              </label>
            </div>
          </div>
        </div>
      )}

      {section === "contact" && (
        <div className="grid2">
          <div>
            <label className="fl">Coordonnées (reprises du profil du restaurant)</label>
            <div style={{ background: "#F8FAFC", border: "1px solid var(--border)", borderRadius: 12, padding: "12px 14px", fontSize: 13, lineHeight: 1.7 }}>
              <div>📍 {restaurant?.address || <em style={{ color: "#94A3B8" }}>adresse à compléter dans « Profil restaurant »</em>}{restaurant?.city ? `, ${restaurant.city}` : ""}</div>
              <div>📞 {restaurant?.phone || <em style={{ color: "#94A3B8" }}>téléphone à compléter</em>}</div>
              <div>✉️ {restaurant?.email || <em style={{ color: "#94A3B8" }}>e-mail de contact à compléter</em>}</div>
            </div>
            <p style={{ fontSize: 11, color: "#94A3B8", marginTop: 6 }}>Affichées dans « À propos » et le pied de page de l'application.</p>
          </div>
          <div className="sf">
            {SOCIALS.map(([k, label, ph]) => (
              <div key={k}><label className="fl">{label}</label><input className="fi" type="url" placeholder={ph} value={form.social_links[k] || ""} onChange={(e) => setForm((p) => ({ ...p, social_links: { ...p.social_links, [k]: e.target.value } }))} /></div>
            ))}
            <button className="btn-primary" style={{ justifyContent: "center" }} disabled={saving} onClick={() => save(["social_links"])}>{saving ? "…" : <><Ic n="check" s={14} c="white" /> Enregistrer les réseaux</>}</button>
          </div>
        </div>
      )}

      {section === "legal" && (
        <div>
          {legalMissing.length > 0 && <div className="alert-banner warn" style={{ marginBottom: 14 }}><Ic n="warning" s={16} /><span><strong>À compléter avant la mise en ligne :</strong> {legalMissing.join(", ")}.</span></div>}
          <div className="grid2">
            <div className="sf">
              <Field label="Raison sociale *" value={form.legal_name} onChange={set("legal_name")} placeholder="Burger House SRL" />
              <Field label="Numéro d'entreprise *" value={form.company_number} onChange={set("company_number")} placeholder="0123.456.789" />
              <Field label="Numéro de TVA" value={form.vat_number} onChange={set("vat_number")} placeholder="BE 0123.456.789" />
              <Field label="Adresse du siège *" value={form.legal_address} onChange={set("legal_address")} placeholder="12 Rue de la Paix, 1000 Bruxelles" />
              <Field label="Responsable de publication *" value={form.publisher} onChange={set("publisher")} placeholder="Marie Dupont, gérante" />
            </div>
            <div className="sf">
              <div>
                <label className="fl" style={{ display: "flex", justifyContent: "space-between" }}>Conditions de commande *
                  <button className="link-btn" style={{ fontSize: 12 }} onClick={() => setForm((p) => ({ ...p, terms_text: LEGAL_TEMPLATES.terms(p, restaurant) }))}>Insérer le modèle</button></label>
                <textarea className="fi" rows={9} value={form.terms_text} onChange={(e) => set("terms_text")(e.target.value)} placeholder="Modalités de commande, retrait, livraison, annulation, paiement…" />
              </div>
              <div>
                <label className="fl" style={{ display: "flex", justifyContent: "space-between" }}>Politique de confidentialité *
                  <button className="link-btn" style={{ fontSize: 12 }} onClick={() => setForm((p) => ({ ...p, privacy_text: LEGAL_TEMPLATES.privacy(p, restaurant, brandCtx.platformName) }))}>Insérer le modèle</button></label>
                <textarea className="fi" rows={9} value={form.privacy_text} onChange={(e) => set("privacy_text")(e.target.value)} placeholder="Données collectées, finalités, durée de conservation, droits des clients…" />
              </div>
            </div>
          </div>
          <p style={{ fontSize: 11, color: "#94A3B8", margin: "8px 0 12px" }}>Les modèles sont fournis par l'éditeur : relisez-les et complétez les passages entre crochets. Ces textes sont publiés à l'adresse /#legal de l'application.</p>
          <button className="btn-primary" style={{ justifyContent: "center" }} disabled={saving} onClick={() => save(["legal_name", "company_number", "vat_number", "legal_address", "publisher", "terms_text", "privacy_text"])}>{saving ? "…" : <><Ic n="check" s={14} c="white" /> Enregistrer les textes légaux</>}</button>
        </div>
      )}

      {section === "link" && <QrBlock url={publicUrl} />}

      {section === "status" && (
        <div>
          <div className={`alert-banner ${publication?.ready ? "ok" : "warn"}`} style={{ marginBottom: 14 }}>
            <Ic n={publication?.ready ? "check" : "warning"} s={16} />
            <span>{publication?.ready ? <strong>Votre application est prête à être partagée.</strong> : <><strong>Il manque {publication?.missing?.length || 0} élément(s)</strong> avant la mise en ligne publique.</>}</span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {(publication?.items || []).map((it) => (
              <div key={it.key} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", borderRadius: 10, background: it.ok ? "#F0FDF4" : "#FFFBEB", border: `1px solid ${it.ok ? "#BBF7D0" : "#FDE68A"}`, fontSize: 13, fontWeight: 600 }}>
                <span>{it.ok ? "✅" : "⚠️"}</span><span style={{ flex: 1 }}>{it.label}</span>
                {!it.ok && it.key === "legal" && <button className="link-btn" onClick={() => setSection("legal")}>Compléter →</button>}
                {!it.ok && it.key === "icons" && <button className="link-btn" onClick={() => setSection("icons")}>Générer →</button>}
              </div>
            ))}
            {!publication && <p className="empty-msg">État de publication indisponible (instance en mode plateforme ?).</p>}
          </div>
          <p style={{ fontSize: 11, color: "#94A3B8", marginTop: 10 }}>Le domaine est configuré par l'éditeur ; les horaires, la carte et l'interrupteur se règlent dans les autres onglets du tableau de bord.</p>
        </div>
      )}
    </>
  );
}
