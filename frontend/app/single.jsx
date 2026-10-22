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

// Accroche de l'en-tête : la fin de la phrase (après la dernière ponctuation, ou les derniers mots) prend la couleur de la marque
export function splitTagline(text) {
  const t = String(text || "").trim();
  if (!t) return { head: "", accent: "" };
  const m = t.match(/^(.*[,:;!?])\s+(.+)$/);
  if (m && m[2].split(/\s+/).length <= 6) return { head: m[1], accent: m[2] };
  const w = t.split(/\s+/);
  if (w.length >= 5) { const n = Math.min(3, Math.floor(w.length / 2)); return { head: w.slice(0, -n).join(" "), accent: w.slice(-n).join(" ") }; }
  return { head: t, accent: "" };
}

// Aliments flottants de l'en-tête, choisis d'après la cuisine du restaurant (son emoji en premier)
const CUISINE_EMOJIS = [
  [/burger|am[ée]ricain|fast/i, ["🍔", "🍟", "🥤", "🧀"]],
  [/italien|pizza|p[âa]tes|pasta/i, ["🍕", "🍝", "🧀", "🍷"]],
  [/japon|sushi|asiat|chinois|tha[iï]|vietnam|ramen|wok|cor[ée]en/i, ["🍣", "🍜", "🥢", "🍱"]],
  [/belge|friterie|brasserie/i, ["🍟", "🧇", "🍺", "🥐"]],
  [/mexic|tex/i, ["🌮", "🌯", "🥑", "🌶️"]],
  [/indien|curry|pakistan/i, ["🍛", "🫓", "🌶️", "🥘"]],
  [/boulang|p[âa]tiss|caf[ée]|brunch|petit[- ]d[ée]j|salon de th[ée]/i, ["🥐", "☕", "🍰", "🥖"]],
  [/v[ée]g|healthy|salade|bowl|bio/i, ["🥗", "🥑", "🍅", "🥕"]],
  [/grec|oriental|liban|turc|kebab|marocain|tunisien/i, ["🥙", "🧆", "🫒", "🍢"]],
  [/poisson|fruits de mer|sea|moules/i, ["🦐", "🐟", "🦪", "🍋"]],
  [/fran[çc]ais|bistro|gastro|traditionnel/i, ["🥖", "🧀", "🍷", "🥘"]],
  [/glace|dessert|cr[êe]pe|gaufre/i, ["🍦", "🧇", "🍓", "🍫"]],
];
export function heroEmojis(rest) {
  const c = Array.isArray(rest?.cuisine) ? rest.cuisine.join(" ") : String(rest?.cuisine || "");
  let list = ["🍽️", "🥗", "🍕", "🍔"];
  for (const [re, l] of CUISINE_EMOJIS) { if (re.test(c)) { list = l; break; } }
  if (rest?.emoji && rest.emoji !== "🍽️" && !list.includes(rest.emoji)) list = [rest.emoji, ...list.slice(0, 3)];   // l'emoji générique n'apporte rien
  return list;
}

export function SingleHome({ rest, brand, reviews = [], reviewsLoading = false, onOrder, onAbout, onLightbox, onMenu }) {
  if (!rest) return null;
  const open = rest.open;
  const label = rest.openLabel || (open ? "Ouvert" : "Fermé");
  const hours = Array.isArray(rest.hours) ? [...rest.hours].sort((a, b) => a.day_of_week - b.day_of_week) : [];
  const gallery = rest.gallery || [];
  const recent = reviews.slice(0, 3);
  const cuisine = Array.isArray(rest.cuisine) ? rest.cuisine.join(" · ") : (rest.cuisine || "");
  const tagline = splitTagline(brand.tagline || "Commandez en ligne, récupérez sur place.");
  const floats = heroEmojis(rest);
  return (
    <div className="fade-in">
      <section className="sh-hero">
        {rest.banner_url && <img src={rest.banner_url} alt="" className="sh-hero-img" onClick={() => onLightbox && onLightbox({ images: [{ url: rest.banner_url, caption: rest.name }], index: 0 })} />}
        <div className="sh-hero-overlay" />
        <div className="sh-hero-visual" aria-hidden="true">
          {floats.map((e, i) => (
            <span key={i} className="sh-float" style={{ animationDelay: `${i * 0.45}s`, animationDuration: `${3.4 + (i % 3) * 0.6}s`, top: `${8 + i * 22}%`, right: `${6 + (i % 2) * 16 + i * 2}%` }}>{e}</span>
          ))}
        </div>
        <div className="sh-hero-content">
          <div className="sh-hero-brand">
            <Logo rest={rest} size={52} />
            <div>
              <h1 className="sh-name">{rest.name}</h1>
              {cuisine && <p className="sh-cuisine">{cuisine}</p>}
            </div>
          </div>
          <h2 className="sh-tagline">{tagline.head}{tagline.accent && <><br /><span>{tagline.accent}</span></>}</h2>
          {brand.welcome_text && <p className="sh-welcome">{brand.welcome_text}</p>}
          <div className="sh-stats">
            <span className={`sh-open ${open ? "open" : "closed"}`}>● {label}</span>
            {rest.rating ? <span>★ {rest.rating} ({rest.total_orders || 0} commandes)</span> : <span>Nouveau</span>}
            <span>⏱ {rest.prepTime || `~${rest.prep_time_avg || 15} min`}</span>
          </div>
          <button className="sh-order-btn" onClick={open ? onOrder : onMenu}>
            {open ? "Commander" : label.startsWith("Fermé") ? `${label} · voir la carte` : "Voir la carte"} →
          </button>
          {!open && <p className="sh-closed-hint">Le restaurant n'accepte pas de commande pour le moment. La carte reste consultable.</p>}
        </div>
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
  const name = brand.app_name || rest?.name;
  const address = rest?.address ? `${rest.address}${rest.city && !String(rest.address).toLowerCase().includes(String(rest.city).toLowerCase()) ? `, ${rest.city}` : ""}` : "";
  const year = new Date().getFullYear();
  return (
    <footer className="sf-footer">
      <div className="sf-grid">
        <div className="sf-col">
          <div className="sf-brand">
            {rest?.logo_url && <img src={rest.logo_url} alt="" className="sf-logo" />}
            <p className="sf-title">{name}</p>
          </div>
          <ul className="sf-contact">
            {address && <li><span className="sf-ico" aria-hidden="true">📍</span><span>{address}</span></li>}
            {rest?.phone && <li><span className="sf-ico" aria-hidden="true">📞</span><a href={`tel:${String(rest.phone).replace(/\s/g, "")}`}>{rest.phone}</a></li>}
            {rest?.email && <li><span className="sf-ico" aria-hidden="true">✉️</span><a href={`mailto:${rest.email}`}>{rest.email}</a></li>}
          </ul>
        </div>
        <div className="sf-col">
          {links.length > 0 && (
            <div className="sf-social">
              {links.map(l => <a key={l.key} href={l.url} target="_blank" rel="noopener noreferrer" className="sf-social-btn">{l.icon} {l.label}</a>)}
            </div>
          )}
          <nav className="sf-links" aria-label="Pied de page">
            <button onClick={onHome}>Accueil</button>
            <button onClick={onAbout}>À propos</button>
            <button onClick={onLegal}>Mentions légales</button>
          </nav>
        </div>
      </div>
      <div className="sf-bottom">
        <span>© {year} {name}</span>
        {badge && <span>Application propulsée par <strong>{platformName}</strong></span>}
      </div>
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
  .sh-hero{position:relative;padding:36px 20px 40px;overflow:hidden;background:linear-gradient(135deg,#0F172A 0%,#1E293B 100%);}
  .sh-hero-img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;opacity:.22;cursor:zoom-in;}
  .sh-hero-overlay{position:absolute;inset:0;background:linear-gradient(135deg,rgba(15,23,42,.6),rgba(30,41,59,.3));pointer-events:none;}
  .sh-hero-visual{position:absolute;right:0;top:0;bottom:0;width:48%;z-index:1;pointer-events:none;}
  .sh-float{position:absolute;font-size:34px;line-height:1;opacity:.22;animation:shFloat 3.6s ease-in-out infinite;filter:drop-shadow(0 8px 12px rgba(0,0,0,.4));will-change:transform;}
  @keyframes shFloat{0%,100%{transform:translateY(0) rotate(-6deg);}50%{transform:translateY(-16px) rotate(6deg);}}
  @media(prefers-reduced-motion:reduce){.sh-float{animation:none;}}
  .sh-hero-content{position:relative;z-index:2;display:flex;flex-direction:column;align-items:flex-start;gap:10px;max-width:640px;}
  .sh-hero-brand{display:flex;align-items:center;gap:12px;margin-bottom:4px;}
  .sh-name{font-family:'Sora',sans-serif;font-size:18px;font-weight:800;color:#fff;line-height:1.2;}
  .sh-cuisine{font-size:13px;color:rgba(255,255,255,.6);margin-top:2px;}
  .sh-tagline{font-family:'Sora',sans-serif;font-size:34px;font-weight:800;color:#fff;line-height:1.12;margin:6px 0 2px;}
  .sh-tagline span{color:var(--primary);}
  .sh-welcome{font-size:14px;color:rgba(255,255,255,.65);line-height:1.6;max-width:420px;margin:0 0 4px;}
  .sh-stats{display:flex;gap:10px;flex-wrap:wrap;align-items:center;font-size:13px;color:rgba(255,255,255,.85);font-weight:600;margin-bottom:8px;}
  .sh-open{padding:4px 12px;border-radius:20px;font-weight:700;}
  .sh-open.open{background:#DCFCE7;color:#15803D;} .sh-open.closed{background:#FEE2E2;color:#B91C1C;}
  .sh-order-btn{display:inline-flex;align-items:center;gap:8px;background:var(--primary);color:#fff;border:none;border-radius:14px;padding:15px 26px;font-size:16px;font-weight:700;cursor:pointer;font-family:'DM Sans',sans-serif;box-shadow:0 8px 24px rgba(255,107,44,.35);transition:all .2s;}
  .sh-order-btn:hover{background:var(--primary-d);transform:translateY(-1px);}
  .sh-closed-hint{font-size:12px;color:#B45309;background:#FFFBEB;border:1px solid #FDE68A;border-radius:10px;padding:8px 12px;margin:6px 0 0;max-width:420px;}
  .sh-section{padding:22px 20px 0;}
  .sh-section-title{font-family:'Sora',sans-serif;font-size:17px;font-weight:800;color:var(--text);margin-bottom:12px;}
  .sh-desc{font-size:14px;color:var(--text-soft);line-height:1.7;}
  .sh-link-btn{margin-top:10px;background:none;border:none;color:var(--primary);font-weight:700;font-size:13px;cursor:pointer;font-family:inherit;padding:0;min-height:40px;display:inline-flex;align-items:center;}
  .sh-hours{background:var(--white);border:1px solid var(--border);border-radius:14px;padding:12px 16px;display:flex;flex-direction:column;gap:6px;}
  .sh-hours-row{display:flex;justify-content:space-between;font-size:14px;font-weight:600;color:var(--text);}
  .sh-hours-row.closed{color:var(--text-soft);} .sh-hours-row.closed span:last-child{color:#DC2626;}
  .sh-muted{font-size:13px;color:#94A3B8;padding:12px 0;}
  .app:has(.sf-footer){padding-bottom:0;}                       /* le pied de page sombre termine la page : pas de bande claire dessous */
  html:has(.sf-footer){background:linear-gradient(180deg,var(--bg) 0%,var(--bg) 50%,#0F172A 50%,#0F172A 100%);}   /* rebond iOS : clair en haut, sombre en bas */
  .sf-footer{margin-top:40px;padding:32px 20px calc(24px + env(safe-area-inset-bottom));background:#0F172A;color:#CBD5E1;}
  .sf-grid{display:grid;grid-template-columns:1fr;gap:24px;max-width:860px;margin:0 auto;}
  .sf-col{display:flex;flex-direction:column;gap:12px;}
  .sf-brand{display:flex;align-items:center;gap:12px;}
  .sf-logo{width:40px;height:40px;border-radius:10px;object-fit:cover;background:#fff;}
  .sf-title{font-family:'Sora',sans-serif;font-size:18px;font-weight:800;color:#fff;}
  .sf-contact{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;}
  .sf-contact li{display:flex;align-items:center;gap:10px;min-height:40px;font-size:14px;line-height:1.4;color:#CBD5E1;}
  .sf-contact a{color:inherit;text-decoration:none;display:inline-flex;align-items:center;min-height:40px;}
  .sf-contact a:hover{color:#fff;text-decoration:underline;}
  .sf-ico{width:22px;text-align:center;font-size:15px;flex-shrink:0;}
  .sf-social{display:flex;gap:8px;flex-wrap:wrap;}
  .sf-social-btn{font-size:13px;font-weight:700;color:#fff;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.08);border-radius:10px;padding:0 14px;text-decoration:none;display:inline-flex;align-items:center;gap:6px;min-height:40px;}
  .sf-social-btn:hover{background:rgba(255,255,255,.14);}
  .sf-links{display:flex;gap:20px;flex-wrap:wrap;}
  .sf-links button{background:none;border:none;color:#CBD5E1;font-size:14px;font-weight:600;cursor:pointer;padding:0;min-height:40px;font-family:inherit;}
  .sf-links button:hover{color:#fff;}
  .sf-bottom{max-width:860px;margin:24px auto 0;padding-top:16px;border-top:1px solid rgba(255,255,255,.1);display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:6px 16px;font-size:12px;color:#64748B;}
  .sf-bottom strong{color:#94A3B8;}
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
  @media(min-width:1024px){.sh-hero{padding:72px 48px 84px;border-radius:0 0 28px 28px;}.sh-hero-content{max-width:1100px;width:100%;margin:0 auto;}.sh-hero-brand{gap:14px;}.sh-name{font-size:22px;}.sh-tagline{font-size:56px;max-width:640px;}.sh-welcome{font-size:17px;max-width:520px;}.sh-float{font-size:64px;opacity:.3;}.sh-hero-visual{width:40%;}.sh-section{max-width:860px;margin-left:auto;margin-right:auto;}.sf-grid{grid-template-columns:1.2fr 1fr;gap:40px;}.sf-col:last-child{align-items:flex-end;}.sf-footer{padding:40px 32px calc(28px + env(safe-area-inset-bottom));}.nav-brand-name{max-width:260px;font-size:18px;}}
`;
