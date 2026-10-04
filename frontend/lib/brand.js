/**
 * lib/brand.js — Marque et mode de l'instance (édition Marque Blanche).
 *
 * L'API expose GET /api/v1/branding/ : mode (« platform » ou « single »), fuseau de référence,
 * restaurant lié (en mode single) et marque (nom, nom court, slogan, icônes, coordonnées, textes légaux).
 *
 *   fetchBranding()        → côté serveur (layout, manifest) : revalidé toutes les 60 s, repli sur les défauts PickEatGo
 *   fetchBrandingClient()  → côté navigateur : cache localStorage pour l'affichage immédiat, puis revalidation
 *   normalize(payload)     → { mode, single, configured, timezone, badge, restaurant, brand, publication, platformName }
 */
export const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000/api/v1";
export const PLATFORM_NAME = "PickEatGo";
export const THEME_COLOR = "#FF6B2C";
export const BACKGROUND_COLOR = "#F8F9FB";
const CACHE_KEY = "pickeatgo_branding";

export const DEFAULT_BRAND = {
  app_name: PLATFORM_NAME, short_name: PLATFORM_NAME,
  tagline: "Commander. Récupérer. C'est tout.",
  welcome_text: "Précommandez chez vos restaurants préférés et récupérez votre repas prêt à l'heure choisie.",
  icon_192_url: null, icon_512_url: null, icon_maskable_url: null, share_image_url: null,
  theme_color: THEME_COLOR, social_links: {},
  legal_name: "", company_number: "", vat_number: "", legal_address: "", publisher: "",
  terms_text: "", privacy_text: "", sender_name: PLATFORM_NAME, effective_sender_name: PLATFORM_NAME,
  legal_complete: true, missing_legal_fields: [], updated_at: null,
};

export const PLATFORM_BRANDING = {
  mode: "platform", configured: true, timezone: "Europe/Brussels", powered_by_badge: false,
  theme_color: THEME_COLOR, background_color: BACKGROUND_COLOR, platform_name: PLATFORM_NAME,
  restaurant: null, brand: DEFAULT_BRAND, publication: null,
};

/** Forme utilisée par l'application : toujours complète, même si l'API est injoignable. */
export function normalize(payload) {
  const p = payload && typeof payload === "object" ? payload : PLATFORM_BRANDING;
  const single = p.mode === "single";
  return {
    mode: single ? "single" : "platform",
    single,
    configured: p.configured !== false,
    timezone: p.timezone || "Europe/Brussels",
    badge: single ? p.powered_by_badge !== false : false,
    themeColor: THEME_COLOR,
    platformName: p.platform_name || PLATFORM_NAME,
    restaurant: single ? (p.restaurant || null) : null,
    brand: { ...DEFAULT_BRAND, ...(p.brand || {}) },
    publication: p.publication || null,
    fetchedAt: Date.now(),
  };
}

/** Côté serveur (layout racine, manifest) : jamais d'exception, repli sur la marque PickEatGo. */
export async function fetchBranding() {
  try {
    const res = await fetch(`${API_BASE}/branding/`, { next: { revalidate: 60 }, signal: AbortSignal.timeout(4000) });
    if (!res.ok) return normalize(null);
    return normalize(await res.json());
  } catch {
    return normalize(null);
  }
}

export function readCachedBranding() {
  if (typeof window === "undefined") return null;
  try { const raw = localStorage.getItem(CACHE_KEY); return raw ? normalize(JSON.parse(raw)) : null; } catch { return null; }
}

/** Côté navigateur : lit l'API (revalidation) et mémorise la réponse pour le prochain démarrage. */
export async function fetchBrandingClient() {
  const res = await fetch(`${API_BASE}/branding/`, { cache: "no-store" });
  if (!res.ok) throw new Error(`branding ${res.status}`);
  const data = await res.json();
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(data)); } catch {}
  return normalize(data);
}

/** Titre d'onglet / métadonnées à partir de la marque. */
export function brandMetadata(b) {
  const name = b.brand.app_name || PLATFORM_NAME;
  if (!b.single) {
    return {
      title: "PickEatGo — Commandez, récupérez, régalez-vous",
      description: "Précommandez dans vos restaurants préférés, récupérez sur place. Zéro file d'attente.",
      applicationName: PLATFORM_NAME, appTitle: PLATFORM_NAME,
      icons: { icon192: "/icons/icon-192.png", icon512: "/icons/icon-512.png", apple: "/icons/apple-touch-icon.png" },
      image: null,
    };
  }
  const tagline = b.brand.tagline || "Commandez en ligne, récupérez sur place.";
  return {
    title: `${name} — ${tagline}`,
    description: b.brand.welcome_text || `${name} : précommandez votre repas et récupérez-le à l'heure choisie.`,
    applicationName: name, appTitle: b.brand.short_name || name,
    icons: {
      icon192: b.brand.icon_192_url || "/icons/icon-192.png",
      icon512: b.brand.icon_512_url || "/icons/icon-512.png",
      apple: b.brand.icon_192_url || "/icons/apple-touch-icon.png",
    },
    image: b.brand.share_image_url || b.restaurant?.banner_url || b.restaurant?.logo_url || null,
  };
}

/** Liens sociaux non vides, dans un ordre stable. */
export const SOCIAL_ORDER = [["website", "Site web", "🌐"], ["facebook", "Facebook", "📘"], ["instagram", "Instagram", "📸"], ["tiktok", "TikTok", "🎵"]];
export function socialLinks(brand) {
  const links = brand?.social_links || {};
  return SOCIAL_ORDER.filter(([k]) => links[k]).map(([k, label, icon]) => ({ key: k, label, icon, url: links[k] }));
}
