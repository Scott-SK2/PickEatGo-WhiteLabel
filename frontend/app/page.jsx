"use client";
import { TOUCH_CSS } from "../lib/touch.css";
import { useHistoryPage, pageFromUrl } from "../lib/useHistoryPage";
import { openState, localNow, todayLocalISO } from "../lib/hours";
import { useState, useEffect, useRef } from "react";

/** Écrans de l'application client, restaurables depuis l'URL (#écran) au rechargement. */
const PAGES = ["home", "search", "restaurant", "publicPage", "cart", "confirm", "profile", "history",
               "menu", "about", "legal"];      // mode mono-restaurant : /#menu (carte), /#about (à propos), /#legal
/** Clé localStorage : panier, restaurant ouvert et choix du client (survivent au rechargement). */
const SESSION_KEY = "pickeatgo_session";
// Force client-only rendering to avoid hydration mismatch
// This is needed because page state changes between SSR and client
import { useRestaurants, useCreateOrder } from "../lib/hooks";
import { useAuth } from "../lib/AuthContext";
import PushToggle from "./PushToggle";
import Lightbox from "./Lightbox";
import { useOrderWebSocket } from "../lib/useWebSocket";
import { orderApi, apiFetch as coreFetch, apiFetchRaw } from "../lib/api";
import { useBrand } from "../lib/BrandContext";
import { SingleHome, SiteFooter, LegalPage, InstallBanner, SINGLE_CSS } from "./single";

/**
 * Génère les horaires de retrait disponibles pour un restaurant donné.
 * - Utilise les horaires du jour (BusinessHours) + prep_time_avg
 * - Granularité de 5 min, à partir de maintenant + temps de préparation
 * - Retourne [] si le restaurant est fermé aujourd'hui ou si la journée est dépassée
 */
function buildSlots(restaurant) {
  if (!restaurant) return [];

  const now        = localNow();                 // heure du restaurant, pas celle de l'appareil
  // JS : 0=Dim, 1=Lun … 6=Sam  →  Django : 0=Lun … 6=Dim
  const djangoDay  = (now.getDay() + 6) % 7;
  const prepTime   = restaurant.prep_time_avg || 15; // minutes de préparation

  const hours      = restaurant.hours || [];
  const todayHours = hours.find(h => h.day_of_week === djangoDay);

  // Si pas d'horaires configurés pour aujourd'hui, fallback large (07:00-23:00)
  const openStr  = todayHours?.is_open !== false ? (todayHours?.open_time  || "07:00") : null;
  const closeStr = todayHours?.is_open !== false ? (todayHours?.close_time || "23:00") : null;

  if (!openStr || !closeStr) return []; // fermé aujourd'hui

  const [oH, oM] = openStr.split(":").map(Number);
  const [cH, cM] = closeStr.split(":").map(Number);

  const openMin  = oH * 60 + oM;
  let   closeMin = cH * 60 + cM;
  if (closeMin <= openMin) closeMin += 24 * 60;              // ferme après minuit (18:00 → 02:00)

  // Le premier horaire disponible = maintenant + prep_time_avg, arrondi aux 5 min supérieures
  const nowMin      = now.getHours() * 60 + now.getMinutes();
  const earliestMin = Math.ceil((nowMin + prepTime) / 5) * 5;

  const slots = [];
  for (let m = Math.max(openMin, earliestMin); m < closeMin; m += 5) {
    const mm = m % (24 * 60);
    slots.push(
      String(Math.floor(mm / 60)).padStart(2, "0") + ":" +
      String(mm % 60).padStart(2, "0")
    );
  }
  return slots;
}

const EMOJI_MAP = {
  "Américain":"🍔","Americain":"🍔","American":"🍔",
  "Italien":"🍝","Italiano":"🍝","Italian":"🍝",
  "Japonais":"🍣","Japanese":"🍣",
  "Mexicain":"🌮","Mexican":"🌮",
  "Indien":"🍛","Indian":"🍛",
  "Chinois":"🥡","Chinese":"🥡",
  "Français":"🥐","French":"🥐",
  "Grec":"🥗","Greek":"🥗","Afro européen":"🌍","Africain":"🌍",
};

// ─── ICONS ───────────────────────────────────────────────────────────────────
const Ic = ({ n, s=20, c="currentColor" }) => ({
  search:   <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>,
  home:     <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>,
  cart:     <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/></svg>,
  back:     <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>,
  star:     <svg width={s} height={s} viewBox="0 0 24 24" fill={c} stroke="none"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>,
  clock:    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>,
  pin:      <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>,
  phone:    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 13 19.79 19.79 0 0 1 1.61 4.33 2 2 0 0 1 3.6 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 9.91a16 16 0 0 0 6.18 6.18l.95-.95a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/></svg>,
  plus:     <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2.5" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>,
  minus:    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2.5" strokeLinecap="round"><line x1="5" y1="12" x2="19" y2="12"/></svg>,
  x:        <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>,
  check:    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>,
  share:    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>,
  heart:    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>,
  info:     <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>,
  map:      <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="3 6 9 3 15 6 21 3 21 18 15 21 9 18 3 21"/><line x1="9" y1="3" x2="9" y2="18"/><line x1="15" y1="6" x2="15" y2="21"/></svg>,
  user:     <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>,
  loader:   <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/></svg>,
  edit:     <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>,
  history:  <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-4.5"/></svg>,
  logout:   <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>,
  order:    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>,
}[n] || null);

const optsExtra = (opts) => (opts || []).reduce((s, o) => s + parseFloat(o.extra_price || 0), 0);
const orderTotal = (items) => items.reduce((s, i) => s + (i.price + optsExtra(i.opts)) * i.qty, 0);

/** Photo d'un plat avec repli visuel (assiette) si l'image ne charge pas. */
function DishImg({ src, alt }) {
  const [broken, setBroken] = useState(false);
  if (!src || broken) return <div className="mi-img mi-img-fallback" aria-hidden="true">🍽️</div>;
  return <img src={src} alt={alt} className="mi-img" onError={() => setBroken(true)}/>;
}

function LogoImg({ logoUrl, emoji, imgStyle={}, emojiStyle={}, emojiClass="" }) {
  const [broken, setBroken] = useState(false);
  if (!logoUrl || broken) return <span className={emojiClass} style={emojiStyle}>{emoji}</span>;
  return <img src={logoUrl} style={imgStyle} onError={() => setBroken(true)} alt="" />;
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────
export default function PickEatGoClient() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const [activeRest, setActiveRest] = useState(null);
  const [publicRest, setPublicRest] = useState(null);
  const [cart, setCart]             = useState([]);
  const [cartRestId, setCartRestId] = useState(null);      // restaurant auquel appartient le panier
  const [filterCuisine, setFilterCuisine] = useState("Tous");
  const [searchQ, setSearchQ]       = useState("");
  const [activeTab, setActiveTab]   = useState(0);
  const [modalItem, setModalItem]   = useState(null);
  const [modalQty, setModalQty]     = useState(1);
  const [modalOpts, setModalOpts]   = useState([]);
  const [orderType, setOrderType]   = useState("emporter");
  const [deliveryAddress, setDeliveryAddress] = useState("");
  const [deliveryPostcode, setDeliveryPostcode] = useState("");
  const [deliveryQuote, setDeliveryQuote] = useState(null);   // { fee, free, below_min } | { error }
  const [trackedType, setTrackedType] = useState("emporter");   // type de la commande suivie
  const [lightbox, setLightbox] = useState(null);           // { images:[{url,caption,sub}], index, title }
  const [galleryOpen, setGalleryOpen] = useState(false);    // galerie (lieu + plats)
  const [galleryTab, setGalleryTab] = useState("plats");     // "lieu" | "plats"
  const [selectedSlot, setSelectedSlot] = useState("");
  const [note, setNote]             = useState("");
  const [cartError, setCartError]   = useState("");
  // Persistance de la commande en cours dans localStorage
  const [orderNum, setOrderNum]     = useState(() => {
    if (typeof window === "undefined") return null;
    return localStorage.getItem("pickeatgo_order_num") || null;
  });
  const [orderStep, setOrderStep]   = useState(() => {
    if (typeof window === "undefined") return 0;
    return parseInt(localStorage.getItem("pickeatgo_order_step") || "0");
  });
  const [currentOrderId, setCurrentOrderId] = useState(() => {
    if (typeof window === "undefined") return null;
    return localStorage.getItem("pickeatgo_order_id") || null;
  });
  const [orderRestaurantName, setOrderRestaurantName] = useState(() => {
    if (typeof window === "undefined") return "";
    return localStorage.getItem("pickeatgo_order_resto") || "";
  });
  const [orderRetrieved, setOrderRetrieved] = useState(false);
  const [orderCancelled, setOrderCancelled] = useState(false);
  const [cancelledByMe, setCancelledByMe]   = useState(false);
  const [cancellingOrder, setCancellingOrder] = useState(false);
  const [ratingSubmitted, setRatingSubmitted] = useState(false);
  const [lastOrderId, setLastOrderId]   = useState(null); // conservé pour noter après récupération
  const [liked, setLiked]           = useState([]);        // ids des restaurants favoris (API)
  const [notice, setNotice]         = useState("");        // message court sur la page restaurant
  const [flashMsg, setFlashMsg]     = useState("");        // message furtif (remplace alert())
  const flash = (m) => { setFlashMsg(m); setTimeout(() => setFlashMsg(""), 3000); };
  const [pendingReorder, setPendingReorder] = useState(null); // { restId, items } → panier rempli quand le menu est chargé
  const [promo, setPromo]           = useState("");        // code promo saisi
  const [promoInfo, setPromoInfo]   = useState(null);      // { code, label, discount, total } | { error }
  const [loyalty, setLoyalty]       = useState(null);      // carte de fidélité chez ce restaurant

  // Toujours "home" au SSR pour éviter l'hydratation ; au rechargement, l'écran est repris de l'URL (#restaurant, #cart…)
  const [page, setPage] = useState("home");
  useHistoryPage(page, setPage, { home: "home", replace: ["confirm"], pages: PAGES });   // bouton Retour du téléphone = écran précédent

  // Restaure la page confirm côté client uniquement (après montage)
  useEffect(() => {
    const savedOrder = localStorage.getItem("pickeatgo_order_num");
    const savedStep  = parseInt(localStorage.getItem("pickeatgo_order_step") || "0");
    const savedSlot  = localStorage.getItem("pickeatgo_order_slot");
    const savedType  = localStorage.getItem("pickeatgo_order_type");
    if (savedType)  setTrackedType(savedType);
    const savedResto = localStorage.getItem("pickeatgo_order_resto");
    const savedId    = localStorage.getItem("pickeatgo_order_id");
    if (savedSlot)  setSelectedSlot(savedSlot);
    if (savedResto) setOrderRestaurantName(savedResto);
    if (savedId)    setLastOrderId(savedId);
    if (savedOrder && savedStep <= 3 && !pageFromUrl()) setPage("confirm");
  }, []);

  // ─── Panier et restaurant en cours : survivent au rechargement (localStorage) ──
  const sessionReady = useRef(false);
  const wantedRest = useRef({ rest: null, pub: null });   // ids à retrouver quand la liste des restaurants arrive
  useEffect(() => {
    try {
      const s = JSON.parse(localStorage.getItem(SESSION_KEY) || "null");
      if (s && typeof s === "object") {
        if (Array.isArray(s.cart) && s.cart.length) { setCart(s.cart.filter(l => l && l.id && l.qty > 0)); setCartRestId(s.restId || null); }
        if (s.orderType) setOrderType(s.orderType);
        if (s.deliveryAddress) setDeliveryAddress(s.deliveryAddress);
        if (s.deliveryPostcode) setDeliveryPostcode(s.deliveryPostcode);
        if (s.note) setNote(s.note);
        if (s.activeTab) setActiveTab(s.activeTab);
        wantedRest.current = { rest: s.restId || null, pub: s.publicRestId || null };
      }
    } catch {}
    sessionReady.current = true;
  }, []);
  useEffect(() => {
    if (!sessionReady.current) return;
    try {
      localStorage.setItem(SESSION_KEY, JSON.stringify({
        restId: activeRest?._apiId || cartRestId || null, publicRestId: publicRest?._apiId || null,
        cart: cart.map(({ id, name, price, img, imgs, opts, qty, key, desc, cat, available, soldOut }) => ({ id, name, price, img, imgs, opts, qty, key, desc, cat, available, soldOut })),
        orderType, deliveryAddress, deliveryPostcode, note, activeTab,
      }));
    } catch {}
  }, [cart, cartRestId, activeRest?._apiId, publicRest?._apiId, orderType, deliveryAddress, deliveryPostcode, note, activeTab]);
  const [menuLoading, setMenuLoading] = useState(false);
  const [restReviews, setRestReviews] = useState([]);
  const [reviewsLoading, setReviewsLoading] = useState(false);

  // ─── API ────────────────────────────────────────────────────────────────────
  const { user, getHomeRoute } = useAuth();
  // Édition Marque Blanche : en mode mono-restaurant, l'accueil est la page du restaurant lié,
  // la recherche et les favoris de restaurants disparaissent, la carte est à /#menu et « À propos » à /#about.
  const brandCtx = useBrand();
  const single = brandCtx.single;
  const brand  = brandCtx.brand;
  const MENU   = single ? "menu" : "restaurant";
  const ABOUT  = single ? "about" : "publicPage";
  const isPro = user && (user.role === "restaurateur" || user.role === "admin");
  const proHome = isPro ? getHomeRoute(user) : null;
  // Un restaurateur (ou admin) qui arrive sur le site client sans l'avoir demandé (app installée, lien, URL tapée)
  // est renvoyé vers son espace. « Voir le site client » depuis le tableau de bord pose un drapeau qui l'autorise.
  const redirected = useRef(false);
  useEffect(() => {
    if (!isPro || redirected.current) return;
    let wanted = false;
    try { wanted = sessionStorage.getItem("pickeatgo_view_client") === "1"; } catch {}
    if (!wanted && !pageFromUrl()) { redirected.current = true; window.location.replace(proHome); }
  }, [isPro]); // eslint-disable-line react-hooks/exhaustive-deps
  const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000/api/v1";
  const authFetch = (url, opts = {}) => apiFetchRaw(url, opts);   // JWT renouvelé automatiquement, nouvelles tentatives
  useEffect(() => {
    if (!user || single) { setLiked([]); return; }
    authFetch("/restaurants/favorites/").then(r => r.ok ? r.json() : { restaurants: [] }).then(d => setLiked(d.restaurants || [])).catch(() => {});
  }, [user, single]);
  const toggleFavorite = async (restId) => {
    if (!user) { window.location.href = "/login"; return; }
    setLiked(p => p.includes(restId) ? p.filter(i => i !== restId) : [...p, restId]);   // optimiste
    try { const r = await authFetch(`/restaurants/${restId}/favorite/`, { method: "POST" }); const d = await r.json(); if (r.ok) setLiked(p => d.is_favorite ? [...new Set([...p, restId])] : p.filter(i => i !== restId)); }
    catch {}
  };
  const { data: apiData, loading: restoLoading } = useRestaurants(single ? {} : { status: "active" });   // mode single : l'API ne renvoie que le restaurant lié
  const { createOrder } = useCreateOrder();

  // WebSocket — suivi temps réel du statut de la commande
  const STATUS_TO_STEP = { nouvelle:0, confirmee:1, en_cuisine:2, prete:3, en_livraison:4 };

  const clearOrderStorage = () => {
    localStorage.removeItem("pickeatgo_order_num");
    localStorage.removeItem("pickeatgo_order_id");
    localStorage.removeItem("pickeatgo_order_step");
    localStorage.removeItem("pickeatgo_order_resto");
    localStorage.removeItem("pickeatgo_order_slot");
    localStorage.removeItem("pickeatgo_order_type");
  };

  const cancelMyOrder = async () => {
    if (!currentOrderId || cancellingOrder) return;
    setCancellingOrder(true);
    try {
      await orderApi.cancel(currentOrderId);
      setCancelledByMe(true);
      clearOrderStorage();
      setCurrentOrderId(null);
      setOrderCancelled(true);
    } catch {
      // le statut annulée arrivera via WebSocket de toute façon
    } finally {
      setCancellingOrder(false);
    }
  };

  useOrderWebSocket({
    enabled: !!user && !!currentOrderId,
    pollFn: (currentOrderId && user) ? async () => {
      try {
        const { orderApi } = await import("../lib/api");
        const order = await orderApi.get(currentOrderId);
        if (order) handleOrderStatus(order);
      } catch {}
    } : null,
    onStatusUpdate: (order) => handleOrderStatus(order),
  });

  function handleOrderStatus(order) {
    if (!currentOrderId) return;
    if (order.id === currentOrderId || String(order.number) === String(orderNum)) {
      if (order.status === "annulee") {
        setLastOrderId(currentOrderId);
        setCancelledByMe(false);
        setOrderCancelled(true);
        clearOrderStorage();
        setCurrentOrderId(null);
        setPage("confirm");
        return;
      }
      if (order.order_type) setTrackedType(order.order_type);
      if (order.status === "recuperee") {
        setLastOrderId(currentOrderId);
        setOrderStep(order.order_type === "livraison" ? 4 : 3);
        setOrderRetrieved(true);
        clearOrderStorage();
        setCurrentOrderId(null);
        setPage("confirm");
        return;
      }
      const step = STATUS_TO_STEP[order.status];
      if (step === undefined) return;
      setOrderStep(step);
      localStorage.setItem("pickeatgo_order_step", String(step));
      setPage("confirm");
    }
  }

  // Restaurants depuis l'API uniquement (plus de fallback mock)
  const API_RESTAURANTS = apiData?.results || [];
  const ALL_RESTAURANTS = API_RESTAURANTS.map(r => ({
    ...r,
    image: r.emoji || EMOJI_MAP[Array.isArray(r.cuisine) ? r.cuisine[0] : r.cuisine] || "🍽️",
    banner: r.banner_color || "#FF6B2C",
    open: openState(r.hours, r.is_open).open,       // interrupteur ET horaires du jour
    openLabel: openState(r.hours, r.is_open).label,
    rating: parseFloat(r.avg_rating) || null,
    reviews: r.total_orders || 0,
    prepTime: `~${r.prep_time_avg || 15} min`,
    distance: "—",
    priceRange: "€€",
    tags: [],
    categories: [],
    menu: [],
    _apiId: r.id,
    _isApi: true,
  }));

  // Après un rechargement : on retrouve le restaurant ouvert (et sa page publique) dès que la liste est chargée
  useEffect(() => {
    if (restoLoading || !apiData) return;
    const { rest, pub } = wantedRest.current;
    if (!rest && !pub) return;
    wantedRest.current = { rest: null, pub: null };
    const byId = (id) => ALL_RESTAURANTS.find(r => r._apiId === id) || null;
    const r = rest ? byId(rest) : null, p = pub ? byId(pub) : null;
    if (r && !activeRest) setActiveRest(r);
    if (p && !publicRest) setPublicRest(p);
    if (!r && cart.length) { setCart([]); setCartRestId(null); }         // restaurant disparu : panier obsolète
    if ((page === "restaurant" || page === "menu" || page === "cart") && !r) setPage("home");
    if ((page === "publicPage" || page === "about") && !p) setPage("home");
  }, [restoLoading, apiData]); // eslint-disable-line react-hooks/exhaustive-deps

  // Mode mono-restaurant : le restaurant lié est fixé dès le chargement (accueil, carte préchargée, « À propos »)
  useEffect(() => {
    if (!single || restoLoading || !apiData) return;
    const r = ALL_RESTAURANTS[0];
    if (!r) return;
    setActiveRest(prev => prev && prev._apiId === r._apiId ? { ...prev, ...r, categories: prev.categories, menu: prev.menu } : r);
    setPublicRest(prev => prev && prev._apiId === r._apiId ? prev : r);
    if (cartRestId && cartRestId !== r._apiId) { setCart([]); setCartRestId(null); }
  }, [single, restoLoading, apiData]); // eslint-disable-line react-hooks/exhaustive-deps

  // Charge le menu API quand on ouvre un restaurant
  // On utilise restaurantApi.get() qui retourne les catégories imbriquées avec leurs plats,
  // correctement scopées au restaurant (évite de mélanger les menus de plusieurs restaurants)
  useEffect(() => {
  if (!activeRest?._apiId) return;
  setMenuLoading(true);
  import("../lib/api").then(({ restaurantApi }) => {
    restaurantApi.get(activeRest._apiId)
      .then(data => {
        const apiCategories = data.categories || [];
        const catNames = [];
        const allItems = [];

        apiCategories.forEach(cat => {
          if (!cat.is_active) return;
          // Les plats indisponibles restent visibles (grisés) : le client sait qu'ils existent
          const catItems = cat.items || [];
          if (catItems.length === 0) return;
          catNames.push(cat.name);

          catItems.forEach(i => {
            allItems.push({
              id: i.id,
              name: i.name,
              cat: cat.name,
              price: parseFloat(i.price),
              desc: i.description || "",
              img: i.image_url || null,                        // pas de photo : pictogramme neutre (plus d'image externe trompeuse)
              imgs: (i.image_urls && i.image_urls.length ? i.image_urls : (i.image_url ? [i.image_url] : [])),
              options: i.options || [],
              allergens: (i.allergens || "").split(",").map(a => a.trim()).filter(Boolean),
              available: i.is_available !== false && i.is_available_today !== false,
              notToday: i.is_available_today === false,
              schedule: i.schedule_label || null,
              from: i.available_from ? String(i.available_from).slice(0, 5) : null,
              until: i.available_until ? String(i.available_until).slice(0, 5) : null,
              soldOut: i.is_out_of_stock === true,
              lowStock: i.is_low_stock === true ? (i.effective_stock ?? i.stock_qty) : null,
            });
          });
        });

        setActiveRest(prev => (prev && prev._apiId === data.id ? {
          ...prev,
          categories: catNames,
          menu: allItems,
        } : prev));                                           // réponse d'un restaurant quitté entre-temps : ignorée
        // Panier restauré après rechargement : on le remet à jour avec la carte du jour (prix, disponibilité, plats retirés)
        if (cartRestId === activeRest._apiId) {
          setCart(prev => prev.map(line => {
            const mi = allItems.find(x => x.id === line.id);
            if (!mi) return null;
            const opts = (line.opts || []).map(o => mi.options.find(mo => mo.id === (o.id ?? o)) || o);
            return { ...line, ...mi, opts, qty: line.qty, key: line.key };
          }).filter(Boolean));
        }
        // « Commander à nouveau » : on recompose le panier avec ce qui est encore disponible
        if (pendingReorder && pendingReorder.restId === activeRest._apiId) {
          const added = [], skipped = [];
          pendingReorder.items.forEach(line => {
            const mi = allItems.find(x => x.id === line.menu_item);
            if (!mi || !mi.available) { skipped.push(line.name); return; }
            const opts = (line.options || []).map(o => mi.options.find(mo => mo.label === (o.label ?? o))).filter(Boolean);
            const key = mi.id + opts.map(o => o.id ?? o).join(",");
            added.push({ ...mi, qty: line.qty || 1, opts, key });
          });
          setCart(added);
          setNotice(added.length === 0 ? "Aucun plat de cette commande n'est disponible aujourd'hui."
            : skipped.length ? `Panier recomposé. Indisponible aujourd'hui : ${skipped.join(", ")}.` : "Votre commande précédente est dans le panier 👍");
          setPendingReorder(null);
        }
      })
      .catch(() => {})
      .finally(() => setMenuLoading(false));
  });
}, [activeRest?._apiId]);

  // ─── Helpers ────────────────────────────────────────────────────────────────
  const cuisineStr = (c) => Array.isArray(c) ? c.join(", ") : (c || "");
  const cuisineArr = (c) => Array.isArray(c) ? c : (c ? [c] : []);
  const cuisines = ["Tous", ...(user && liked.length ? ["❤️ Favoris"] : []), ...new Set(ALL_RESTAURANTS.flatMap(r => cuisineArr(r.cuisine)))];

  const filteredRests = ALL_RESTAURANTS.filter(r => {
    const rCuisines = cuisineArr(r.cuisine);
    const matchCuisine = filterCuisine === "Tous" || (filterCuisine === "❤️ Favoris" ? liked.includes(r.id) : rCuisines.includes(filterCuisine));
    const matchSearch  = r.name.toLowerCase().includes(searchQ.toLowerCase()) ||
                         rCuisines.some(c => c.toLowerCase().includes(searchQ.toLowerCase()));
    return matchCuisine && matchSearch;
  });

  const addToCart = (item, qty, opts) => {
    if (activeRest?._apiId) setCartRestId(activeRest._apiId);
    setCart(prev => {
      const key = item.id + (opts || []).map(o => o.id ?? o).join(",");
      const existing = prev.find(i => i.key === key);
      if (existing) return prev.map(i => i.key === key ? {...i, qty: i.qty + qty} : i);
      return [...prev, { ...item, qty, opts, key }];
    });
    setModalItem(null);
  };

  const updateQty = (key, delta) =>
    setCart(prev => prev.map(i => i.key === key ? {...i, qty: Math.max(0, i.qty + delta)} : i).filter(i => i.qty > 0));

  const [placing, setPlacing] = useState(false);            // anti double-tap sur « Commander »
  const placeOrder = async () => {
    if (!user || !activeRest?._apiId || cart.length === 0 || placing) return;
    setCartError(""); setPlacing(true);
    try {
      const today = todayLocalISO();                          // date du restaurant (toISOString donnait la veille entre 0 h et 2 h)
      const result = await createOrder({
        restaurant: activeRest._apiId,
        order_type: orderType,
        pickup_slot: selectedSlot,
        pickup_date: today,
        note,
        promo_code: promoInfo?.code || "",
        delivery_address: orderType === "livraison" ? deliveryAddress.trim() : "",
        delivery_postcode: orderType === "livraison" ? deliveryPostcode.trim() : "",
        items: cart.map(i => ({ menu_item_id: i.id, qty: i.qty, options: (i.opts || []).map(o => o.id).filter(id => id != null) })),
      });
      setPromo(""); setPromoInfo(null);
      setCart([]); setCartRestId(null); setNote("");     // commande envoyée : le panier repart à vide
      setOrderNum(result.number);
      setCurrentOrderId(result.id);
      setOrderStep(0);
      // Persiste dans localStorage pour survie au refresh
      localStorage.setItem("pickeatgo_order_num",  result.number);
      localStorage.setItem("pickeatgo_order_id",   result.id);
      localStorage.setItem("pickeatgo_order_step", "0");
      localStorage.setItem("pickeatgo_order_resto", activeRest?.name || "");
      localStorage.setItem("pickeatgo_order_slot",  selectedSlot);
      localStorage.setItem("pickeatgo_order_type",  orderType);
      setTrackedType(orderType);
      setOrderRestaurantName(activeRest?.name || "");
      setLastOrderId(result.id);
      setPage("confirm");
    } catch (err) {
      const d = err && err.data;                              // erreurs de champ de l'API → texte sans le nom technique du champ
      const msg = d && typeof d === "object" && !Array.isArray(d) && Object.keys(d).length ? Object.values(d).flat().join(" ") : (err.message || "");
      setCartError(msg || "Une erreur est survenue. Veuillez réessayer.");
    } finally { setPlacing(false); }
  };

  // Charge les avis réels quand on ouvre la page publique d'un restaurant
  useEffect(() => {
    if (!publicRest?._apiId) { setRestReviews([]); return; }
    setReviewsLoading(true);
    const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000/api/v1";
    fetch(`${API}/restaurants/${publicRest._apiId}/reviews/`)
      .then(r => r.ok ? r.json() : [])
      .then(data => setRestReviews(Array.isArray(data) ? data : []))
      .catch(() => setRestReviews([]))
      .finally(() => setReviewsLoading(false));
  }, [publicRest?._apiId]);

  // Modes de commande proposés par le restaurant ouvert
  const MODES = [{id:"sur_place",label:"🪑 Sur place"},{id:"emporter",label:"🥡 À emporter"},{id:"livraison",label:"🛵 Livraison"}];
  const allowedModes = activeRest ? MODES.map(m => m.id).filter(id => (id === "sur_place" && activeRest.allow_on_site !== false) || (id === "emporter" && activeRest.allow_pickup !== false) || (id === "livraison" && activeRest.allow_delivery === true)) : ["sur_place","emporter"];
  useEffect(() => { if (activeRest && !allowedModes.includes(orderType)) setOrderType(allowedModes[0] || "emporter"); }, [activeRest?._apiId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (page !== "cart" || orderType !== "livraison" || !activeRest?._apiId) { setDeliveryQuote(null); return; }
    const pc = deliveryPostcode.trim();
    if (activeRest?.delivery_fee_mode === "zones" && !pc) { setDeliveryQuote(null); return; }
    const t = setTimeout(() => {
      fetch(`${API_BASE}/orders/delivery/quote/`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ restaurant: activeRest._apiId, postcode: pc, subtotal: orderTotal(cart).toFixed(2) }) })
        .then(async r => { const d = await r.json(); setDeliveryQuote(r.ok ? d : { error: d.detail || "Livraison impossible" }); })
        .catch(() => setDeliveryQuote(null));
    }, 300);
    return () => clearTimeout(t);
  }, [page, orderType, deliveryPostcode, cart, activeRest?._apiId]); // eslint-disable-line react-hooks/exhaustive-deps
  const deliveryFee = orderType === "livraison" ? (deliveryQuote?.fee != null ? parseFloat(deliveryQuote.fee) : (activeRest?.delivery_fee_mode === "zones" ? 0 : parseFloat(activeRest?.delivery_fee || 0))) : 0;
  const availableSlots = (rest, type) => {
    const slots = buildSlots(rest);
    if (type !== "livraison" || !rest) return slots;
    const from = rest.delivery_from ? String(rest.delivery_from).slice(0, 5) : null, until = rest.delivery_until ? String(rest.delivery_until).slice(0, 5) : null;
    const days = rest.delivery_days || [], today = (localNow().getDay() + 6) % 7;
    if (days.length && !days.includes(today)) return [];
    return slots.filter(sl => (!from || sl >= from) && (!until || sl <= until));
  };
  const openRest = (r) => {
    setActiveRest(prev => prev && prev._apiId === r._apiId ? { ...prev, ...r, categories: prev.categories, menu: prev.menu } : r);
    setActiveTab(0); setNotice(""); setPage(MENU);
    // Une commande ne concerne qu'un seul restaurant : on vide le panier d'un autre restaurant
    if (cart.length && cartRestId && cartRestId !== r._apiId) { setCart([]); setCartRestId(null); setNotice("Votre panier précédent (autre restaurant) a été vidé."); }
  };
  const reorder = (order) => {
    const r = ALL_RESTAURANTS.find(x => x._apiId === order.restaurant);
    if (!r) { flash("Ce restaurant n'est plus disponible."); return; }
    if (!r.open) { flash(`${r.name} est fermé pour le moment.`); return; }
    setPendingReorder({ restId: r._apiId, items: order.items || [] });
    openRest(r);
  };
  const openPublicPage = (r) => { setPublicRest(prev => prev && prev._apiId === r._apiId ? prev : r); setPage(ABOUT); };

  // Panier : carte de fidélité du client chez ce restaurant
  useEffect(() => {
    if (page !== "cart" || !user || !activeRest?._apiId) { if (page !== "cart") setLoyalty(null); return; }
    authFetch(`/orders/loyalty/?restaurant=${activeRest._apiId}`).then(r => r.ok ? r.json() : null).then(setLoyalty).catch(() => setLoyalty(null));
  }, [page, user, activeRest?._apiId]);   // eslint-disable-line react-hooks/exhaustive-deps
  const checkPromo = async () => {
    if (!promo.trim()) { setPromoInfo(null); return; }
    try {
      const r = await authFetch("/orders/promo/check/", { method: "POST", body: JSON.stringify({ restaurant: activeRest._apiId, code: promo.trim(), subtotal: orderTotal(cart).toFixed(2) }) });
      const d = await r.json();
      setPromoInfo(r.ok ? d : { error: d.detail || "Code invalide" });
    } catch { setPromoInfo({ error: "Vérification impossible" }); }
  };
  useEffect(() => { if (promoInfo?.code) setPromoInfo(null); }, [cart]);   // le panier a changé : la remise doit être revérifiée
  const cartDiscount = promoInfo?.code ? parseFloat(promoInfo.discount)
    : loyalty?.reward_ready ? (loyalty.reward_type === "percent" ? orderTotal(cart) * parseFloat(loyalty.reward_value) / 100 : parseFloat(loyalty.reward_value))
    : 0;
  const cartTotal = Math.max(0, orderTotal(cart) - Math.min(orderTotal(cart), Math.abs(cartDiscount))) + deliveryFee;

  // Quand le panier s'ouvre, auto-sélectionne le premier créneau disponible
  useEffect(() => {
    if (page !== "cart") return;
    const slots = availableSlots(activeRest, orderType);
    if (slots.length > 0) setSelectedSlot(slots[0]);
    else setSelectedSlot("");
  }, [page, activeRest, orderType]); // eslint-disable-line react-hooks/exhaustive-deps

  const STEPS = trackedType === "livraison"
    ? ["Commande reçue","Confirmée","En cuisine","Prête","En livraison 🛵"]
    : ["Commande reçue","Confirmée","En cuisine","Prête à récupérer!"];
  const LAST_STEP = STEPS.length - 1;

  if (!mounted || !brandCtx.ready) return null;      // la marque (et le mode) doivent être connus avant de choisir l'accueil
  const singleRest = activeRest || ALL_RESTAURANTS[0] || null;

  return (
    <>
      <style>{CSS}</style>
      <div className="app" suppressHydrationWarning>

        {/* NAVBAR */}
        <nav className="navbar">
          {single ? (
            <div className="nav-logo" onClick={() => setPage("home")} role="button" aria-label="Accueil">
              {brandCtx.restaurant?.logo_url
                ? <img src={brandCtx.restaurant.logo_url} alt="" className="nav-brand-logo"/>
                : <span className="nav-logo-icon">{brandCtx.restaurant?.emoji || "🍽️"}</span>}
              <span className="nav-brand-name">{brand.app_name}</span>
            </div>
          ) : (
            <div className="nav-logo" onClick={() => setPage("home")}>
              <span className="nav-logo-icon">🍔</span>
              <span className="nav-logo-text">Pick<b>Eat</b>Go</span>
            </div>
          )}
          {single ? (
            <div className="nav-links">
              <button className={`nav-link ${page === "menu" ? "active" : ""}`} onClick={() => setPage("menu")}>Carte</button>
              {user && <button className={`nav-link ${page === "history" ? "active" : ""}`} onClick={() => setPage("history")}>Mes commandes</button>}
            </div>
          ) : (
            <div className="nav-search" role="button" aria-label="Rechercher un restaurant" onClick={() => setPage("search")}>
              <Ic n="search" s={17} c="#64748B"/>
              <span className="nav-search-long">Rechercher un restaurant...</span>
              <span className="nav-search-short">Rechercher…</span>
            </div>
          )}
          <div className="nav-actions">
            {/* Pill commande en cours */}
            {currentOrderId && page !== "confirm" && (
              <button className="order-pill" onClick={() => setPage("confirm")}>
                <span className="order-pill-dot"/>
                <span>#{orderNum}</span>
              </button>
            )}
            <button className="nav-icon-btn" aria-label="Accueil" onClick={() => setPage("home")}>
              <Ic n="home" s={20} c={page === "home" ? "#FF6B2C" : "#64748B"}/>
            </button>
            {isPro && (
              <button className="nav-login-btn nav-pro-btn" onClick={() => window.location.href = proHome} title="Retour à mon espace">
                🏪 <span className="nav-pro-label">{user.role === "admin" ? "Administration" : "Mon tableau de bord"}</span>
              </button>
            )}
            {user ? (
              <div className="nav-avatar" onClick={() => setPage("profile")} title="Mon profil" aria-label="Mon profil">
                {user.first_name?.[0] || "U"}
              </div>
            ) : (
              /* Libellé explicite : une icône seule ne dit pas "se connecter" */
              <button className="nav-login-btn" onClick={() => window.location.href="/login"}>
                <Ic n="user" s={16} c="white"/>
                <span>Connexion</span>
              </button>
            )}
            <button className="nav-cart-btn" aria-label="Panier" onClick={() => cart.length > 0 && setPage("cart")}>
              <Ic n="cart" s={20} c="white"/>
              {cart.length > 0 && <span className="cart-badge">{cart.reduce((s,i) => s + i.qty, 0)}</span>}
            </button>
          </div>
        </nav>

        {/* ══ HOME (mode mono-restaurant) : la page du restaurant ══ */}
        {page === "home" && single && (
          !brandCtx.configured
            ? <div className="empty-state"><p style={{fontSize:40}}>🏪</p><p className="empty-title">Application en cours de configuration</p><p className="empty-sub">Cette instance n'est pas encore liée à un restaurant.</p></div>
            : restoLoading && !singleRest
              ? <div className="loading-menu"><Ic n="loader" s={24} c="#FF6B2C"/><p>Chargement...</p></div>
              : <SingleHome rest={singleRest} brand={brand} reviews={restReviews} reviewsLoading={reviewsLoading}
                  onOrder={() => singleRest && openRest(singleRest)} onMenu={() => setPage("menu")}
                  onAbout={() => singleRest && openPublicPage(singleRest)} onLightbox={setLightbox}/>
        )}

        {/* ══ HOME (mode plateforme) ══ */}
        {page === "home" && !single && (
          <div className="fade-in">
            <div className="hero">
              <div className="hero-content">
                <p className="hero-eyebrow">🚀 Sans attente, sans livraison</p>
                <h1 className="hero-title">Commander.<br/>Récupérer.<br/><span>C'est tout.</span></h1>
                <p className="hero-sub">Précommandez chez vos restaurants préférés et récupérez votre repas prêt à l'heure choisie.</p>
                <button className="hero-btn" onClick={() => setPage("search")}>
                  <Ic n="search" s={18} c="white"/> Explorer les restaurants
                </button>
              </div>
              <div className="hero-visual">
                {["🍔","🍝","🌮","🍣"].map((e,i) => (
                  <div key={i} className="hero-float" style={{animationDelay:`${i*.3}s`,top:`${10+i*20}%`,right:`${5+i*8}%`}}>{e}</div>
                ))}
              </div>
            </div>

            <div className="section">
              <div className="cuisine-chips">
                {cuisines.map(c => (
                  <button key={c} className={`cuisine-chip ${filterCuisine === c ? "active" : ""}`} onClick={() => setFilterCuisine(c)}>{c}</button>
                ))}
              </div>
            </div>

            <div className="section">
              <div className="section-header">
                <h2 className="section-title">🔥 Populaires maintenant</h2>
              </div>
              {restoLoading ? (
                <div className="loading-row"><Ic n="loader" s={20} c="#FF6B2C"/> Chargement...</div>
              ) : (
                <div className="rest-row">
                  {ALL_RESTAURANTS.filter(r => r.open).slice(0, 3).map(r => (
                    <div key={r.id} className="rest-card-h" onClick={() => openRest(r)}>
                      {/* Bannière : image de bannière, sinon le logo en pleine largeur, sinon l'emoji sur la couleur */}
                      <div className="rch-banner" style={{background: r.banner}}>
                        {(r.banner_url || r.logo_url)
                          ? <img src={r.banner_url || r.logo_url} alt="" className="rch-cover" />
                          : <LogoImg logoUrl={null} emoji={r.image} emojiClass="rch-emoji"/>}
                        {r.tags?.map(t => <span key={t} className="rch-tag">{t}</span>)}
                      </div>
                      <div className="rch-body">
                        <div className="rch-top">
                          <p className="rch-name">{r.name}</p>
                          <span className="rch-rating"><Ic n="star" s={12} c="#F59E0B"/> {r.rating}</span>
                        </div>
                        <p className="rch-meta">{cuisineStr(r.cuisine)} · {r.prepTime} · {r.distance}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="section">
              <h2 className="section-title">Tous les restaurants</h2>
              <div className="rest-list">
                {filteredRests.map(r => (
                  <div key={r.id} className={`rest-card-v ${!r.open ? "closed" : ""}`} onClick={() => r.open && openRest(r)}>
                    <div className="rcv-left">
                      <div className="rcv-img" style={{background: r.banner, overflow:"hidden"}}>
                        <LogoImg logoUrl={r.logo_url} emoji={r.image} imgStyle={{width:"100%",height:"100%",objectFit:"cover"}} emojiStyle={{display:"flex",width:"100%",height:"100%",alignItems:"center",justifyContent:"center",fontSize:28}}/>
                      </div>
                      <div className="rcv-info">
                        <div style={{display:"flex",alignItems:"center",gap:8}}>
                          <p className="rcv-name">{r.name}</p>
                          {!r.open && <span className="closed-badge">Fermé</span>}
                        </div>
                        <p className="rcv-meta">{cuisineStr(r.cuisine)} · {r.priceRange}</p>
                        <div className="rcv-stats">
                          <span><Ic n="star" s={12} c="#F59E0B"/> {r.rating}</span>
                          <span><Ic n="clock" s={12} c="#94A3B8"/> {r.prepTime}</span>
                          <span><Ic n="pin" s={12} c="#94A3B8"/> {r.distance}</span>
                        </div>
                      </div>
                    </div>
                    <div style={{display:"flex",flexDirection:"column",gap:6}}>
                      <button className={`rcv-public-btn ${liked.includes(r.id) ? "fav" : ""}`} aria-label="Favori" onClick={e => { e.stopPropagation(); toggleFavorite(r.id); }}>
                        <Ic n="heart" s={14} c={liked.includes(r.id) ? "#FF6B2C" : "#94A3B8"}/>
                      </button>
                      <button className="rcv-public-btn" onClick={e => { e.stopPropagation(); openPublicPage(r); }}>
                        <Ic n="info" s={14} c="#64748B"/>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {cart.length > 0 && (
              <button className="fab-cart" onClick={() => setPage("cart")}>
                <Ic n="cart" s={20} c="white"/>
                <span>{cart.reduce((s,i) => s+i.qty, 0)} article{cart.reduce((s,i) => s+i.qty, 0) > 1 ? "s" : ""}</span>
                <span className="fab-total">{orderTotal(cart).toFixed(2)} €</span>
              </button>
            )}
          </div>
        )}

        {/* ══ SEARCH (mode plateforme uniquement) ══ */}
        {page === "search" && !single && (
          <div className="fade-in search-page">
            <div className="search-header">
              <button className="back-btn" aria-label="Retour" onClick={() => setPage("home")}><Ic n="back" s={20} c="#1E293B"/></button>
              <div className="search-input-wrap">
                <Ic n="search" s={16} c="#94A3B8"/>
                <input autoFocus placeholder="Restaurant, cuisine..." value={searchQ} onChange={e => setSearchQ(e.target.value)}/>
                {searchQ && <button onClick={() => setSearchQ("")}><Ic n="x" s={14} c="#94A3B8"/></button>}
              </div>
            </div>
            <div className="cuisine-chips" style={{padding:"0 20px 16px"}}>
              {cuisines.map(c => (
                <button key={c} className={`cuisine-chip ${filterCuisine === c ? "active" : ""}`} onClick={() => setFilterCuisine(c)}>{c}</button>
              ))}
            </div>
            {filteredRests.length === 0
              ? <div className="empty-state"><p style={{fontSize:40}}>🍽️</p><p className="empty-title">Aucun résultat</p><p className="empty-sub">Essayez une autre cuisine ou un autre nom</p></div>
              : <div className="rest-list" style={{padding:"0 20px"}}>
                  {filteredRests.map(r => (
                    <div key={r.id} className={`rest-card-v ${!r.open ? "closed" : ""}`} onClick={() => r.open && openRest(r)}>
                      <div className="rcv-left">
                        <div className="rcv-img" style={{background: r.banner, overflow:"hidden"}}>
                          <LogoImg logoUrl={r.logo_url} emoji={r.image} imgStyle={{width:"100%",height:"100%",objectFit:"cover"}} emojiStyle={{display:"flex",width:"100%",height:"100%",alignItems:"center",justifyContent:"center",fontSize:28}}/>
                        </div>
                        <div className="rcv-info">
                          <div style={{display:"flex",alignItems:"center",gap:8}}>
                            <p className="rcv-name">{r.name}</p>
                            {!r.open && <span className="closed-badge">Fermé</span>}
                          </div>
                          <p className="rcv-meta">{cuisineStr(r.cuisine)} · {r.priceRange}</p>
                          <div className="rcv-stats">
                            <span><Ic n="star" s={12} c="#F59E0B"/> {r.rating}</span>
                            <span><Ic n="clock" s={12} c="#94A3B8"/> {r.prepTime}</span>
                            <span><Ic n="pin" s={12} c="#94A3B8"/> {r.distance}</span>
                          </div>
                        </div>
                      </div>
                      <button className="rcv-public-btn" onClick={e => { e.stopPropagation(); openPublicPage(r); }}>
                        <Ic n="info" s={14} c="#64748B"/>
                      </button>
                    </div>
                  ))}
                </div>
            }
          </div>
        )}

        {/* ══ PAGE PUBLIQUE RESTAURANT (mode single : « À propos ») ══ */}
        {(page === "publicPage" || page === "about") && publicRest && (
          <div className="fade-in">
            <div className="pub-hero" style={{background: publicRest.banner}}>
              {publicRest.banner_url && <img src={publicRest.banner_url} alt="" className="pub-hero-img" onClick={() => setLightbox({ images: [{ url: publicRest.banner_url, caption: publicRest.name }], index: 0 })}/>}
              <div className="pub-hero-overlay"/>
              <div className="pub-hero-nav">
                <button className="pub-back-btn" aria-label="Retour" onClick={() => setPage("home")}><Ic n="back" s={20} c="white"/></button>
                {!single && (
                  <div style={{display:"flex",gap:10}}>
                    <button className="pub-icon-btn" aria-label="Favori" onClick={() => toggleFavorite(publicRest.id)}>
                      <Ic n="heart" s={18} c={liked.includes(publicRest.id) ? "#FF6B2C" : "white"}/>
                    </button>
                    <button className="pub-icon-btn"><Ic n="share" s={18} c="white"/></button>
                  </div>
                )}
              </div>
              <div className="pub-hero-content">
                <div className="pub-logo"><LogoImg logoUrl={publicRest.logo_url} emoji={publicRest.image} imgStyle={{width:88,height:88,borderRadius:22,objectFit:"cover",border:"3px solid rgba(255,255,255,.35)",boxShadow:"0 6px 20px rgba(0,0,0,.25)"}}/></div>
                <h1 className="pub-name">{publicRest.name}</h1>
                <p className="pub-cuisine">{cuisineStr(publicRest.cuisine)} · {publicRest.priceRange}</p>
                <div className="pub-stats">
                  <span><Ic n="star" s={14} c="#F59E0B"/> {publicRest.rating || "—"} ({restReviews.length} avis)</span>
                  <span><Ic n="clock" s={14} c="rgba(255,255,255,0.8)"/> {publicRest.prepTime}</span>
                  <span><Ic n="pin" s={14} c="rgba(255,255,255,0.8)"/> {publicRest.distance}</span>
                </div>
              </div>
            </div>

            <div className="pub-body">
              <div className="pub-status-bar">
                <span className={`pub-open-badge ${publicRest.open ? "open" : "closed"}`}>
                  ● {publicRest.open ? (publicRest.openLabel || "Ouvert maintenant").replace("Ouvert", "Ouvert maintenant") : (publicRest.openLabel || "Fermé")}
                </span>
                {publicRest.open && (
                  <button className="pub-order-btn" onClick={() => openRest(publicRest)}>Commander ici →</button>
                )}
              </div>

              <div className="pub-section">
                <p className="pub-desc">{publicRest.description}</p>
                {publicRest.tags?.map(t => <span key={t} className="pub-tag">{t}</span>)}
              </div>

              <div className="pub-section">
                <h3 className="pub-section-title">Infos pratiques</h3>
                <div className="pub-info-grid">
                  {publicRest.address && <div className="pub-info-item"><Ic n="pin" s={16} c="#FF6B2C"/><div><p className="pub-info-label">Adresse</p><p className="pub-info-val">{publicRest.address}</p></div></div>}
                  {/* hours = liste BusinessHours de l'API (objets), ou chaîne libre pour les anciennes données */}
                  {publicRest.hours && (Array.isArray(publicRest.hours) ? publicRest.hours.length > 0 : true) && (
                    <div className="pub-info-item"><Ic n="clock" s={16} c="#FF6B2C"/><div><p className="pub-info-label">Horaires</p>
                      {Array.isArray(publicRest.hours)
                        ? <div className="pub-hours">
                            {[...publicRest.hours].sort((a,b) => a.day_of_week - b.day_of_week).map(h => (
                              <div key={h.day_of_week} className={`pub-hours-row ${h.is_open ? "" : "closed"}`}>
                                <span>{h.day_name || ["Lundi","Mardi","Mercredi","Jeudi","Vendredi","Samedi","Dimanche"][h.day_of_week]}</span>
                                <span>{h.is_open ? `${(h.open_time||"").slice(0,5)} – ${(h.close_time||"").slice(0,5)}` : "Fermé"}</span>
                              </div>
                            ))}
                          </div>
                        : <p className="pub-info-val">{String(publicRest.hours)}</p>}
                    </div></div>
                  )}
                  {publicRest.phone && <div className="pub-info-item"><Ic n="phone" s={16} c="#FF6B2C"/><div><p className="pub-info-label">Téléphone</p><p className="pub-info-val">{publicRest.phone}</p></div></div>}
                </div>
              </div>

              {publicRest.gallery?.length > 0 && (
                <div className="pub-section">
                  <h3 className="pub-section-title">📷 Photos du restaurant</h3>
                  <div className="place-strip">
                    {publicRest.gallery.map((ph, k) => (
                      <button key={ph.id} className="place-cell" onClick={() => setLightbox({ images: publicRest.gallery.map(x => ({ url: x.url, caption: x.caption || publicRest.name })), index: k })}>
                        <img src={ph.url} alt={ph.caption || ""} loading="lazy"/>
                        {ph.caption && <span className="gallery-cap">{ph.caption}</span>}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {publicRest.menu?.length > 0 && (
                <div className="pub-section">
                  <h3 className="pub-section-title">Aperçu du menu</h3>
                  <div className="pub-menu-preview">
                    {publicRest.menu.slice(0, 4).map(item => (
                      <div key={item.id} className="pub-menu-item">
                        <img src={item.img} alt={item.name} className="pub-menu-img"/>
                        <div className="pub-menu-info">
                          <p className="pub-menu-name">{item.name}</p>
                          <p className="pub-menu-desc">{item.desc}</p>
                          <p className="pub-menu-price">{parseFloat(item.price).toFixed(2)} €</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="pub-section">
                <h3 className="pub-section-title">⭐ Avis clients</h3>
                <div className="pub-rating-big">
                  <span className="pub-rating-num">{publicRest.rating || "—"}</span>
                  <div>
                    <div style={{display:"flex",gap:3}}>{[1,2,3,4,5].map(i => <Ic key={i} n="star" s={18} c={publicRest.rating && i <= Math.round(publicRest.rating) ? "#F59E0B" : "#E2E8F0"}/>)}</div>
                    <p style={{fontSize:13,color:"#64748B",marginTop:4}}>{restReviews.length} avis vérifiés</p>
                  </div>
                </div>
                {reviewsLoading ? (
                  <p style={{fontSize:13,color:"#94A3B8",textAlign:"center",padding:"16px 0"}}>Chargement des avis…</p>
                ) : restReviews.length === 0 ? (
                  <div className="reviews-empty">
                    <p>Aucun avis pour le moment.</p>
                    <p style={{fontSize:12,color:"#94A3B8",marginTop:4}}>Soyez le premier à laisser un avis après votre commande !</p>
                  </div>
                ) : restReviews.map((a, i) => (
                  <div key={i} className="pub-review">
                    <div className="pub-review-header">
                      <div className="pub-review-av">{(a.client_name || "?")[0].toUpperCase()}</div>
                      <div>
                        <p className="pub-review-name">{a.client_name}</p>
                        <div style={{display:"flex",gap:2}}>{[1,2,3,4,5].map(j => <Ic key={j} n="star" s={11} c={j <= a.rating ? "#F59E0B" : "#E2E8F0"}/>)}</div>
                      </div>
                      <span className="pub-review-date">{a.date}</span>
                    </div>
                    {a.comment && <p className="pub-review-text">{a.comment}</p>}
                    {a.owner_reply && (
                      <div style={{marginTop:8,marginLeft:12,paddingLeft:10,borderLeft:"3px solid #FF6B2C",fontSize:13}}>
                        <p style={{fontWeight:700,fontSize:12,color:"#FF6B2C"}}>Réponse de {publicRest.name}{a.owner_reply_date ? ` · ${a.owner_reply_date}` : ""}</p>
                        <p style={{color:"#475569"}}>{a.owner_reply}</p>
                      </div>
                    )}
                  </div>
                ))}
              </div>

              {publicRest.open && (
                <div className="pub-cta">
                  <button className="pub-cta-btn" onClick={() => openRest(publicRest)}>Commander maintenant</button>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ══ RESTAURANT (MENU) — /#menu en mode single ══ */}
        {(page === "restaurant" || page === "menu") && activeRest && (
          <div className="fade-in">
            <div className="rest-banner" style={{background: activeRest.banner}}>
              <button className="back-btn-white" aria-label="Retour" onClick={() => setPage("home")}><Ic n="back" s={20} c="white"/></button>
              <div style={{position:"absolute",top:16,right:16,display:"flex",gap:8}}>
                {(activeRest.menu?.some(m => m.imgs?.length) || activeRest.gallery?.length > 0) && <button className="pub-page-btn" style={{position:"static"}} onClick={() => { setGalleryTab(activeRest.gallery?.length ? "lieu" : "plats"); setGalleryOpen(true); }}>📷 Galerie</button>}
                <button className="pub-page-btn" style={{position:"static"}} onClick={() => openPublicPage(activeRest)}><Ic n="info" s={16} c="white"/> Infos</button>
              </div>
              <div className="rest-banner-content">
                <LogoImg logoUrl={activeRest.logo_url} emoji={activeRest.image} imgStyle={{width:72,height:72,borderRadius:16,objectFit:"cover",border:"3px solid rgba(255,255,255,.3)"}} emojiClass="rest-banner-emoji"/>
                <div>
                  <h2 className="rest-banner-name">{activeRest.name}</h2>
                  <div className="rest-banner-meta">
                    <span><Ic n="star" s={13} c="#F59E0B"/> {activeRest.rating}</span>
                    <span><Ic n="clock" s={13} c="rgba(255,255,255,0.8)"/> {activeRest.prepTime}</span>
                    <span><Ic n="pin" s={13} c="rgba(255,255,255,0.8)"/> {activeRest.distance}</span>
                  </div>
                </div>
              </div>
            </div>

            {notice && <div className="rest-notice" onClick={() => setNotice("")}>{notice}</div>}
            {menuLoading ? (
              <div className="loading-menu"><Ic n="loader" s={24} c="#FF6B2C"/><p>Chargement du menu...</p></div>
            ) : activeRest.categories?.length > 0 ? (
              <>
                <div className="cat-tabs">
                  {activeRest.categories.map((cat, i) => (
                    <button key={cat} className={`cat-tab ${activeTab === i ? "active" : ""}`} onClick={() => setActiveTab(i)}>{cat}</button>
                  ))}
                </div>
                <div className="menu-section">
                  {activeRest.menu.filter(item => item.cat === activeRest.categories[activeTab]).map(item => (
                    <div key={item.id} className={`menu-item ${item.available ? "" : "unavailable"}`}
                         onClick={() => { if (!item.available) return; setModalItem(item); setModalQty(1); setModalOpts([]); }}>
                      <div className="mi-info">
                        <p className="mi-name">{item.name}</p>
                        <p className="mi-desc">{item.desc}</p>
                        {item.allergens?.length > 0 && <p className="mi-allergens">⚠️ {item.allergens.join(", ")}</p>}
                        <p className="mi-price">{parseFloat(item.price).toFixed(2)} €
                          {!item.available && <span className="mi-badge">{item.soldOut ? "Épuisé" : item.notToday ? "Pas aujourd'hui" : "Indisponible"}</span>}
                          {item.available && item.lowStock !== null && <span className="mi-badge low">Plus que {item.lowStock}</span>}
                          {item.schedule && <span className="mi-badge time">⏰ {item.schedule}</span>}
                        </p>
                      </div>
                      <div className="mi-right">
                        <div style={{position:"relative"}} onClick={e => { if (item.imgs.length) { e.stopPropagation(); setLightbox({ images: item.imgs.map(u => ({ url: u, caption: item.name, sub: `${parseFloat(item.price).toFixed(2)} €` })), index: 0, title: null }); } }}>
                          <DishImg src={item.img} alt={item.name}/>
                          {item.imgs.length > 1 && <span className="mi-count">📷 {item.imgs.length}</span>}
                        </div>
                        {item.available && <button className="mi-add-btn" aria-label="Ajouter"><Ic n="plus" s={16} c="white"/></button>}
                      </div>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <div className="empty-state">
                <p style={{fontSize:40}}>🍽️</p>
                <p className="empty-title">Menu non disponible</p>
                <p className="empty-sub">Ce restaurant n'a pas encore ajouté de plats</p>
              </div>
            )}

            {cart.length > 0 && (
              <button className="fab-cart" onClick={() => setPage("cart")}>
                <Ic n="cart" s={20} c="white"/>
                <span>{cart.reduce((s,i) => s+i.qty, 0)} article{cart.reduce((s,i) => s+i.qty, 0) > 1 ? "s" : ""}</span>
                <span className="fab-total">{orderTotal(cart).toFixed(2)} €</span>
              </button>
            )}

            {modalItem && (
              <div className="modal-overlay" onClick={() => setModalItem(null)}>
                <div className="item-modal" onClick={e => e.stopPropagation()}>
                  <button className="modal-close" onClick={() => setModalItem(null)}><Ic n="x" s={18} c="#64748B"/></button>
                  {modalItem.imgs.length > 1 ? (
                    <div className="modal-carousel">
                      {modalItem.imgs.map((u, k) => <img key={k} src={u} alt={`${modalItem.name} ${k + 1}`} className="modal-img modal-img-slide" onClick={() => setLightbox({ images: modalItem.imgs.map(x => ({ url: x, caption: modalItem.name })), index: k })}/>)}
                    </div>
                  ) : (
                    <img src={modalItem.img} alt={modalItem.name} className="modal-img" onClick={() => modalItem.imgs.length && setLightbox({ images: [{ url: modalItem.imgs[0], caption: modalItem.name }], index: 0 })} style={{cursor: modalItem.imgs.length ? "zoom-in" : "default"}}/>
                  )}
                  {modalItem.imgs.length > 1 && <p className="modal-carousel-hint">📷 {modalItem.imgs.length} photos · faites défiler, touchez pour agrandir</p>}
                  <div className="modal-body">
                    <h3 className="modal-name">{modalItem.name}</h3>
                    <p className="modal-desc">{modalItem.desc}</p>
                    {modalItem.allergens?.length > 0 && (
                      <p style={{fontSize:12,color:"#B45309",background:"#FFFBEB",border:"1px solid #FDE68A",borderRadius:8,padding:"6px 10px",marginBottom:12}}>
                        ⚠️ Allergènes : <strong>{modalItem.allergens.join(", ")}</strong>
                      </p>
                    )}
                    {modalItem.options?.length > 0 && (
                      <div className="modal-opts">
                        <p className="modal-opts-title">Options</p>
                        {modalItem.options.map(opt => {
                          const optId    = opt.id ?? opt;
                          const optLabel = opt.label ?? opt;
                          const optExtra = parseFloat(opt.extra_price || 0);
                          return (
                            <label key={optId} className="opt-row">
                              <input type="checkbox"
                                checked={modalOpts.some(o => (o.id ?? o) === optId)}
                                onChange={() => setModalOpts(p =>
                                  p.some(o => (o.id ?? o) === optId)
                                    ? p.filter(o => (o.id ?? o) !== optId)
                                    : [...p, opt]
                                )}
                              />
                              <span>{optLabel}{optExtra > 0 ? ` +${optExtra.toFixed(2)}€` : ""}</span>
                            </label>
                          );
                        })}
                      </div>
                    )}
                    <div className="modal-footer">
                      <div className="qty-ctrl">
                        <button onClick={() => setModalQty(q => Math.max(1, q-1))}><Ic n="minus" s={16} c="#FF6B2C"/></button>
                        <span>{modalQty}</span>
                        <button onClick={() => setModalQty(q => q+1)}><Ic n="plus" s={16} c="#FF6B2C"/></button>
                      </div>
                      <button className="modal-add-btn" onClick={() => addToCart(modalItem, modalQty, modalOpts)}>
                        Ajouter · {((parseFloat(modalItem.price) + optsExtra(modalOpts)) * modalQty).toFixed(2)} €
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ══ PANIER ══ */}
        {/* Après un rechargement, le restaurant est retrouvé dès que la liste arrive */}
        {(((page === "restaurant" || page === "menu") && !activeRest) || (page === "cart" && !activeRest && cart.length > 0) || ((page === "publicPage" || page === "about") && !publicRest)) && (
          <div className="fade-in loading-menu" style={{minHeight:"50vh"}}><Ic n="loader" s={24} c="#FF6B2C"/><p>Chargement...</p></div>
        )}

        {page === "cart" && (activeRest || cart.length === 0) && (
          <div className="fade-in">
            <div className="page-header-bar">
              <button className="back-btn" aria-label="Retour" onClick={() => setPage(activeRest ? MENU : "home")}><Ic n="back" s={20} c="#1E293B"/></button>
              <h2 className="page-header-title">Mon panier</h2>
              <div/>
            </div>
            <div className="cart-body">
              {cart.map(item => (
                <div key={item.key} className="cart-item">
                  <div className="ci-qty-ctrl">
                    <button onClick={() => updateQty(item.key, -1)}><Ic n="minus" s={14} c="#FF6B2C"/></button>
                    <span>{item.qty}</span>
                    <button onClick={() => updateQty(item.key, 1)}><Ic n="plus" s={14} c="#FF6B2C"/></button>
                  </div>
                  <div className="ci-info">
                    <p className="ci-name">{item.name}</p>
                    {item.opts?.length > 0 && <p className="ci-opts">{item.opts.map(o => o.label ?? o).join(", ")}</p>}
                  </div>
                  <p className="ci-price">{((parseFloat(item.price) + optsExtra(item.opts)) * item.qty).toFixed(2)} €</p>
                  <button className="ci-delete-btn" aria-label="Retirer du panier" onClick={() => updateQty(item.key, -item.qty)} title="Supprimer">
                    <Ic n="x" s={14} c="#94A3B8"/>
                  </button>
                </div>
              ))}

              {!user && (
                <div className="login-notice">
                  <p>⚠️ <strong>Connecte-toi</strong> pour enregistrer ta commande</p>
                  <button onClick={() => window.location.href="/login"}>Se connecter</button>
                </div>
              )}

              <div className="cart-section-title">Comment souhaitez-vous être servi ?</div>
              <div className="type-btns">
                {MODES.filter(t => allowedModes.includes(t.id)).map(t => (
                  <button key={t.id} className={`type-btn ${orderType === t.id ? "active" : ""}`} onClick={() => setOrderType(t.id)}>{t.label}</button>
                ))}
              </div>
              {orderType === "livraison" && (
                <div style={{marginTop:10}}>
                  <div style={{display:"flex",gap:8}}>
                    <input className="fi" placeholder="Adresse de livraison complète *" value={deliveryAddress} onChange={e => setDeliveryAddress(e.target.value)}
                      style={{flex:1,minWidth:0,padding:"10px 12px",borderRadius:10,border:"1.5px solid var(--border)",fontSize:14,fontFamily:"inherit"}}/>
                    <input className="fi" inputMode="numeric" placeholder="Code postal *" value={deliveryPostcode} onChange={e => setDeliveryPostcode(e.target.value)}
                      style={{width:120,padding:"10px 12px",borderRadius:10,border:"1.5px solid var(--border)",fontSize:14,fontFamily:"inherit"}}/>
                  </div>
                  <p style={{fontSize:12,color:"#64748B",marginTop:6}}>
                    🛵 Livraison : {activeRest?.delivery_schedule_label || "aux heures d'ouverture"}
                    {deliveryQuote?.error ? "" : deliveryQuote?.fee != null ? (deliveryQuote.free ? " · frais offerts" : ` · frais ${parseFloat(deliveryQuote.fee).toFixed(2)} €`) : activeRest?.delivery_fee_mode === "zones" ? " · frais selon le code postal" : parseFloat(activeRest?.delivery_fee) > 0 ? ` · frais ${parseFloat(activeRest?.delivery_fee).toFixed(2)} €` : " · frais offerts"}
                    {activeRest?.delivery_free_above != null ? ` (offerts dès ${parseFloat(activeRest?.delivery_free_above).toFixed(2)} €)` : ""}
                    {parseFloat(activeRest?.delivery_min_order) > 0 ? ` · minimum ${parseFloat(activeRest?.delivery_min_order).toFixed(2)} €` : ""}
                    {activeRest?.delivery_info ? ` · ${activeRest?.delivery_info}` : ""}
                  </p>
                  {deliveryQuote?.error && <p style={{fontSize:12,color:"#DC2626",marginTop:4,fontWeight:600}}>⚠️ {deliveryQuote.error}</p>}
                </div>
              )}

              <div className="cart-section-title">{orderType === "livraison" ? "Heure de livraison souhaitée" : "Heure de retrait"}</div>
              {(() => {
                const slots = availableSlots(activeRest, orderType);
                const prepTime = activeRest?.prep_time_avg || 15;
                if (slots.length === 0) return (
                  <div className="slots-empty">
                    <span>⏰</span>
                    <p>{orderType === "livraison" ? "Pas de livraison possible aujourd'hui" : "Aucun horaire disponible aujourd'hui"}</p>
                    <p className="slots-empty-sub">{orderType === "livraison" ? `Livraison : ${activeRest?.delivery_schedule_label || "aux heures d'ouverture"}. Choisissez un autre mode ou revenez plus tard.` : "Le restaurant est fermé ou les horaires sont dépassés."}</p>
                  </div>
                );
                return (
                  <div>
                    <p style={{fontSize:12,color:"#64748B",marginBottom:8}}>⏱ Temps de préparation estimé : <strong>{prepTime} min</strong>. Choisissez l'heure à laquelle vous passerez récupérer votre commande.</p>
                    <select
                      className="fi"
                      value={selectedSlot}
                      onChange={e => { setSelectedSlot(e.target.value); setCartError(""); }}
                      style={{width:"100%",fontSize:16,fontWeight:700,padding:"10px 12px",borderRadius:10,border:"1.5px solid var(--border)",background:"#F8FAFC",cursor:"pointer"}}
                    >
                      {slots.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </div>
                );
              })()}

              <div className="cart-section-title">Note pour le restaurant</div>
              <textarea className="note-input" placeholder="Allergie, préférence..." value={note} onChange={e => setNote(e.target.value)} rows={2}/>

              <div className="cart-section-title">Code promo</div>
              <div style={{display:"flex",gap:8,marginBottom:6}}>
                <input className="fi" placeholder="Ex. BIENVENUE10" value={promo} onChange={e => { setPromo(e.target.value.toUpperCase()); setPromoInfo(null); }} onKeyDown={e => e.key === "Enter" && checkPromo()}
                  style={{flex:1,minWidth:0,padding:"10px 12px",borderRadius:10,border:"1.5px solid var(--border)",fontWeight:700,textTransform:"uppercase",fontFamily:"inherit"}}/>
                <button onClick={checkPromo} disabled={!promo.trim()} style={{padding:"10px 14px",borderRadius:10,border:"none",background:"#1E293B",color:"#fff",fontWeight:700,fontSize:13,cursor:"pointer",fontFamily:"inherit",opacity:promo.trim()?1:.5}}>Appliquer</button>
              </div>
              {promoInfo?.error && <p style={{fontSize:12,color:"#DC2626",marginBottom:8}}>⚠️ {promoInfo.error}</p>}
              {promoInfo?.code && <p style={{fontSize:12,color:"#15803D",fontWeight:700,marginBottom:8}}>✓ Code {promoInfo.code} appliqué ({promoInfo.label})</p>}
              {loyalty?.enabled && (
                <div style={{background:loyalty.reward_ready?"#FFF7ED":"#F8FAFC",border:`1px solid ${loyalty.reward_ready?"#FED7AA":"#E2E8F0"}`,borderRadius:12,padding:"10px 14px",marginBottom:12,fontSize:13}}>
                  {loyalty.reward_ready
                    ? <span>🎁 <strong>Récompense fidélité prête !</strong> {loyalty.reward_label.replace(" fidélité","")} sur cette commande{promoInfo?.code ? " (non cumulable avec un code promo, le code est prioritaire)" : ""}.</span>
                    : <span>⭐ Carte de fidélité : <strong>{loyalty.stamps} / {loyalty.target}</strong> commande(s). Encore {loyalty.target - loyalty.stamps} pour obtenir {loyalty.reward_label.replace(" fidélité","")}.</span>}
                  <div style={{display:"flex",gap:4,marginTop:8}}>{Array.from({length:loyalty.target}).map((_,i)=><span key={i} style={{flex:1,height:6,borderRadius:3,background:i<loyalty.stamps?"#FF6B2C":"#E2E8F0"}}/>)}</div>
                </div>
              )}

              <div className="cart-summary">
                <div className="cs-row"><span>Sous-total</span><span>{orderTotal(cart).toFixed(2)} €</span></div>
                {cartDiscount !== 0 && <div className="cs-row" style={{color:"#15803D"}}><span>{promoInfo?.code ? `Code ${promoInfo.code}` : "Récompense fidélité"}</span><span>−{Math.min(orderTotal(cart), Math.abs(cartDiscount)).toFixed(2)} €</span></div>}
                <div className="cs-row"><span>Frais de service</span><span style={{color:"#10B981"}}>Gratuit</span></div>
                {orderType === "livraison" && <div className="cs-row"><span>Frais de livraison</span><span style={deliveryFee ? {} : {color:"#10B981"}}>{deliveryFee ? `${deliveryFee.toFixed(2)} €` : "Offerts"}</span></div>}
                <div className="cs-row total"><span>Total</span><span>{cartTotal.toFixed(2)} €</span></div>
              </div>

              {cartError && (
                <div style={{background:"#FEF2F2",border:"1px solid #FECACA",borderRadius:10,padding:"10px 14px",marginBottom:10,color:"#DC2626",fontSize:13,fontWeight:600}}>
                  ⚠️ {cartError}
                </div>
              )}
              {(() => {
                const noSlot = availableSlots(activeRest, orderType).length === 0 || !selectedSlot;
                // Plats à horaires (formule midi…) : le retrait doit tomber dans leur créneau
                const outOfWindow = selectedSlot ? cart.filter(c => (c.from && selectedSlot < c.from) || (c.until && selectedSlot > c.until)) : [];
                const needAddr = orderType === "livraison" && (!deliveryAddress.trim() || !deliveryPostcode.trim() || !!deliveryQuote?.error);
                const underMin = orderType === "livraison" && parseFloat(activeRest?.delivery_min_order || 0) > orderTotal(cart);
                const blocked = noSlot || outOfWindow.length > 0 || needAddr || underMin;
                return (
                  <>
                    {outOfWindow.length > 0 && (
                      <div style={{background:"#EFF6FF",border:"1px solid #BFDBFE",borderRadius:10,padding:"10px 14px",marginBottom:10,color:"#1D4ED8",fontSize:13,fontWeight:600}}>
                        ⏰ {outOfWindow.map(c => `${c.name} (${c.from || "…"}–${c.until || "…"})`).join(", ")} : pas disponible à {selectedSlot}. Choisissez une autre heure ou retirez ce plat.
                      </div>
                    )}
                    <button className="order-btn" onClick={placeOrder}
                      disabled={blocked || placing}
                      style={blocked ? {opacity:.4,cursor:"not-allowed",boxShadow:"none"} : placing ? {opacity:.7} : {}}>
                      {placing ? "Envoi de la commande…" : noSlot ? "Aucun horaire disponible" : outOfWindow.length ? "Heure hors créneau d'un plat" : needAddr ? (deliveryQuote?.error ? "Adresse non desservie" : "Adresse et code postal requis") : underMin ? `Minimum ${parseFloat(activeRest?.delivery_min_order).toFixed(2)} € pour la livraison` : `${orderType === "livraison" ? "Livrer vers" : "Commander pour"} ${selectedSlot} · ${cartTotal.toFixed(2)} €`}
                    </button>
                  </>
                );
              })()}
            </div>
          </div>
        )}

        {/* ══ CONFIRMATION ══ */}
        {page === "confirm" && (
          <div className="fade-in confirm-page">
            {orderCancelled ? (
              /* ── Écran annulation ── */
              <div className="cancelled-screen">
                <div className="cancelled-icon">❌</div>
                <h2 className="cancelled-title">Commande annulée</h2>
                <p className="cancelled-sub">{cancelledByMe ? "Vous avez annulé votre commande" : "Le restaurant a annulé votre commande"} <strong>#{orderNum}</strong>.</p>
                <p className="cancelled-hint">Si vous avez des questions, contactez directement le restaurant.</p>
                <div style={{display:"flex",flexDirection:"column",gap:12,marginTop:28}}>
                  <button className="confirm-home-btn" onClick={() => { setPage("home"); setCart([]); setOrderCancelled(false); setOrderNum(null); setOrderStep(0); }}>
                    Retour à l'accueil
                  </button>
                </div>
              </div>
            ) : orderRetrieved ? (
              /* ── Écran "Bon appétit" + notation ── */
              <div className="retrieved-screen">
                <div className="retrieved-emoji">🎉</div>
                <h2 className="retrieved-title">Bon appétit !</h2>
                <p className="retrieved-sub">Commande <strong>#{orderNum}</strong> récupérée.</p>
                {orderRestaurantName && <p className="retrieved-resto">Merci d'avoir commandé chez <strong>{orderRestaurantName}</strong></p>}

                {/* Widget notation */}
                {!ratingSubmitted ? (
                  <RatingWidget
                    orderId={lastOrderId}
                    restaurantName={orderRestaurantName}
                    onDone={() => setRatingSubmitted(true)}
                  />
                ) : (
                  <p style={{fontSize:14,color:"#16A34A",fontWeight:700,marginTop:20}}>Merci pour votre note ! ⭐</p>
                )}

                <div style={{display:"flex",flexDirection:"column",gap:12,marginTop:24}}>
                  <button className="confirm-home-btn" onClick={() => { setPage("history"); setOrderRetrieved(false); setRatingSubmitted(false); setOrderNum(null); setOrderStep(0); }}>
                    <Ic n="history" s={16} c="white"/> Voir mes commandes
                  </button>
                  <button className="confirm-home-btn" style={{background:"#F1F5F9",color:"#1E293B"}} onClick={() => { setPage("home"); setCart([]); setOrderRetrieved(false); setRatingSubmitted(false); setOrderNum(null); setOrderStep(0); }}>
                    Retour à l'accueil
                  </button>
                </div>
              </div>
            ) : (
              /* ── Suivi en cours ── */
              <>
                <div className="confirm-top">
                  <div className="confirm-checkmark"><Ic n="check" s={32} c="white"/></div>
                  <h2 className="confirm-title">Commande passée !</h2>
                  {orderRestaurantName && <p className="confirm-resto">{orderRestaurantName}</p>}
                  <p className="confirm-num">N° <strong>#{orderNum}</strong></p>
                  <p className="confirm-slot">{trackedType === "livraison" ? "Livraison vers" : "Prête à"} <strong>{selectedSlot}</strong> · {trackedType === "sur_place" ? "Sur place" : trackedType === "livraison" ? "Livraison" : "À emporter"}</p>
                </div>
                <div className="confirm-timeline">
                  {STEPS.map((step, i) => (
                    <div key={i} className={`timeline-step ${i <= orderStep ? "done" : ""} ${i === orderStep ? "current" : ""}`}>
                      <div className="ts-dot">{i <= orderStep && <Ic n="check" s={12} c="white"/>}</div>
                      {i < STEPS.length - 1 && <div className="ts-line"/>}
                      <p className="ts-label">{step}</p>
                    </div>
                  ))}
                </div>
                {orderStep < LAST_STEP && !(trackedType === "livraison" && orderStep === 3) && <p className="confirm-hint">⏱ Mise à jour en direct...</p>}
                {trackedType === "livraison" && orderStep === 3 && <p className="confirm-ready">✅ Votre commande est prête, le livreur part bientôt.</p>}
                {trackedType === "livraison" && orderStep === 4 && <p className="confirm-ready">🛵 Votre commande est en route vers vous !</p>}
                {trackedType !== "livraison" && orderStep === 3 && <p className="confirm-ready">🎉 Votre commande est prête ! Venez la récupérer.</p>}
                {orderStep < 3 && <PushToggle variant="banner" />}
                {single && <InstallBanner appName={brand.app_name}/>}
                {/* Retour accueil SANS effacer — la pill permet de revenir */}
                <button className="confirm-home-btn" onClick={() => setPage("home")}>
                  Retour à l'accueil
                </button>
                {orderStep === 0 && currentOrderId && (
                  <button
                    className="cancel-order-btn"
                    onClick={cancelMyOrder}
                    disabled={cancellingOrder}
                    style={{opacity: cancellingOrder ? .5 : 1}}>
                    {cancellingOrder ? "Annulation..." : "Annuler la commande"}
                  </button>
                )}
              </>
            )}
          </div>
        )}
        {/* ══ GALERIE DES PLATS ══ */}
        {galleryOpen && activeRest && (() => {
          const dishShots = (activeRest.menu || []).flatMap(m => (m.imgs || []).map((u, k) => ({ url: u, caption: m.name, sub: `${parseFloat(m.price).toFixed(2)} €${m.imgs.length > 1 ? ` · photo ${k + 1}/${m.imgs.length}` : ""}` })));
          const placeShots = (activeRest.gallery || []).map(ph => ({ url: ph.url, caption: ph.caption || activeRest.name }));
          const shots = galleryTab === "lieu" ? placeShots : dishShots;
          return (
            <div className="gallery-ov" onClick={() => setGalleryOpen(false)}>
              <div className="gallery-sheet" onClick={e => e.stopPropagation()}>
                <div className="gallery-head">
                  <div><p style={{fontWeight:800,fontSize:16}}>📷 Galerie · {activeRest.name}</p><p style={{fontSize:12,color:"#64748B"}}>{shots.length} photo(s) · touchez pour agrandir</p></div>
                  <button className="modal-close" style={{position:"static"}} onClick={() => setGalleryOpen(false)}><Ic n="x" s={18} c="#64748B"/></button>
                </div>
                <div className="gallery-tabs">
                  {[["lieu", `🏠 Le lieu (${placeShots.length})`], ["plats", `🍽️ Les plats (${dishShots.length})`]].map(([k, l]) => (
                    <button key={k} className={`gallery-tab ${galleryTab === k ? "active" : ""}`} onClick={() => setGalleryTab(k)}>{l}</button>
                  ))}
                </div>
                {shots.length === 0 && <p style={{padding:24,textAlign:"center",color:"#94A3B8",fontSize:13}}>Aucune photo pour le moment.</p>}
                <div className="gallery-grid">
                  {shots.map((sh, k) => (
                    <button key={k} className="gallery-cell" onClick={() => setLightbox({ images: shots, index: k })}>
                      <img src={sh.url} alt={sh.caption} loading="lazy"/>
                      <span className="gallery-cap">{sh.caption}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          );
        })()}
        {lightbox && <Lightbox images={lightbox.images} index={lightbox.index} title={lightbox.title} onClose={() => setLightbox(null)} />}

        {/* ══ PROFIL ══ */}
        {flashMsg && <div className="flash-msg" role="status">{flashMsg}</div>}
        {page === "profile" && <ProfilePage user={user} proHome={proHome} onBack={() => setPage("home")} onHistory={() => setPage("history")}/>}

        {/* ══ HISTORIQUE ══ */}
        {page === "history" && <HistoryPage user={user} onBack={() => setPage("home")} onReorder={reorder} single={single}/>}

        {/* ══ MENTIONS LÉGALES (mode single) ══ */}
        {page === "legal" && single && <LegalPage brand={brand} rest={brandCtx.restaurant} onBack={() => setPage("home")}/>}

        {/* ══ PIED DE PAGE (mode single) : coordonnées, réseaux, mentions légales, « propulsé par » ══ */}
        {single && brandCtx.configured && ["home", "menu", "about", "legal", "history", "profile"].includes(page) && (
          <SiteFooter rest={brandCtx.restaurant || singleRest} brand={brand} badge={brandCtx.badge} platformName={brandCtx.platformName}
            onHome={() => setPage("home")} onAbout={() => singleRest && openPublicPage(singleRest)} onLegal={() => setPage("legal")}/>
        )}

      </div>
    </>
  );
}

// ─── Widget Notation ─────────────────────────────────────────────────────────
function RatingWidget({ orderId, restaurantName, onDone }) {
  const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000/api/v1";
  const [hover, setHover]     = useState(0);
  const [selected, setSelected] = useState(0);
  const [comment, setComment] = useState("");
  const [saving, setSaving]   = useState(false);
  const [error, setError]     = useState(null);

  const LABELS = ["","Mauvais","Passable","Correct","Bien","Excellent !"];

  const submit = async () => {
    if (!selected) return;
    setSaving(true); setError(null);
    try {
      await coreFetch(`/orders/${orderId}/rate/`, { method: "POST", body: JSON.stringify({ rating: selected, comment }) });
      onDone();
    } catch(e) { setError(e.message); }
    finally { setSaving(false); }
  };

  return (
    <div className="rating-widget">
      <p className="rating-title">Évaluez {restaurantName || "votre commande"}</p>
      <div className="stars-row">
        {[1,2,3,4,5].map(n => (
          <button key={n} className={`star-btn ${n <= (hover||selected) ? "active" : ""}`}
            onMouseEnter={() => setHover(n)} onMouseLeave={() => setHover(0)}
            onClick={() => setSelected(n)}>
            ★
          </button>
        ))}
      </div>
      {(hover || selected) > 0 && (
        <p className="rating-label">{LABELS[hover || selected]}</p>
      )}
      {selected > 0 && (
        <>
          <textarea className="rating-comment" placeholder="Un commentaire ? (optionnel)"
            value={comment} onChange={e => setComment(e.target.value)} rows={2}/>
          <div style={{display:"flex",gap:10,marginTop:8}}>
            <button className="rating-skip" onClick={onDone}>Passer</button>
            <button className="rating-submit" onClick={submit} disabled={saving}>
              {saving ? "..." : "Envoyer"}
            </button>
          </div>
        </>
      )}
      {!selected && <button className="rating-skip" onClick={onDone} style={{marginTop:12}}>Passer</button>}
      {error && <p style={{fontSize:12,color:"#EF4444",marginTop:6}}>{error}</p>}
    </div>
  );
}

// ─── Page Profil ─────────────────────────────────────────────────────────────
function ProfilePage({ user, proHome, onBack, onHistory }) {
  const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000/api/v1";
  const [form, setForm]   = useState({ first_name: user?.first_name||"", last_name: user?.last_name||"", email: user?.email||"", phone: user?.phone||"" });
  const [saving, setSaving] = useState(false);
  const [msg, setMsg]     = useState(null);
  const [pwForm, setPwForm] = useState({ old_password:"", new_password:"", confirm:"" });
  const [pwMsg, setPwMsg] = useState(null);
  const [pwSaving, setPwSaving] = useState(false);

  const apiFetch = (url, opts={}) => coreFetch(url, opts);

  const saveProfile = async () => {
    setSaving(true); setMsg(null);
    try {
      await apiFetch("/auth/me/", { method:"PATCH", body: JSON.stringify({ first_name: form.first_name, last_name: form.last_name, phone: form.phone }) });
      setMsg({ ok: true, text: "Profil mis à jour ✓" });
    } catch(e) { setMsg({ ok: false, text: e.message }); }
    finally { setSaving(false); }
  };

  const changePassword = async () => {
    if (pwForm.new_password !== pwForm.confirm) { setPwMsg({ ok:false, text:"Les mots de passe ne correspondent pas" }); return; }
    if (pwForm.new_password.length < 8) { setPwMsg({ ok:false, text:"Minimum 8 caractères" }); return; }
    setPwSaving(true); setPwMsg(null);
    try {
      await apiFetch("/auth/change-password/", { method:"POST", body: JSON.stringify({ old_password: pwForm.old_password, new_password: pwForm.new_password }) });
      setPwMsg({ ok:true, text:"Mot de passe modifié ✓" });
      setPwForm({ old_password:"", new_password:"", confirm:"" });
    } catch(e) { setPwMsg({ ok:false, text: e.message }); }
    finally { setPwSaving(false); }
  };

  const logout = () => {
    const refresh = localStorage.getItem("refresh");
    fetch(`${API}/auth/logout/`, { method:"POST", headers:{"Content-Type":"application/json","Authorization":`Bearer ${localStorage.getItem("access")}`}, body: JSON.stringify({ refresh }) })
      .finally(() => { ["access", "refresh", "user"].forEach(k => localStorage.removeItem(k)); window.location.href = "/login"; });
  };

  return (
    <div className="fade-in narrow-page" style={{padding:"24px 20px"}}>
      <button className="back-btn" aria-label="Retour" onClick={onBack} style={{marginBottom:20}}><Ic n="back" s={20} c="#1E293B"/></button>
      <h2 style={{fontFamily:"'Sora',sans-serif",fontSize:22,fontWeight:800,marginBottom:20}}>Mon profil</h2>

      {/* Avatar */}
      <div style={{display:"flex",alignItems:"center",gap:16,marginBottom:28,padding:"16px 20px",background:"#fff",borderRadius:16,border:"1px solid #E2E8F0"}}>
        <div style={{width:56,height:56,borderRadius:16,background:"#FF6B2C",color:"#fff",fontSize:22,fontWeight:800,display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"'Sora',sans-serif"}}>
          {form.first_name?.[0] || user?.email?.[0]?.toUpperCase() || "?"}
        </div>
        <div>
          <p style={{fontWeight:700,fontSize:16}}>{form.first_name} {form.last_name}</p>
          <p style={{fontSize:12,color:"#64748B"}}>{form.email}</p>
        </div>
      </div>

      {proHome && (
        <button onClick={() => window.location.href = proHome} style={{width:"100%",marginBottom:16,padding:"14px 18px",borderRadius:16,border:"none",background:"#FF6B2C",color:"#fff",fontWeight:800,fontSize:15,cursor:"pointer",fontFamily:"inherit",display:"flex",alignItems:"center",justifyContent:"space-between"}}>
          <span>🏪 {user?.role === "admin" ? "Retour à l'administration" : "Retour à mon tableau de bord"}</span><span>→</span>
        </button>
      )}

      {/* Infos */}
      <div style={{background:"#fff",borderRadius:16,border:"1px solid #E2E8F0",padding:"20px",marginBottom:16}}>
        <h3 style={{fontFamily:"'Sora',sans-serif",fontSize:15,fontWeight:700,marginBottom:16}}>Informations personnelles</h3>
        <div style={{display:"flex",flexDirection:"column",gap:12}}>
          {[["Prénom","first_name","Jean"],["Nom","last_name","Dupont"],["Téléphone","phone","+32 4 xx xx xx xx"]].map(([label,field,ph])=>(
            <div key={field}>
              <label style={{fontSize:12,fontWeight:600,color:"#64748B",display:"block",marginBottom:4}}>{label}</label>
              <input type={field==="phone"?"tel":"text"} style={{width:"100%",border:"1.5px solid #E2E8F0",borderRadius:10,padding:"10px 14px",fontSize:14,fontFamily:"inherit",outline:"none",boxSizing:"border-box"}}
                value={form[field]} placeholder={ph} onChange={e=>setForm(p=>({...p,[field]:e.target.value}))}/>
            </div>
          ))}
          <div>
            <label style={{fontSize:12,fontWeight:600,color:"#64748B",display:"block",marginBottom:4}}>Email</label>
            <input style={{width:"100%",border:"1.5px solid #E2E8F0",borderRadius:10,padding:"10px 14px",fontSize:14,fontFamily:"inherit",outline:"none",boxSizing:"border-box",background:"#F8FAFC",color:"#94A3B8"}} value={form.email} disabled/>
          </div>
        </div>
        {msg && <p style={{marginTop:12,fontSize:13,fontWeight:600,color:msg.ok?"#16A34A":"#DC2626"}}>{msg.text}</p>}
        <button onClick={saveProfile} disabled={saving}
          style={{marginTop:16,width:"100%",background:"#FF6B2C",color:"#fff",border:"none",borderRadius:12,padding:"12px",fontSize:14,fontWeight:700,cursor:"pointer",fontFamily:"inherit",opacity:saving?0.7:1}}>
          {saving ? "Sauvegarde..." : "Enregistrer les modifications"}
        </button>
      </div>

      {/* Mot de passe */}
      <div style={{background:"#fff",borderRadius:16,border:"1px solid #E2E8F0",padding:"20px",marginBottom:16}}>
        <h3 style={{fontFamily:"'Sora',sans-serif",fontSize:15,fontWeight:700,marginBottom:16}}>Changer le mot de passe</h3>
        <div style={{display:"flex",flexDirection:"column",gap:12}}>
          {[["Mot de passe actuel","old_password"],["Nouveau mot de passe","new_password"],["Confirmer","confirm"]].map(([label,field])=>(
            <div key={field}>
              <label style={{fontSize:12,fontWeight:600,color:"#64748B",display:"block",marginBottom:4}}>{label}</label>
              <input type="password" style={{width:"100%",border:"1.5px solid #E2E8F0",borderRadius:10,padding:"10px 14px",fontSize:14,fontFamily:"inherit",outline:"none",boxSizing:"border-box"}}
                value={pwForm[field]} onChange={e=>setPwForm(p=>({...p,[field]:e.target.value}))}/>
            </div>
          ))}
        </div>
        {pwMsg && <p style={{marginTop:12,fontSize:13,fontWeight:600,color:pwMsg.ok?"#16A34A":"#DC2626"}}>{pwMsg.text}</p>}
        <button onClick={changePassword} disabled={pwSaving}
          style={{marginTop:16,width:"100%",background:"#1E293B",color:"#fff",border:"none",borderRadius:12,padding:"12px",fontSize:14,fontWeight:700,cursor:"pointer",fontFamily:"inherit",opacity:pwSaving?0.7:1}}>
          {pwSaving ? "Modification..." : "Modifier le mot de passe"}
        </button>
      </div>

      {/* Actions rapides */}
      <div style={{background:"#fff",borderRadius:16,border:"1px solid #E2E8F0",padding:"6px 20px",marginBottom:16}}>
        <PushToggle label="Notifications de commande" hint="Confirmée, en préparation, prête : vous êtes prévenu même l'application fermée." />
      </div>

      <div style={{background:"#fff",borderRadius:16,border:"1px solid #E2E8F0",overflow:"hidden",marginBottom:16}}>
        {[
          { icon:"history", label:"Mes commandes",  action: onHistory },
        ].map(({icon,label,action})=>(
          <button key={label} onClick={action}
            style={{width:"100%",display:"flex",alignItems:"center",gap:14,padding:"16px 20px",border:"none",background:"#fff",cursor:"pointer",borderBottom:"1px solid #F1F5F9",fontFamily:"inherit"}}>
            <div style={{width:36,height:36,borderRadius:10,background:"#FFF0E8",display:"flex",alignItems:"center",justifyContent:"center"}}><Ic n={icon} s={18} c="#FF6B2C"/></div>
            <span style={{fontSize:14,fontWeight:600,color:"#1E293B",flex:1,textAlign:"left"}}>{label}</span>
            <Ic n="back" s={16} c="#94A3B8" style={{transform:"rotate(180deg)"}}/>
          </button>
        ))}
        <button onClick={logout}
          style={{width:"100%",display:"flex",alignItems:"center",gap:14,padding:"16px 20px",border:"none",background:"#fff",cursor:"pointer",fontFamily:"inherit"}}>
          <div style={{width:36,height:36,borderRadius:10,background:"#FEE2E2",display:"flex",alignItems:"center",justifyContent:"center"}}><Ic n="logout" s={18} c="#EF4444"/></div>
          <span style={{fontSize:14,fontWeight:600,color:"#EF4444",flex:1,textAlign:"left"}}>Se déconnecter</span>
        </button>
      </div>
    </div>
  );
}

// ─── Page Historique ──────────────────────────────────────────────────────────
function HistoryPage({ user, onBack, onReorder, single = false }) {
  const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000/api/v1";
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]   = useState(null);

  const STATUS_LABEL = { nouvelle:"Reçue",confirmee:"Confirmée",en_cuisine:"En cuisine",prete:"Prête",en_livraison:"En livraison",recuperee:"Récupérée",annulee:"Annulée" };
  const STATUS_COLOR = { nouvelle:"#3B82F6",confirmee:"#F59E0B",en_cuisine:"#8B5CF6",prete:"#10B981",en_livraison:"#0EA5E9",recuperee:"#6B7280",annulee:"#EF4444" };

  useEffect(() => {
    if (!user) return;
    coreFetch(`/orders/?ordering=-created_at&page_size=50`)
      .then(d => { setOrders(d.results || []); setLoading(false); })
      .catch(e => { setError(e.message); setLoading(false); });
  }, [user]);

  const formatDate = (iso) => {
    if (!iso) return "";
    const d = new Date(iso);
    return d.toLocaleDateString("fr-BE", { day:"2-digit", month:"short", year:"numeric" }) + " · " + d.toLocaleTimeString("fr-BE", { hour:"2-digit", minute:"2-digit" });
  };

  return (
    <div className="fade-in narrow-page" style={{padding:"24px 20px"}}>
      <button className="back-btn" aria-label="Retour" onClick={onBack} style={{marginBottom:20}}><Ic n="back" s={20} c="#1E293B"/></button>
      <h2 style={{fontFamily:"'Sora',sans-serif",fontSize:22,fontWeight:800,marginBottom:20}}>Mes commandes</h2>

      {loading && <div style={{display:"flex",alignItems:"center",gap:10,padding:"40px 0",justifyContent:"center",color:"#64748B"}}><Ic n="loader" s={20} c="#FF6B2C"/> Chargement...</div>}
      {error  && <p style={{color:"#EF4444",fontSize:14}}>{error}</p>}
      {!loading && orders.length === 0 && (
        <div style={{textAlign:"center",padding:"60px 20px"}}>
          <div style={{fontSize:48,marginBottom:16}}>🛍️</div>
          <p style={{fontWeight:700,fontSize:16,marginBottom:8}}>Aucune commande</p>
          <p style={{fontSize:14,color:"#64748B"}}>Vos commandes passées apparaîtront ici.</p>
        </div>
      )}

      <div style={{display:"flex",flexDirection:"column",gap:12}}>
        {orders.map(order => {
          const items = order.items || order.order_items || [];
          const color = STATUS_COLOR[order.status] || "#6B7280";
          const label = STATUS_LABEL[order.status] || order.status;
          return (
            <div key={order.id} style={{background:"#fff",borderRadius:16,border:"1px solid #E2E8F0",padding:"16px",boxShadow:"0 2px 8px rgba(0,0,0,.04)"}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:8}}>
                <div>
                  <p style={{fontFamily:"'Sora',sans-serif",fontWeight:800,fontSize:15}}>#{order.number || order.id?.toString().slice(0,8)}</p>
                  <p style={{fontSize:11,color:"#94A3B8",marginTop:2}}>{formatDate(order.created_at)}</p>
                </div>
                <span style={{fontSize:11,fontWeight:700,padding:"4px 10px",borderRadius:20,background:color+"1A",color}}>{order.status === "recuperee" && order.order_type === "livraison" ? "Livrée" : label}</span>
              </div>
              {!single && <p style={{fontSize:13,fontWeight:600,color:"#64748B",marginBottom:8}}>{order.restaurant_name || "Restaurant"}</p>}
              <div style={{display:"flex",flexWrap:"wrap",gap:6,marginBottom:10}}>
                {items.slice(0,4).map((item,i)=>(
                  <span key={i} style={{fontSize:12,background:"#F8FAFC",borderRadius:8,padding:"3px 10px",fontWeight:500}}>
                    {item.qty||item.quantity||1}× {item.name||item.item_name}
                  </span>
                ))}
                {items.length > 4 && <span style={{fontSize:12,color:"#94A3B8"}}>+{items.length-4} autres</span>}
              </div>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",paddingTop:10,borderTop:"1px solid #F1F5F9",gap:8,flexWrap:"wrap"}}>
                <span style={{fontSize:12,color:"#64748B"}}>{order.order_type === "sur_place" ? "🪑 Sur place" : order.order_type === "livraison" ? "🛵 Livraison" : "🥡 À emporter"}{order.client_rating ? ` · ${"★".repeat(order.client_rating)}` : ""}{parseFloat(order.discount_amount) > 0 ? ` · 🎁 −${parseFloat(order.discount_amount).toFixed(2)} €` : ""}</span>
                <div style={{display:"flex",alignItems:"center",gap:10}}>
                  <span style={{fontFamily:"'Sora',sans-serif",fontWeight:800,fontSize:16,color:"#FF6B2C"}}>{parseFloat(order.total_price||0).toFixed(2)} €</span>
                  {onReorder && order.restaurant && <button className="reorder-btn" onClick={() => onReorder(order)} style={{background:"#FF6B2C",color:"#fff",border:"none",borderRadius:10,padding:"10px 14px",fontSize:12,fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>↻ Commander à nouveau</button>}
                </div>
              </div>
              {order.owner_reply && <div style={{marginTop:10,fontSize:12,background:"#F0FDF4",border:"1px solid #BBF7D0",borderRadius:8,padding:"8px 10px",color:"#166534"}}><strong>Réponse du restaurant :</strong> {order.owner_reply}</div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

const CSS = `
  *,*::before,*::after{box-sizing:border-box;margin:0;padding:0;}
  :root{--primary:#FF6B2C;--primary-d:#E55A1F;--primary-l:#FFF0E8;--dark:#0F172A;--text:#1E293B;--text-soft:#64748B;--bg:#F8F9FB;--white:#fff;--border:#E2E8F0;--radius:16px;--shadow:0 2px 12px rgba(0,0,0,.07);--shadow-md:0 8px 32px rgba(0,0,0,.12);}
  html,body{overflow-x:hidden;-webkit-text-size-adjust:100%;}
  body{font-family:'DM Sans',sans-serif;background:var(--bg);color:var(--text);max-width:480px;margin:0 auto;}
  img{max-width:100%;}
  .app{min-height:100vh;min-height:100dvh;padding-bottom:calc(80px + env(safe-area-inset-bottom));}
  .fade-in{animation:fadeUp .35s ease both;}
  @keyframes fadeUp{from{opacity:0;transform:translateY(12px);}to{opacity:1;transform:translateY(0);}}

  .navbar{position:sticky;top:0;z-index:100;background:var(--white);border-bottom:1px solid var(--border);padding:12px 16px;padding-top:calc(12px + env(safe-area-inset-top));display:flex;align-items:center;gap:12px;box-shadow:var(--shadow);}
  .nav-logo{display:flex;align-items:center;gap:8px;cursor:pointer;flex-shrink:0;}
  .nav-logo-icon{font-size:22px;}
  .nav-logo-text{font-family:'Sora',sans-serif;font-size:16px;font-weight:700;color:var(--text);}
  .nav-logo-text b{color:var(--primary);}
  /* Tous les contrôles du header partagent la même hauteur (40px) pour un rythme régulier */
  .nav-search{flex:1;min-width:0;height:40px;background:var(--bg);border:1.5px solid var(--border);border-radius:12px;padding:0 12px;display:flex;align-items:center;gap:8px;cursor:pointer;font-size:13px;color:var(--text-soft);transition:border-color .15s;}
  .nav-search:hover{border-color:#CBD5E1;}
  .nav-search svg{flex-shrink:0;}
  .nav-search span{min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
  .nav-search-short{display:none;}
  .nav-actions{display:flex;align-items:center;gap:10px;flex-shrink:0;}
  .nav-icon-btn{width:40px;height:40px;border-radius:12px;border:none;background:none;display:flex;align-items:center;justify-content:center;cursor:pointer;}
  .nav-avatar{width:40px;height:40px;border-radius:12px;background:var(--primary);color:#fff;font-weight:800;font-size:15px;display:flex;align-items:center;justify-content:center;cursor:pointer;font-family:'Sora',sans-serif;}
  .nav-login-btn{height:40px;padding:0 14px;border-radius:12px;background:var(--dark);color:#fff;border:none;display:flex;align-items:center;gap:7px;cursor:pointer;font-family:'DM Sans',sans-serif;font-size:13px;font-weight:700;white-space:nowrap;transition:background .15s;}
  .nav-login-btn:hover{background:#1E293B;}
  .nav-pro-btn{background:var(--primary);}
  .nav-pro-btn:hover{background:#E85A1F;}
  .nav-cart-btn{position:relative;width:40px;height:40px;border-radius:12px;border:none;background:var(--primary);display:flex;align-items:center;justify-content:center;cursor:pointer;}
  .cart-badge{position:absolute;top:-4px;right:-4px;background:#EF4444;color:#fff;font-size:9px;font-weight:800;width:16px;height:16px;border-radius:50%;display:flex;align-items:center;justify-content:center;border:2px solid #fff;}

  .hero{background:linear-gradient(135deg,#0F172A 0%,#1E293B 100%);padding:40px 24px 48px;position:relative;overflow:hidden;}
  .hero-content{position:relative;z-index:2;}
  .hero-eyebrow{font-size:13px;color:rgba(255,255,255,.6);margin-bottom:12px;font-weight:500;}
  .hero-title{font-family:'Sora',sans-serif;font-size:36px;font-weight:800;color:#fff;line-height:1.15;margin-bottom:14px;}
  .hero-title span{color:var(--primary);}
  .hero-sub{font-size:14px;color:rgba(255,255,255,.6);line-height:1.6;margin-bottom:24px;max-width:280px;}
  .hero-btn{display:flex;align-items:center;gap:8px;background:var(--primary);color:#fff;border:none;border-radius:14px;padding:14px 22px;font-size:15px;font-weight:700;cursor:pointer;font-family:'DM Sans',sans-serif;transition:all .2s;}
  .hero-btn:hover{background:var(--primary-d);transform:translateY(-1px);}
  .hero-float{position:absolute;font-size:32px;animation:floatY 3s ease-in-out infinite;opacity:.25;}
  @keyframes floatY{0%,100%{transform:translateY(0);}50%{transform:translateY(-10px);}}
  .hero-visual{position:absolute;right:0;top:0;bottom:0;width:50%;z-index:1;}

  .section{padding:24px 20px 0;}
  .section-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;}
  .section-title{font-family:'Sora',sans-serif;font-size:18px;font-weight:800;color:var(--text);}

  .loading-row{display:flex;align-items:center;gap:10px;padding:20px;color:var(--text-soft);font-size:14px;animation:spin-loader 1s linear infinite;}
  .loading-menu{display:flex;flex-direction:column;align-items:center;gap:12px;padding:60px 20px;color:var(--text-soft);}
  @keyframes spin-loader{from{transform:rotate(0deg);}to{transform:rotate(360deg);}}

  .cuisine-chips{display:flex;gap:8px;overflow-x:auto;scrollbar-width:none;padding:16px 20px 0;}
  .cuisine-chips::-webkit-scrollbar{display:none;}
  .cuisine-chip{padding:8px 16px;border-radius:20px;border:1.5px solid var(--border);background:var(--white);font-size:13px;font-weight:600;cursor:pointer;white-space:nowrap;transition:all .15s;font-family:'DM Sans',sans-serif;color:var(--text-soft);}
  .cuisine-chip.active{background:var(--primary);border-color:var(--primary);color:#fff;}

  .rest-row{display:flex;gap:14px;overflow-x:auto;scrollbar-width:none;padding-bottom:4px;}
  .rest-row::-webkit-scrollbar{display:none;}
  .rest-card-h{width:200px;flex-shrink:0;border-radius:var(--radius);overflow:hidden;background:var(--white);box-shadow:var(--shadow);cursor:pointer;transition:transform .2s,box-shadow .2s;}
  .rest-card-h:hover{transform:translateY(-3px);box-shadow:var(--shadow-md);}
  .rch-banner{height:110px;display:flex;align-items:center;justify-content:center;position:relative;overflow:hidden;}
  .rch-cover{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;}
  .rch-emoji{font-size:48px;}
  .rch-tag{position:absolute;top:8px;left:8px;background:rgba(0,0,0,.4);color:#fff;font-size:10px;font-weight:700;padding:3px 8px;border-radius:20px;backdrop-filter:blur(4px);}
  .rch-body{padding:12px;}
  .rch-top{display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;}
  .rch-name{font-size:14px;font-weight:700;color:var(--text);}
  .rch-rating{display:flex;align-items:center;gap:3px;font-size:12px;font-weight:700;color:#F59E0B;}
  .rch-meta{font-size:11px;color:var(--text-soft);}

  .rest-list{display:flex;flex-direction:column;gap:12px;margin-top:16px;}
  .rest-card-v{background:var(--white);border-radius:var(--radius);padding:14px;display:flex;align-items:center;justify-content:space-between;box-shadow:var(--shadow);cursor:pointer;transition:all .2s;border:1.5px solid var(--border);}
  .rest-card-v:hover{box-shadow:var(--shadow-md);border-color:#CBD5E1;}
  .rest-card-v.closed{opacity:.6;cursor:not-allowed;}
  .rcv-left{display:flex;align-items:center;gap:12px;flex:1;}
  .rcv-img{width:56px;height:56px;border-radius:14px;display:flex;align-items:center;justify-content:center;font-size:28px;flex-shrink:0;}
  .rcv-info{flex:1;}
  .rcv-name{font-size:15px;font-weight:700;color:var(--text);margin-bottom:2px;}
  .rcv-meta{font-size:12px;color:var(--text-soft);margin-bottom:4px;}
  .rcv-stats{display:flex;gap:10px;font-size:12px;color:var(--text-soft);align-items:center;}
  .rcv-stats span{display:flex;align-items:center;gap:3px;}
  .rcv-public-btn{width:32px;height:32px;border-radius:8px;border:1.5px solid var(--border);background:var(--bg);display:flex;align-items:center;justify-content:center;cursor:pointer;flex-shrink:0;transition:all .15s;}
  .rcv-public-btn.fav{background:#FFF0E8;border-color:#FED7AA;}
  .rcv-public-btn:hover{border-color:var(--primary);background:var(--primary-l);}
  .closed-badge{background:#FEE2E2;color:#DC2626;font-size:10px;font-weight:700;padding:2px 7px;border-radius:20px;}

  .pub-hero{position:relative;padding-bottom:40px;overflow:hidden;}
  .pub-hero-overlay{position:absolute;inset:0;background:linear-gradient(to bottom,rgba(0,0,0,.3) 0%,rgba(0,0,0,.6) 100%);}
  .pub-hero-nav{position:relative;z-index:2;display:flex;justify-content:space-between;align-items:center;padding:16px 20px;}
  .pub-back-btn,.pub-icon-btn{width:38px;height:38px;border-radius:10px;border:none;background:rgba(255,255,255,.2);backdrop-filter:blur(8px);display:flex;align-items:center;justify-content:center;cursor:pointer;}
  .pub-hero-content{position:relative;z-index:2;padding:0 20px;text-align:center;}
  .pub-logo{font-size:56px;margin-bottom:12px;}
  .pub-name{font-family:'Sora',sans-serif;font-size:28px;font-weight:800;color:#fff;margin-bottom:6px;}
  .pub-cuisine{font-size:14px;color:rgba(255,255,255,.7);margin-bottom:14px;}
  .pub-stats{display:flex;justify-content:center;gap:16px;font-size:13px;color:rgba(255,255,255,.85);font-weight:600;flex-wrap:wrap;}
  .pub-stats span{display:flex;align-items:center;gap:5px;}
  .pub-body{padding:0 20px 40px;}
  .pub-status-bar{display:flex;align-items:center;justify-content:space-between;padding:16px 0;border-bottom:1px solid var(--border);margin-bottom:20px;}
  .pub-open-badge{font-size:13px;font-weight:700;padding:6px 14px;border-radius:20px;}
  .pub-open-badge.open{background:#DCFCE7;color:#16A34A;}
  .pub-open-badge.closed{background:#FEE2E2;color:#DC2626;}
  .pub-order-btn{background:var(--primary);color:#fff;border:none;border-radius:10px;padding:10px 18px;font-size:14px;font-weight:700;cursor:pointer;font-family:'DM Sans',sans-serif;}
  .pub-section{margin-bottom:28px;}
  .pub-section-title{font-family:'Sora',sans-serif;font-size:16px;font-weight:800;color:var(--text);margin-bottom:14px;}
  .pub-desc{font-size:14px;color:var(--text-soft);line-height:1.7;margin-bottom:12px;}
  .pub-tag{display:inline-block;background:var(--primary-l);color:var(--primary);font-size:12px;font-weight:700;padding:4px 12px;border-radius:20px;margin-right:6px;}
  .pub-info-grid{display:flex;flex-direction:column;gap:14px;}
  .pub-info-item{display:flex;align-items:flex-start;gap:12px;padding:12px;background:var(--bg);border-radius:12px;}
  .pub-info-label{font-size:11px;font-weight:700;color:var(--text-soft);text-transform:uppercase;letter-spacing:.4px;margin-bottom:3px;}
  .pub-info-val{font-size:14px;font-weight:600;color:var(--text);}
  .pub-hours{display:flex;flex-direction:column;gap:3px;width:100%;}
  .pub-hours-row{display:flex;justify-content:space-between;gap:12px;font-size:13px;font-weight:600;color:var(--text);}
  .pub-hours-row.closed{color:var(--text-soft);}
  .pub-hours-row.closed span:last-child{color:#DC2626;}
  .pub-menu-preview{display:flex;flex-direction:column;gap:12px;}
  .pub-menu-item{display:flex;gap:12px;padding:12px;background:var(--white);border-radius:14px;border:1px solid var(--border);box-shadow:var(--shadow);}
  .pub-menu-img{width:64px;height:64px;border-radius:10px;object-fit:cover;flex-shrink:0;}
  .pub-menu-info{flex:1;}
  .pub-menu-name{font-size:14px;font-weight:700;color:var(--text);margin-bottom:3px;}
  .pub-menu-desc{font-size:12px;color:var(--text-soft);line-height:1.4;margin-bottom:4px;}
  .pub-menu-price{font-size:14px;font-weight:800;color:var(--primary);}
  .pub-rating-big{display:flex;align-items:center;gap:16px;padding:16px;background:var(--bg);border-radius:12px;margin-bottom:16px;}
  .pub-rating-num{font-family:'Sora',sans-serif;font-size:40px;font-weight:800;color:var(--text);}
  .pub-review{padding:14px;background:var(--white);border-radius:12px;border:1px solid var(--border);margin-bottom:10px;}
  .pub-review-header{display:flex;align-items:center;gap:10px;margin-bottom:8px;}
  .pub-review-av{width:32px;height:32px;border-radius:10px;background:var(--primary-l);color:var(--primary);display:flex;align-items:center;justify-content:center;font-weight:800;font-size:14px;flex-shrink:0;}
  .pub-review-name{font-size:13px;font-weight:700;color:var(--text);margin-bottom:2px;}
  .pub-review-date{font-size:11px;color:var(--text-soft);margin-left:auto;}
  .pub-review-text{font-size:13px;color:var(--text-soft);line-height:1.5;}
  .reviews-empty{text-align:center;padding:20px 16px;background:var(--bg);border-radius:12px;font-size:14px;color:#64748B;}
  .pub-cta{position:sticky;bottom:calc(20px + env(safe-area-inset-bottom));padding:16px 0;}
  .flash-msg{position:fixed;left:50%;transform:translateX(-50%);top:calc(14px + env(safe-area-inset-top));z-index:900;background:#0F172A;color:#fff;padding:12px 18px;border-radius:14px;font-size:14px;font-weight:700;box-shadow:0 10px 30px rgba(0,0,0,.25);max-width:calc(100vw - 32px);text-align:center;animation:fadeIn .2s;}
  .pub-cta-btn{width:100%;padding:16px;border-radius:14px;border:none;background:var(--primary);color:#fff;font-size:16px;font-weight:700;cursor:pointer;font-family:'DM Sans',sans-serif;box-shadow:0 4px 16px rgba(255,107,44,.4);}

  .rest-banner{padding:48px 20px 24px;position:relative;}
  .back-btn-white{position:absolute;top:16px;left:16px;width:38px;height:38px;border-radius:10px;border:none;background:rgba(255,255,255,.2);backdrop-filter:blur(8px);display:flex;align-items:center;justify-content:center;cursor:pointer;}
  .pub-page-btn{position:absolute;top:16px;right:16px;display:flex;align-items:center;gap:5px;background:rgba(255,255,255,.2);backdrop-filter:blur(8px);border:none;border-radius:10px;padding:8px 12px;font-size:12px;font-weight:700;color:#fff;cursor:pointer;font-family:'DM Sans',sans-serif;}
  .rest-banner-content{display:flex;align-items:center;gap:14px;}
  .rest-banner-emoji{font-size:44px;}
  .rest-banner-name{font-family:'Sora',sans-serif;font-size:22px;font-weight:800;color:#fff;margin-bottom:6px;}
  .rest-banner-meta{display:flex;gap:12px;font-size:13px;color:rgba(255,255,255,.8);font-weight:500;align-items:center;flex-wrap:wrap;}
  .rest-banner-meta span{display:flex;align-items:center;gap:4px;}
  .cat-tabs{display:flex;gap:6px;overflow-x:auto;scrollbar-width:none;padding:16px 20px;background:var(--white);border-bottom:1px solid var(--border);}
  .cat-tabs::-webkit-scrollbar{display:none;}
  .cat-tab{padding:8px 16px;border-radius:20px;border:1.5px solid var(--border);background:var(--white);font-size:13px;font-weight:600;cursor:pointer;white-space:nowrap;transition:all .15s;color:var(--text-soft);font-family:'DM Sans',sans-serif;}
  .cat-tab.active{background:var(--primary);border-color:var(--primary);color:#fff;}
  .menu-section{padding:16px 20px;display:flex;flex-direction:column;gap:12px;}
  .menu-item{display:flex;gap:12px;background:var(--white);border-radius:var(--radius);padding:14px;box-shadow:var(--shadow);cursor:pointer;transition:all .2s;border:1.5px solid var(--border);}
  .menu-item:hover{box-shadow:var(--shadow-md);}
  .mi-info{flex:1;}
  .mi-name{font-size:15px;font-weight:700;color:var(--text);margin-bottom:4px;}
  .mi-desc{font-size:12px;color:var(--text-soft);line-height:1.4;margin-bottom:6px;}
  .mi-price{font-size:15px;font-weight:800;color:var(--primary);}
  .mi-right{display:flex;flex-direction:column;align-items:flex-end;gap:8px;flex-shrink:0;}
  .mi-img{width:72px;height:72px;border-radius:12px;object-fit:cover;}
  .mi-count{position:absolute;bottom:4px;right:4px;font-size:10px;font-weight:800;background:rgba(15,23,42,.75);color:#fff;padding:2px 6px;border-radius:10px;pointer-events:none;}
  .mi-img{cursor:zoom-in;}
  .modal-carousel{display:flex;overflow-x:auto;scroll-snap-type:x mandatory;-webkit-overflow-scrolling:touch;scrollbar-width:none;}
  .modal-carousel::-webkit-scrollbar{display:none;}
  .modal-img-slide{flex:0 0 100%;scroll-snap-align:start;cursor:zoom-in;}
  .modal-carousel-hint{font-size:11px;color:#64748B;text-align:center;padding:6px 0 0;}
  .gallery-ov{position:fixed;inset:0;z-index:300;background:rgba(15,23,42,.55);display:flex;align-items:flex-end;justify-content:center;animation:fadeIn .2s;}
  .gallery-sheet{background:#fff;width:100%;max-width:720px;max-height:88dvh;border-radius:22px 22px 0 0;display:flex;flex-direction:column;animation:slideUp .3s ease;}
  .gallery-head{display:flex;justify-content:space-between;align-items:center;padding:16px 18px;border-bottom:1px solid var(--border);}
  .gallery-tabs{display:flex;gap:6px;padding:10px 14px 0;}
  .gallery-tab{flex:1;padding:8px 10px;border-radius:10px;border:1.5px solid var(--border);background:#fff;font-size:13px;font-weight:700;color:var(--text-soft);cursor:pointer;font-family:inherit;}
  .gallery-tab.active{background:var(--primary);border-color:var(--primary);color:#fff;}
  .pub-hero-img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;cursor:zoom-in;}
  .place-strip{display:flex;gap:10px;overflow-x:auto;padding-bottom:6px;scroll-snap-type:x mandatory;-webkit-overflow-scrolling:touch;}
  .place-cell{position:relative;flex:0 0 200px;height:140px;border:none;padding:0;border-radius:14px;overflow:hidden;cursor:pointer;scroll-snap-align:start;background:var(--bg);}
  .place-cell img{width:100%;height:100%;object-fit:cover;display:block;}
  .gallery-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(110px,1fr));gap:8px;padding:14px;overflow-y:auto;padding-bottom:calc(14px + env(safe-area-inset-bottom));}
  .gallery-cell{position:relative;aspect-ratio:1;border:none;padding:0;border-radius:12px;overflow:hidden;cursor:pointer;background:var(--bg);}
  .gallery-cell img{width:100%;height:100%;object-fit:cover;display:block;transition:transform .2s;}
  .gallery-cell:hover img{transform:scale(1.05);}
  .gallery-cap{position:absolute;left:0;right:0;bottom:0;padding:14px 6px 5px;font-size:10px;font-weight:700;color:#fff;text-align:left;background:linear-gradient(transparent,rgba(0,0,0,.7));white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
  @media(min-width:600px){.gallery-ov{align-items:center;}.gallery-sheet{border-radius:22px;}}
  .mi-img-fallback{display:flex;align-items:center;justify-content:center;font-size:30px;background:var(--bg);border:1.5px solid var(--border);}
  .mi-add-btn{width:28px;height:28px;border-radius:8px;border:none;background:var(--primary);display:flex;align-items:center;justify-content:center;cursor:pointer;}
  .menu-item.unavailable{opacity:.55;cursor:not-allowed;background:#F8FAFC;}
  .menu-item.unavailable .mi-img{filter:grayscale(1);}
  .mi-badge{display:inline-block;margin-left:8px;font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.3px;padding:2px 7px;border-radius:20px;background:#FEE2E2;color:#DC2626;vertical-align:middle;}
  .mi-badge.low{background:#FEF3C7;color:#B45309;text-transform:none;letter-spacing:0;}
  .mi-badge.time{background:#EFF6FF;color:#1D4ED8;text-transform:none;letter-spacing:0;}
  .mi-allergens{font-size:11px;color:#B45309;margin:2px 0 4px;}
  .rest-notice{margin:12px 16px 0;background:#EFF6FF;border:1px solid #BFDBFE;color:#1D4ED8;border-radius:10px;padding:10px 14px;font-size:13px;font-weight:600;}

  .fab-cart{position:fixed;bottom:calc(24px + env(safe-area-inset-bottom));left:50%;transform:translateX(-50%);max-width:calc(100vw - 32px);background:var(--dark);color:#fff;border:none;border-radius:16px;padding:14px 22px;display:flex;align-items:center;gap:12px;font-size:14px;font-weight:700;cursor:pointer;box-shadow:0 8px 24px rgba(0,0,0,.25);z-index:90;transition:all .2s;font-family:'DM Sans',sans-serif;white-space:nowrap;}
  .fab-cart:hover{transform:translateX(-50%) translateY(-2px);}
  .fab-total{background:rgba(255,255,255,.15);padding:4px 10px;border-radius:8px;font-size:13px;}

  .modal-overlay{position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:200;display:flex;align-items:flex-end;animation:fadeIn .2s;}
  @keyframes fadeIn{from{opacity:0;}to{opacity:1;}}
  .item-modal{position:relative;background:var(--white);border-radius:24px 24px 0 0;width:100%;max-height:90vh;max-height:90dvh;overflow-y:auto;padding-bottom:env(safe-area-inset-bottom);animation:slideUp .35s cubic-bezier(.34,1.56,.64,1);}
  @keyframes slideUp{from{transform:translateY(100%);}to{transform:translateY(0);}}
  .modal-close{position:absolute;top:16px;right:16px;width:32px;height:32px;border-radius:50%;border:1.5px solid var(--border);background:var(--white);display:flex;align-items:center;justify-content:center;cursor:pointer;}
  .modal-img{width:100%;height:200px;object-fit:cover;}
  .modal-body{padding:20px;}
  .modal-name{font-family:'Sora',sans-serif;font-size:20px;font-weight:800;color:var(--text);margin-bottom:6px;}
  .modal-desc{font-size:14px;color:var(--text-soft);line-height:1.5;margin-bottom:16px;}
  .modal-opts{margin-bottom:20px;}
  .modal-opts-title{font-size:13px;font-weight:700;color:var(--text-soft);text-transform:uppercase;letter-spacing:.5px;margin-bottom:10px;}
  .opt-row{display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid var(--border);font-size:14px;cursor:pointer;}
  .opt-row input{accent-color:var(--primary);width:16px;height:16px;}
  .modal-footer{display:flex;align-items:center;gap:12px;}
  .qty-ctrl{display:flex;align-items:center;gap:12px;background:var(--bg);border-radius:12px;padding:8px 14px;}
  .qty-ctrl button{background:none;border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;}
  .qty-ctrl span{font-size:16px;font-weight:800;min-width:20px;text-align:center;}
  .modal-add-btn{flex:1;padding:14px;border-radius:12px;border:none;background:var(--primary);color:#fff;font-size:15px;font-weight:700;cursor:pointer;font-family:'DM Sans',sans-serif;}

  .login-notice{background:#FFF7ED;border:1.5px solid #FED7AA;border-radius:12px;padding:14px;display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;}
  .login-notice p{font-size:13px;color:#92400E;}
  .login-notice button{background:var(--primary);color:#fff;border:none;border-radius:8px;padding:8px 14px;font-size:13px;font-weight:700;cursor:pointer;white-space:nowrap;font-family:'DM Sans',sans-serif;}

  .page-header-bar{display:flex;align-items:center;justify-content:space-between;padding:16px 20px;background:var(--white);border-bottom:1px solid var(--border);}
  .page-header-title{font-family:'Sora',sans-serif;font-size:18px;font-weight:800;color:var(--text);}
  .back-btn{width:38px;height:38px;border-radius:10px;border:1.5px solid var(--border);background:var(--white);display:flex;align-items:center;justify-content:center;cursor:pointer;}
  .cart-body{padding:20px;display:flex;flex-direction:column;gap:14px;}
  .cart-item{display:flex;align-items:center;gap:12px;background:var(--white);border-radius:14px;padding:14px;box-shadow:var(--shadow);border:1px solid var(--border);}
  .ci-qty-ctrl{display:flex;align-items:center;gap:8px;background:var(--bg);border-radius:10px;padding:6px 10px;}
  .ci-qty-ctrl button{background:none;border:none;cursor:pointer;display:flex;}
  .ci-qty-ctrl span{font-size:14px;font-weight:800;min-width:18px;text-align:center;}
  .ci-info{flex:1;min-width:0;}
  .ci-name{overflow-wrap:anywhere;}
  @media(max-width:360px){.cart-item{gap:8px;padding:12px 10px;}.ci-qty-ctrl{gap:6px;padding:6px 6px;}.ci-price{font-size:14px;}}
  .ci-name{font-size:14px;font-weight:700;color:var(--text);}
  .ci-opts{font-size:12px;color:var(--text-soft);margin-top:2px;}
  .ci-price{font-size:15px;font-weight:800;color:var(--primary);}
  .ci-delete-btn{background:none;border:none;cursor:pointer;padding:4px;display:flex;align-items:center;opacity:.5;transition:opacity .15s;flex-shrink:0;}
  .ci-delete-btn:hover{opacity:1;}
  .cart-section-title{font-size:13px;font-weight:700;color:var(--text-soft);text-transform:uppercase;letter-spacing:.5px;margin-top:6px;}
  .type-btns{display:flex;gap:10px;}
  .type-btn{flex:1;padding:12px;border-radius:12px;border:1.5px solid var(--border);background:var(--white);font-size:13px;font-weight:700;cursor:pointer;transition:all .15s;font-family:'DM Sans',sans-serif;}
  .type-btn.active{background:var(--primary-l);border-color:var(--primary);color:var(--primary);}
  .slots-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;}
  .slot-btn{padding:10px;border-radius:10px;border:1.5px solid var(--border);background:var(--white);font-size:13px;font-weight:700;cursor:pointer;transition:all .15s;font-family:'DM Sans',sans-serif;}
  .slot-btn.active{background:var(--primary);border-color:var(--primary);color:#fff;}
  .slots-empty{display:flex;flex-direction:column;align-items:center;gap:6px;padding:20px;background:#FEF9C3;border-radius:12px;border:1.5px solid #FDE68A;text-align:center;}
  .slots-empty span{font-size:28px;}
  .slots-empty p{font-size:14px;font-weight:700;color:#92400E;margin:0;}
  .slots-empty-sub{font-size:12px;font-weight:400;color:#A16207;}
  .note-input{width:100%;border:1.5px solid var(--border);border-radius:12px;padding:12px 14px;font-size:14px;font-family:'DM Sans',sans-serif;outline:none;resize:none;background:var(--white);}
  .note-input:focus{border-color:var(--primary);}
  .cart-summary{background:var(--white);border-radius:14px;padding:16px;border:1px solid var(--border);}
  .cs-row{display:flex;justify-content:space-between;font-size:14px;color:var(--text-soft);margin-bottom:8px;}
  .cs-row.total{font-size:17px;font-weight:800;color:var(--text);margin-bottom:0;padding-top:10px;border-top:1.5px solid var(--border);}
  .order-btn{width:100%;padding:16px;border-radius:14px;border:none;background:var(--primary);color:#fff;font-size:16px;font-weight:700;cursor:pointer;font-family:'DM Sans',sans-serif;box-shadow:0 4px 16px rgba(255,107,44,.3);transition:all .2s;}
  .order-btn:hover{background:var(--primary-d);}

  .confirm-page{padding:40px 24px;display:flex;flex-direction:column;align-items:center;gap:24px;}
  .confirm-top{text-align:center;}
  .confirm-checkmark{width:72px;height:72px;border-radius:50%;background:var(--primary);display:flex;align-items:center;justify-content:center;margin:0 auto 16px;box-shadow:0 8px 24px rgba(255,107,44,.4);}
  .confirm-title{font-family:'Sora',sans-serif;font-size:24px;font-weight:800;color:var(--text);margin-bottom:8px;}
  .confirm-resto{font-size:15px;font-weight:700;color:var(--primary);margin-bottom:4px;}
  .confirm-num{font-size:16px;color:var(--text-soft);}
  .confirm-slot{font-size:14px;color:var(--text-soft);margin-top:4px;}
  .confirm-timeline{width:100%;background:var(--white);border-radius:var(--radius);padding:24px;box-shadow:var(--shadow);}
  .timeline-step{display:flex;align-items:flex-start;gap:12px;position:relative;margin-bottom:8px;}
  .ts-dot{width:24px;height:24px;border-radius:50%;background:var(--border);display:flex;align-items:center;justify-content:center;flex-shrink:0;transition:all .4s;}
  .timeline-step.done .ts-dot{background:var(--primary);}
  .timeline-step.current .ts-dot{background:var(--primary);box-shadow:0 0 0 6px rgba(255,107,44,.2);animation:pulse-dot 1.5s infinite;}
  @keyframes pulse-dot{0%,100%{box-shadow:0 0 0 6px rgba(255,107,44,.2);}50%{box-shadow:0 0 0 10px rgba(255,107,44,.05);}}
  .ts-line{position:absolute;left:11px;top:24px;width:2px;height:20px;background:var(--border);transition:background .4s;}
  .timeline-step.done .ts-line{background:var(--primary);}
  .ts-label{font-size:14px;font-weight:600;color:var(--text-soft);padding-top:3px;}
  .timeline-step.done .ts-label{color:var(--text);}
  .timeline-step.current .ts-label{color:var(--primary);font-weight:700;}
  .confirm-hint{font-size:13px;color:var(--text-soft);animation:blink-t 1.5s infinite;}
  @keyframes blink-t{0%,100%{opacity:1;}50%{opacity:.5;}}
  .confirm-ready{font-size:18px;font-weight:700;color:var(--primary);}
  .confirm-home-btn{display:flex;align-items:center;justify-content:center;gap:8px;width:100%;padding:16px;border-radius:14px;border:none;background:var(--dark);color:#fff;font-size:16px;font-weight:700;cursor:pointer;font-family:'DM Sans',sans-serif;transition:opacity .15s;}
  .confirm-home-btn:hover{opacity:.85;}
  .cancel-order-btn{width:100%;padding:14px;border-radius:14px;border:1.5px solid #FECACA;background:#FEF2F2;color:#DC2626;font-size:14px;font-weight:700;cursor:pointer;font-family:'DM Sans',sans-serif;transition:opacity .15s;margin-top:4px;}
  .cancel-order-btn:hover{background:#FEE2E2;}

  /* Pill commande en cours (navbar) */
  .order-pill{display:flex;align-items:center;gap:6px;background:#FFF0E8;border:1.5px solid #FDBA74;color:#C2410C;border-radius:20px;padding:5px 12px;font-size:12px;font-weight:700;cursor:pointer;font-family:'DM Sans',sans-serif;transition:all .15s;}
  .order-pill:hover{background:#FDBA74;}
  .order-pill-dot{width:7px;height:7px;border-radius:50%;background:#EF4444;animation:blink-t 1.2s infinite;flex-shrink:0;}

  /* Écran bon appétit */
  .retrieved-screen{display:flex;flex-direction:column;align-items:center;text-align:center;padding:20px 0;width:100%;}
  .retrieved-emoji{font-size:72px;margin-bottom:16px;animation:bounceIn .5s ease;}
  @keyframes bounceIn{0%{transform:scale(.5);opacity:0;}70%{transform:scale(1.1);}100%{transform:scale(1);opacity:1;}}
  .retrieved-title{font-family:'Sora',sans-serif;font-size:28px;font-weight:800;color:var(--text);margin-bottom:8px;}
  .retrieved-sub{font-size:15px;color:var(--text-soft);margin-bottom:4px;}
  .retrieved-resto{font-size:13px;color:var(--text-soft);}

  /* Écran annulation */
  .cancelled-screen{display:flex;flex-direction:column;align-items:center;text-align:center;padding:20px 0;width:100%;}
  .cancelled-icon{font-size:64px;margin-bottom:16px;animation:shakeIn .4s ease;}
  @keyframes shakeIn{0%{transform:scale(.7) rotate(-5deg);opacity:0;}60%{transform:scale(1.05) rotate(2deg);}100%{transform:scale(1) rotate(0);opacity:1;}}
  .cancelled-title{font-family:'Sora',sans-serif;font-size:24px;font-weight:800;color:#DC2626;margin-bottom:10px;}
  .cancelled-sub{font-size:15px;color:var(--text);margin-bottom:8px;}
  .cancelled-hint{font-size:13px;color:var(--text-soft);padding:10px 16px;background:#FEF2F2;border-radius:10px;border:1px solid #FECACA;}

  /* Widget notation */
  .rating-widget{width:100%;background:#fff;border-radius:16px;border:1px solid var(--border);padding:20px;margin-top:20px;text-align:center;}
  .rating-title{font-size:15px;font-weight:700;color:var(--text);margin-bottom:14px;}
  .stars-row{display:flex;justify-content:center;gap:6px;margin-bottom:8px;}
  .star-btn{background:none;border:none;font-size:36px;cursor:pointer;color:#E2E8F0;transition:color .1s,transform .1s;line-height:1;padding:0;}
  .star-btn.active{color:#F59E0B;}
  .star-btn:hover{transform:scale(1.15);}
  .rating-label{font-size:13px;font-weight:700;color:#F59E0B;margin-bottom:10px;}
  .rating-comment{width:100%;border:1.5px solid var(--border);border-radius:10px;padding:10px 12px;font-size:13px;font-family:inherit;resize:none;outline:none;box-sizing:border-box;margin-top:8px;}
  .rating-submit{flex:2;padding:11px;border-radius:10px;border:none;background:var(--primary);color:#fff;font-size:14px;font-weight:700;cursor:pointer;font-family:inherit;}
  .rating-skip{flex:1;padding:11px;border-radius:10px;border:1.5px solid var(--border);background:#fff;font-size:14px;font-weight:600;cursor:pointer;font-family:inherit;color:var(--text-soft);}

  .search-page{display:flex;flex-direction:column;}
  .search-header{display:flex;align-items:center;gap:12px;padding:14px 20px;background:var(--white);border-bottom:1px solid var(--border);}
  .search-input-wrap{flex:1;display:flex;align-items:center;gap:8px;background:var(--bg);border-radius:12px;padding:10px 14px;}
  .search-input-wrap input{flex:1;border:none;outline:none;font-size:14px;font-family:'DM Sans',sans-serif;background:transparent;color:var(--text);}
  .search-input-wrap input::placeholder{color:var(--text-soft);}
  .search-input-wrap button{background:none;border:none;cursor:pointer;display:flex;}
  .empty-state{text-align:center;padding:60px 20px;}
  .empty-title{font-family:'Sora',sans-serif;font-size:18px;font-weight:800;margin:12px 0 6px;}
  .empty-sub{font-size:14px;color:var(--text-soft);}

  /* ═══════════ RESPONSIVE ═══════════ */
  /* Écrans tactiles : zones de tap plus grandes */
  @media(pointer:coarse){
    .mi-add-btn{width:34px;height:34px;}
    .ci-delete-btn{padding:8px;}
    .cuisine-chip,.cat-tab{padding:9px 16px;}
  }
  /* Mobile : champs à 16px pour éviter le zoom automatique iOS au focus */
  @media(max-width:768px){
    .note-input,.rating-comment,.search-input-wrap input,.fi,select,textarea{font-size:16px;}
  }
  /* Petits téléphones : header compact (le logo fait office de bouton Accueil) */
  @media(max-width:520px){
    .nav-icon-btn{display:none;}
    .nav-logo-text{font-size:15px;}
    .nav-search-long{display:none;}
    .nav-search-short{display:inline;}
    .nav-login-btn svg{display:none;}
    .nav-login-btn{padding:0 12px;}
    .nav-pro-label{display:none;}
    .hero{padding:32px 20px 40px;}
    .hero-title{font-size:32px;}
    .confirm-page{padding:32px 18px;}
  }
  /* Téléphones ≤460px : la recherche devient une icône alignée à droite, Connexion garde son libellé */
  @media(max-width:460px){
    .nav-search{flex:0 0 40px;width:40px;padding:0;justify-content:center;margin-left:auto;}
    .nav-search span{display:none;}
  }
  @media(max-width:400px){
    .nav-logo-icon{font-size:20px;}
    .hero-title{font-size:30px;}
    .rest-card-h{width:180px;}
    .type-btn{font-size:12px;padding:11px 8px;}
  }
  /* Écrans ≤350px (iPhone SE 1re gén., Android très compacts) : seul le logo emoji reste */
  @media(max-width:350px){
    .nav-logo-text{display:none;}
    .navbar{gap:10px;padding-left:14px;padding-right:14px;}
  }
  /* Desktop : conteneur large, grilles, flux étroits centrés */
  @media(min-width:1024px){
    body{max-width:1120px;}
    .app{padding-bottom:48px;}
    .navbar{padding:14px 32px;gap:16px;}
    .nav-search{max-width:440px;padding:11px 16px;font-size:14px;}
    .nav-logo-text{font-size:18px;}
    .hero{padding:72px 48px 80px;border-radius:0 0 28px 28px;}
    .hero-eyebrow{font-size:15px;}
    .hero-title{font-size:58px;}
    .hero-sub{font-size:17px;max-width:480px;}
    .hero-float{font-size:60px;}
    .hero-visual{width:40%;}
    .section{padding:32px 32px 0;}
    .section-title{font-size:22px;}
    .cuisine-chips{padding:28px 32px 0;flex-wrap:wrap;overflow:visible;}
    .rest-row{flex-wrap:wrap;overflow:visible;gap:20px;}
    .rest-card-h{width:calc(25% - 15px);}
    .rch-banner{height:130px;}
    .rest-list{display:grid;grid-template-columns:repeat(2,1fr);gap:16px;}
    .rest-banner{padding:56px 32px 28px;}
    .rest-banner-name{font-size:30px;}
    .rest-banner-emoji{font-size:56px;}
    .cat-tabs{padding:16px 32px;}
    .menu-section{padding:24px 32px;display:grid;grid-template-columns:repeat(2,1fr);gap:16px;}
    .menu-item{align-self:start;}
    .search-page,.page-header-bar,.cart-body,.confirm-page,.pub-body,.pub-hero-content,.narrow-page{max-width:720px;margin-left:auto;margin-right:auto;width:100%;}
    .search-page .cuisine-chips{flex-wrap:nowrap;overflow-x:auto;}
    .modal-overlay{align-items:center;}
    .item-modal{max-width:560px;border-radius:24px;}
    .fab-cart{bottom:32px;}
  }
  ${SINGLE_CSS}
  ${TOUCH_CSS}
`;