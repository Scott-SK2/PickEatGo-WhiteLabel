"use client";
/**
 * single.jsx — Écrans propres au mode mono-restaurant (édition Marque Blanche).
 *
 *   <SingleHome/>     accueil = page du restaurant : bandeau, slogan, bouton Commander, photos, horaires, avis
 *   <SiteFooter/>     pied de page : coordonnées, réseaux, mentions légales, mention « propulsé par »
 *   <LegalPage/>      mentions légales, conditions de commande, politique de confidentialité
 *   <InstallBanner/>  « Ajouter à l'écran d'accueil » (proposé après la première commande)
 *
 * Les styles (classes sh-*, sf-*, lg-*) sont déclarés dans le bloc CSS de page.jsx (SINGLE_CSS).
 */
import { useEffect, useState } from "react";
import { socialLinks } from "../lib/brand";

const DAYS = ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"];
const Star = ({ on }) => <span style={{ color: on ? "#F59E0B" : "#E2E8F0" }}>★</span>;

function Logo({ rest, size = 76 }) {
  const [broken, setBroken] = useState(false);
  if (rest?.logo_url && !broken) return <img src={rest.logo_url} alt="" onError={() => setBroken(true)} style={{ width: size, height: size, borderRadius: size / 4, objectFit: "cover", border: "3px solid rgba(255,255,255,.35)", boxShadow: "0 6px 20px rgba(0,0,0,.25)" }} />;
  return <span style={{ fontSize: size * 0.6, lineHeight: 1 }}>{rest?.emoji || "🍽️"}</span>;
}

export function SingleHome({ rest, brand, reviews = [], reviewsLoading = false, onOrder, onAbout, onLightbox, onMenu }) {
  if (!rest) return null;
  const open = rest.open;
  const label = rest.openLabel || (open ? "Ouvert" : "Fermé");
  const hours = Array.isArray(rest.hours) ? [...rest.hours].sort((a, b) => a.day_of_week - b.day_of_week) : [];
  const gallery = rest.gallery || [];
  const recent = reviews.slice(0, 3);
  const cuisine = Array.isArray(rest.cuisine) ? rest.cuisine.join(" · ") : (rest.cuisine || "");
  return (
    <div className="fade-in">
      <section className="sh-hero" style={{ background: rest.banner || "#FF6B2C" }}>
        {rest.banner_url && <img src={rest.banner_url} alt="" className="sh-hero-img" onClick={() => onLightbox && onLightbox({ images: [{ url: rest.banner_url, caption: rest.name }], index: 0 })} />}
        <div className="sh-hero-overlay" />
        <div className="sh-hero-content">
          <Logo rest={rest} />
          <h1 className="sh-name">{rest.name}</h1>
          {cuisine && <p className="sh-cuisine">{cuisine}</p>}
          <div className="sh-stats">
            <span className={`sh-open ${open ? "open" : "closed"}`}>● {label}</span>
            {rest.rating ? <span>★ {rest.rating} ({rest.total_orders || 0} commandes)</span> : <span>Nouveau</span>}
            <span>⏱ {rest.prepTime || `~${rest.prep_time_avg || 15} min`}</span>
          </div>
        </div>
      </section>

      <section className="sh-intro">
        <h2 className="sh-tagline">{brand.tagline || "Commandez en ligne, récupérez sur place."}</h2>
        {brand.welcome_text && <p className="sh-welcome">{brand.welcome_text}</p>}
        <button className="sh-order-btn" onClick={open ? onOrder : onMenu}>
          {open ? "Commander" : label.startsWith("Fermé") ? `${label} · voir la carte` : "Voir la carte"} →
        </button>
        {!open && <p className="sh-closed-hint">Le restaurant n'accepte pas de commande pour le moment. La carte reste consultable.</p>}
      </section>

      {gallery.length > 0 && (
        <section className="sh-section">
          <h3 className="sh-section-title">📷 Le lieu</h3>
          <div className="place-strip">
            {gallery.map((ph, k) => (
              <button key={ph.id} className="place-cell" onClick={() => onLightbox && onLightbox({ images: gallery.map(x => ({ url: x.url, caption: x.caption || rest.name })), index: k })}>
                <img src={ph.url} alt={ph.caption || ""} loading="lazy" />
                {ph.caption && <span className="gallery-cap">{ph.caption}</span>}
              </button>
            ))}
          </div>
        </section>
      )}

      {rest.description && (
        <section className="sh-section">
          <h3 className="sh-section-title">À propos</h3>
          <p className="sh-desc">{rest.description}</p>
          <button className="sh-link-btn" onClick={onAbout}>Infos pratiques, horaires complets et avis →</button>
        </section>
      )}

      {hours.length > 0 && (
        <section className="sh-section">
          <h3 className="sh-section-title">🕒 Horaires de la semaine</h3>
          <div className="sh-hours">
            {hours.map(h => (
              <div key={h.day_of_week} className={`sh-hours-row ${h.is_open ? "" : "closed"}`}>
                <span>{h.day_name || DAYS[h.day_of_week]}</span>
                <span>{h.is_open ? `${String(h.open_time || "").slice(0, 5)} – ${String(h.close_time || "").slice(0, 5)}` : "Fermé"}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="sh-section">
        <h3 className="sh-section-title">⭐ Avis récents</h3>
        {reviewsLoading ? <p className="sh-muted">Chargement des avis…</p>
          : recent.length === 0 ? <p className="sh-muted">Aucun avis pour le moment. Soyez le premier après votre commande !</p>
          : recent.map((a, i) => (
            <div key={i} className="pub-review">
              <div className="pub-review-header">
                <div className="pub-review-av">{(a.client_name || "?")[0].toUpperCase()}</div>
                <div><p className="pub-review-name">{a.client_name}</p><div style={{ fontSize: 12 }}>{[1, 2, 3, 4, 5].map(j => <Star key={j} on={j <= a.rating} />)}</div></div>
                <span className="pub-review-date">{a.date}</span>
              </div>
              {a.comment && <p className="pub-review-text">{a.comment}</p>}
            </div>
          ))}
        {reviews.length > 3 && <button className="sh-link-btn" onClick={onAbout}>Voir les {reviews.length} avis →</button>}
      </section>

      {open && <div className="pub-cta"><button className="pub-cta-btn" onClick={onOrder}>Commander maintenant</button></div>}
    </div>
  );
}

export function SiteFooter({ rest, brand, badge, platformName = "PickEatGo", onAbout, onLegal, onHome }) {
  const links = socialLinks(brand);
  return (
    <footer className="sf-footer">
      <div className="sf-grid">
        <div>
          <p className="sf-title">{brand.app_name || rest?.name}</p>
          {rest?.address && <p className="sf-line">📍 {rest.address}{rest.city && !String(rest.address).toLowerCase().includes(String(rest.city).toLowerCase()) ? `, ${rest.city}` : ""}</p>}
          {rest?.phone && <p className="sf-line">📞 <a href={`tel:${String(rest.phone).replace(/\s/g, "")}`}>{rest.phone}</a></p>}
          {rest?.email && <p className="sf-line">✉️ <a href={`mailto:${rest.email}`}>{rest.email}</a></p>}
        </div>
        <div>
          {links.length > 0 && (
            <div className="sf-social">
              {links.map(l => <a key={l.key} href={l.url} target="_blank" rel="noopener noreferrer" className="sf-social-btn">{l.icon} {l.label}</a>)}
            </div>
          )}
          <div className="sf-links">
            <button onClick={onHome}>Accueil</button>
            <button onClick={onAbout}>À propos</button>
            <button onClick={onLegal}>Mentions légales</button>
          </div>
        </div>
      </div>
      {badge && <p className="sf-badge">Application propulsée par <strong>{platformName}</strong></p>}
    </footer>
  );
}

function Block({ title, children }) {
  return <section className="lg-block"><h3 className="lg-title">{title}</h3>{children}</section>;
}

export function LegalPage({ brand, rest, onBack }) {
  const missing = !brand.legal_name && !brand.company_number && !brand.publisher;
  const paragraphs = (t) => String(t || "").split(/\n{2,}/).filter(Boolean).map((p, i) => <p key={i} className="lg-p">{p}</p>);
  return (
    <div className="fade-in narrow-page" style={{ padding: "24px 20px" }}>
      <button className="back-btn" aria-label="Retour" onClick={onBack} style={{ marginBottom: 20 }}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#1E293B" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
      </button>
      <h2 className="lg-h2">Mentions légales</h2>
      <Block title="Éditeur du site">
        {missing ? <p className="lg-p lg-muted">Mentions légales en cours de rédaction.</p> : (
          <dl className="lg-dl">
            {brand.legal_name && <><dt>Raison sociale</dt><dd>{brand.legal_name}</dd></>}
            {brand.company_number && <><dt>Numéro d'entreprise</dt><dd>{brand.company_number}</dd></>}
            {brand.vat_number && <><dt>TVA</dt><dd>{brand.vat_number}</dd></>}
            {brand.legal_address && <><dt>Siège</dt><dd>{brand.legal_address}</dd></>}
            {brand.publisher && <><dt>Responsable de publication</dt><dd>{brand.publisher}</dd></>}
            {rest?.phone && <><dt>Téléphone</dt><dd>{rest.phone}</dd></>}
            {rest?.email && <><dt>E-mail</dt><dd>{rest.email}</dd></>}
          </dl>
        )}
      </Block>
      <Block title="Conditions de commande">
        {brand.terms_text ? paragraphs(brand.terms_text) : <p className="lg-p lg-muted">Conditions en cours de rédaction.</p>}
      </Block>
      <Block title="Politique de confidentialité">
        {brand.privacy_text ? paragraphs(brand.privacy_text) : <p className="lg-p lg-muted">Politique de confidentialité en cours de rédaction.</p>}
      </Block>
    </div>
  );
}

const INSTALL_KEY = "pickeatgo_install_dismissed";

/** Bannière « Ajouter à l'écran d'accueil » : Android/Chrome via beforeinstallprompt, iOS via l'indication Partager → Sur l'écran d'accueil. */
export function InstallBanner({ appName }) {
  // Évalué une fois au montage : déjà installé ou déjà refusé → rien ; iOS → indication manuelle
  const initial = () => {
    if (typeof window === "undefined") return { ios: false, hidden: true };
    try { if (localStorage.getItem(INSTALL_KEY)) return { ios: false, hidden: true }; } catch {}
    const standalone = window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
    if (standalone) return { ios: false, hidden: true };
    const isIos = /iphone|ipad|ipod/i.test(window.navigator.userAgent) && !window.MSStream;
    return { ios: isIos, hidden: !isIos };
  };
  const [state, setState] = useState(initial);
  const [prompt, setPrompt] = useState(null);
  useEffect(() => {
    const onPrompt = (e) => {
      e.preventDefault();
      try { if (localStorage.getItem(INSTALL_KEY)) return; } catch {}
      setPrompt(e); setState((s) => ({ ...s, hidden: false }));
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    return () => window.removeEventListener("beforeinstallprompt", onPrompt);
  }, []);
  const { ios, hidden } = state;
  if (hidden) return null;
  const dismiss = () => { setState((s) => ({ ...s, hidden: true })); try { localStorage.setItem(INSTALL_KEY, "1"); } catch {} };
  const install = async () => {
    if (!prompt) return;
    prompt.prompt();
    try { await prompt.userChoice; } catch {}
    dismiss();
  };
  return (
    <div className="ib-banner" role="note">
      <span className="ib-icon">📲</span>
      <div style={{ flex: 1 }}>
        <p className="ib-title">Ajouter {appName} à l'écran d'accueil</p>
        <p className="ib-sub">{ios ? "Touchez Partager puis « Sur l'écran d'accueil » pour retrouver l'application en un geste." : "Retrouvez l'application en un geste et recevez les notifications de commande."}</p>
      </div>
      {!ios && prompt && <button className="ib-btn" onClick={install}>Installer</button>}
      <button className="ib-close" aria-label="Fermer" onClick={dismiss}>✕</button>
    </div>
  );
}

export const SINGLE_CSS = `
  .sh-hero{position:relative;padding:28px 20px 32px;overflow:hidden;}
  .sh-hero-img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;cursor:zoom-in;}
  .sh-hero-overlay{position:absolute;inset:0;background:linear-gradient(to bottom,rgba(0,0,0,.25),rgba(0,0,0,.6));pointer-events:none;}
  .sh-hero-content{position:relative;z-index:2;text-align:center;display:flex;flex-direction:column;align-items:center;gap:8px;}
  .sh-name{font-family:'Sora',sans-serif;font-size:28px;font-weight:800;color:#fff;}
  .sh-cuisine{font-size:14px;color:rgba(255,255,255,.75);}
  .sh-stats{display:flex;justify-content:center;gap:12px;flex-wrap:wrap;font-size:13px;color:rgba(255,255,255,.9);font-weight:600;}
  .sh-open{padding:4px 12px;border-radius:20px;font-weight:700;}
  .sh-open.open{background:#DCFCE7;color:#15803D;} .sh-open.closed{background:#FEE2E2;color:#B91C1C;}
  .sh-intro{padding:28px 20px 8px;text-align:center;}
  .sh-tagline{font-family:'Sora',sans-serif;font-size:26px;font-weight:800;color:var(--text);line-height:1.2;margin-bottom:10px;}
  .sh-welcome{font-size:14px;color:var(--text-soft);line-height:1.6;max-width:520px;margin:0 auto 18px;}
  .sh-order-btn{display:inline-flex;align-items:center;gap:8px;background:var(--primary);color:#fff;border:none;border-radius:14px;padding:15px 26px;font-size:16px;font-weight:700;cursor:pointer;font-family:'DM Sans',sans-serif;box-shadow:0 4px 16px rgba(255,107,44,.35);transition:all .2s;}
  .sh-order-btn:hover{background:var(--primary-d);transform:translateY(-1px);}
  .sh-closed-hint{font-size:12px;color:#B45309;background:#FFFBEB;border:1px solid #FDE68A;border-radius:10px;padding:8px 12px;margin:14px auto 0;max-width:420px;}
  .sh-section{padding:22px 20px 0;}
  .sh-section-title{font-family:'Sora',sans-serif;font-size:17px;font-weight:800;color:var(--text);margin-bottom:12px;}
  .sh-desc{font-size:14px;color:var(--text-soft);line-height:1.7;}
  .sh-link-btn{margin-top:10px;background:none;border:none;color:var(--primary);font-weight:700;font-size:13px;cursor:pointer;font-family:inherit;padding:0;}
  .sh-hours{background:var(--white);border:1px solid var(--border);border-radius:14px;padding:12px 16px;display:flex;flex-direction:column;gap:6px;}
  .sh-hours-row{display:flex;justify-content:space-between;font-size:14px;font-weight:600;color:var(--text);}
  .sh-hours-row.closed{color:var(--text-soft);} .sh-hours-row.closed span:last-child{color:#DC2626;}
  .sh-muted{font-size:13px;color:#94A3B8;padding:12px 0;}
  .sf-footer{margin-top:40px;padding:28px 20px calc(28px + env(safe-area-inset-bottom));background:#0F172A;color:#CBD5E1;}
  .sf-grid{display:grid;grid-template-columns:1fr;gap:20px;max-width:720px;margin:0 auto;}
  .sf-title{font-family:'Sora',sans-serif;font-size:16px;font-weight:800;color:#fff;margin-bottom:8px;}
  .sf-line{font-size:13px;margin-bottom:5px;} .sf-line a{color:#CBD5E1;text-decoration:none;}
  .sf-social{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px;}
  .sf-social-btn{font-size:12px;font-weight:700;color:#fff;background:rgba(255,255,255,.08);border-radius:10px;padding:8px 12px;text-decoration:none;}
  .sf-links{display:flex;gap:14px;flex-wrap:wrap;}
  .sf-links button{background:none;border:none;color:#94A3B8;font-size:13px;font-weight:600;cursor:pointer;padding:6px 0;font-family:inherit;}
  .sf-links button:hover{color:#fff;}
  .sf-badge{text-align:center;font-size:11px;color:#64748B;margin-top:22px;} .sf-badge strong{color:#94A3B8;}
  .lg-h2{font-family:'Sora',sans-serif;font-size:22px;font-weight:800;margin-bottom:18px;}
  .lg-block{background:#fff;border:1px solid var(--border);border-radius:16px;padding:18px 20px;margin-bottom:14px;}
  .lg-title{font-family:'Sora',sans-serif;font-size:15px;font-weight:700;margin-bottom:10px;}
  .lg-p{font-size:14px;line-height:1.7;color:var(--text);margin-bottom:10px;white-space:pre-line;} .lg-muted{color:#94A3B8;font-style:italic;}
  .lg-dl{display:grid;grid-template-columns:auto 1fr;gap:6px 14px;font-size:14px;} .lg-dl dt{color:var(--text-soft);font-weight:600;} .lg-dl dd{margin:0;}
  .ib-banner{display:flex;align-items:center;gap:12px;width:100%;background:#fff;border:1.5px solid #FED7AA;border-radius:16px;padding:14px 16px;box-shadow:var(--shadow);}
  .ib-icon{font-size:26px;} .ib-title{font-size:14px;font-weight:700;color:var(--text);} .ib-sub{font-size:12px;color:var(--text-soft);margin-top:2px;line-height:1.4;}
  .ib-btn{background:var(--primary);color:#fff;border:none;border-radius:10px;padding:10px 14px;font-weight:700;font-size:13px;cursor:pointer;font-family:inherit;white-space:nowrap;}
  .ib-close{background:none;border:none;color:#94A3B8;cursor:pointer;font-size:16px;padding:6px;}
  .nav-brand-name{font-family:'Sora',sans-serif;font-size:16px;font-weight:800;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:160px;}
  .nav-brand-logo{width:34px;height:34px;border-radius:10px;object-fit:cover;flex-shrink:0;}
  .nav-links{display:flex;gap:4px;flex:1;min-width:0;}
  .nav-link{height:40px;padding:0 12px;border-radius:12px;border:none;background:none;font-size:13px;font-weight:700;color:var(--text-soft);cursor:pointer;font-family:'DM Sans',sans-serif;white-space:nowrap;}
  .nav-link.active{background:var(--primary-l);color:var(--primary);}
  @media(max-width:520px){.nav-links{display:none;}.nav-brand-name{max-width:120px;font-size:15px;}}
  @media(max-width:350px){.nav-brand-name{display:none;}}
  @media(min-width:1024px){.sh-hero{padding:48px 32px 56px;border-radius:0 0 28px 28px;}.sh-name{font-size:40px;}.sh-tagline{font-size:40px;}.sh-section,.sh-intro{max-width:860px;margin-left:auto;margin-right:auto;}.sf-grid{grid-template-columns:1fr 1fr;}.nav-brand-name{max-width:260px;font-size:18px;}}
`;
