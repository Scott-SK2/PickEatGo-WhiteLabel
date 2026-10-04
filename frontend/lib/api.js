/**
 * lib/api.js — Client HTTP centralisé PickEatGo
 * - Gestion JWT (access + refresh automatique)
 * - Intercepteur 401 → refresh → retry
 * - Helpers pour tous les endpoints
 */

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000/api/v1";

// ─── Token storage ────────────────────────────────────────────────────────────
// En Next.js on utilise localStorage (côté client uniquement)
const getToken  = (key) => typeof window !== "undefined" ? localStorage.getItem(key) : null;
const setToken  = (key, val) => typeof window !== "undefined" && localStorage.setItem(key, val);
const clearAuth = () => {
  if (typeof window === "undefined") return;
  localStorage.removeItem("access");
  localStorage.removeItem("refresh");
  localStorage.removeItem("user");
};

// ─── Core fetch avec auto-refresh ────────────────────────────────────────────
let isRefreshing = false;
let refreshQueue = []; // callbacks en attente pendant le refresh

/** Date d'expiration (ms) d'un JWT, ou 0 si illisible. */
function tokenExpiry(token) {
  try { return JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))).exp * 1000; } catch { return 0; }
}

async function refreshAccessToken() {
  const refresh = getToken("refresh");
  if (!refresh) throw new Error("No refresh token");

  let res;
  try {
    res = await fetchWithRetry(`${API_BASE}/auth/refresh/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refresh }),
    });
  } catch (e) {
    throw e;                                   // serveur injoignable : on ne déconnecte pas, l'action échoue proprement
  }

  if (!res.ok) {
    // Un autre onglet a peut-être déjà renouvelé le jeton (rotation) : on réessaie avec le sien
    const latest = getToken("refresh");
    if (latest && latest !== refresh) {
      const again = await fetchWithRetry(`${API_BASE}/auth/refresh/`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ refresh: latest }) });
      if (again.ok) { const d = await again.json(); setToken("access", d.access); if (d.refresh) setToken("refresh", d.refresh); return d.access; }
    }
    if (res.status === 401 || res.status === 400) {        // jeton réellement invalide ou expiré (7 jours) : reconnexion
      clearAuth();
      if (typeof window !== "undefined") window.location.href = "/login";
      throw new Error("Session expirée");
    }
    throw new ApiError("Serveur indisponible, réessayez dans un instant.", res.status, {});
  }

  const data = await res.json();
  setToken("access", data.access);
  // Rotation : l'API renvoie un nouveau refresh et met l'ancien sur liste noire.
  // Sans le stocker, le rafraîchissement suivant échouait et déconnectait l'utilisateur.
  if (data.refresh) setToken("refresh", data.refresh);
  return data.access;
}

/** Jeton d'accès valide encore au moins `margin` secondes, renouvelé si besoin (WebSocket, envois de fichiers). */
export async function ensureFreshToken(margin = 60) {
  const access = getToken("access");
  if (!access) return null;
  if (tokenExpiry(access) - Date.now() > margin * 1000) return access;
  if (!getToken("refresh")) return access;
  if (isRefreshing) { await new Promise((resolve) => refreshQueue.push(resolve)); return getToken("access"); }
  isRefreshing = true;
  try { const t = await refreshAccessToken(); refreshQueue.forEach((cb) => cb()); refreshQueue = []; return t; }
  catch { return access; }
  finally { isRefreshing = false; }
}

const RETRY_STATUSES = [502, 503, 504];          // passerelle / serveur en cours de démarrage
const RETRY_DELAYS   = [1500, 3000];             // 3 tentatives au total
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** fetch avec nouvelles tentatives sur erreur réseau ou serveur indisponible (Render qui se réveille, coupure mobile). */
async function fetchWithRetry(url, options) {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(url, options);
      if (RETRY_STATUSES.includes(res.status) && attempt < RETRY_DELAYS.length) { await sleep(RETRY_DELAYS[attempt]); continue; }
      return res;
    } catch (e) {
      if (attempt < RETRY_DELAYS.length) { await sleep(RETRY_DELAYS[attempt]); continue; }
      throw new ApiError("Serveur injoignable. Vérifiez votre connexion puis réessayez.", 0, {});
    }
  }
}

/**
 * Requête authentifiée brute → Response (JWT, refresh automatique sur 401, nouvelles tentatives).
 * Utilisée par apiFetch et par les téléchargements de fichiers.
 */
export async function apiFetchRaw(endpoint, options = {}) {
  const url = endpoint.startsWith("http") ? endpoint : `${API_BASE}${endpoint}`;

  // Headers de base
  const headers = { ...options.headers };
  if (!(options.body instanceof FormData)) {
    headers["Content-Type"] = "application/json";
  }

  const access = getToken("access");
  if (access) headers["Authorization"] = `Bearer ${access}`;

  let res = await fetchWithRetry(url, { ...options, headers });

  // 401 → tente un refresh
  if (res.status === 401 && getToken("refresh")) {
    if (isRefreshing) {
      // Attend que le refresh en cours se termine
      await new Promise((resolve) => refreshQueue.push(resolve));
      headers["Authorization"] = `Bearer ${getToken("access")}`;
      res = await fetchWithRetry(url, { ...options, headers });
    } else {
      isRefreshing = true;
      try {
        const newToken = await refreshAccessToken();
        headers["Authorization"] = `Bearer ${newToken}`;
        res = await fetchWithRetry(url, { ...options, headers });
      } finally {
        isRefreshing = false;
        refreshQueue.forEach((cb) => cb());   // libère les requêtes en attente, succès ou échec
        refreshQueue = [];
      }
    }
  }
  return res;
}

export async function apiFetch(endpoint, options = {}) {
  const res = await apiFetchRaw(endpoint, options);

  // Réponse vide (204 No Content)
  if (res.status === 204) return null;

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    const message = (Array.isArray(data) ? data.flat().join(" ") : null) || data.detail || data.message ||
      (data && typeof data === "object" ? Object.entries(data).map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(", ") : v}`).join(" | ") : "") ||
      `Erreur ${res.status}`;
    throw new ApiError(message, res.status, data);
  }

  return data;
}

export class ApiError extends Error {
  constructor(message, status, data) {
    super(message);
    this.status = status;
    this.data   = data;
  }
}

// ─── Helpers HTTP ─────────────────────────────────────────────────────────────
const api = {
  get:    (url, opts = {})      => apiFetch(url, { method: "GET", ...opts }),
  post:   (url, body, opts = {}) => apiFetch(url, { method: "POST",  body: JSON.stringify(body), ...opts }),
  patch:  (url, body, opts = {}) => apiFetch(url, { method: "PATCH", body: JSON.stringify(body), ...opts }),
  put:    (url, body, opts = {}) => apiFetch(url, { method: "PUT",   body: JSON.stringify(body), ...opts }),
  delete: (url, opts = {})      => apiFetch(url, { method: "DELETE", ...opts }),
  upload: (url, formData, opts = {}) => apiFetch(url, { method: "POST", body: formData, ...opts }),
};

// ═══════════════════════════════════════════════════════════════════════════════
// AUTH
// ═══════════════════════════════════════════════════════════════════════════════
export const authApi = {
  register: (data) => api.post("/auth/register/", data),

  login: async (email, password) => {
    const data = await api.post("/auth/login/", { email, password });
    setToken("access",  data.access);
    setToken("refresh", data.refresh);
    setToken("user",    JSON.stringify(data.user));
    return data;
  },

  logout: async () => {
    try {
      await api.post("/auth/logout/", { refresh: getToken("refresh") });
    } finally {
      clearAuth();
    }
  },

  me: () => api.get("/auth/me/"),

  updateMe: (data) => api.patch("/auth/me/", data),

  getCurrentUser: () => {
    const raw = getToken("user");
    return raw ? JSON.parse(raw) : null;
  },

  isAuthenticated: () => !!getToken("access"),
};

// ═══════════════════════════════════════════════════════════════════════════════
// RESTAURANTS
// ═══════════════════════════════════════════════════════════════════════════════
export const restaurantApi = {
  list: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return api.get(`/restaurants/${qs ? "?" + qs : ""}`);
  },

  get: (id) => api.get(`/restaurants/${id}/`),

  create: (data) => api.post("/restaurants/", data),

  update: (id, data) => api.patch(`/restaurants/${id}/`, data),

  toggleOpen: (id) => api.patch(`/restaurants/${id}/toggle-open/`, {}),

  validate: (id) => api.patch(`/restaurants/${id}/validate/`, {}),

  suspend: (id, reason = "") => api.patch(`/restaurants/${id}/suspend/`, { reason }),

  updateContract: (id, data) => api.patch(`/restaurants/${id}/contract/`, data),

  // Upload logo/bannière
  uploadImage: async (id, field, file) => {
    const fd = new FormData();
    fd.append(field, file);
    return api.upload(`/restaurants/${id}/`, fd);
  },
};

// ═══════════════════════════════════════════════════════════════════════════════
// MENUS
// ═══════════════════════════════════════════════════════════════════════════════
export const menuApi = {
  // Catégories
  listCategories: (restaurantId) =>
    api.get(`/menus/categories/?restaurant=${restaurantId}`),

  createCategory: (data) => api.post("/menus/categories/", data),

  updateCategory: (id, data) => api.patch(`/menus/categories/${id}/`, data),

  deleteCategory: (id) => api.delete(`/menus/categories/${id}/`),

  // Plats
  listItems: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return api.get(`/menus/items/${qs ? "?" + qs : ""}`);
  },

  getItem: (id) => api.get(`/menus/items/${id}/`),

  createItem: (data) => api.post("/menus/items/", data),

  updateItem: (id, data) => api.patch(`/menus/items/${id}/`, data),

  deleteItem: (id) => api.delete(`/menus/items/${id}/`),

  toggleAvailability: (id) => api.patch(`/menus/items/${id}/toggle-availability/`, {}),

  // Upload photo
  uploadPhoto: async (itemId, file) => {
    const fd = new FormData();
    fd.append("image", file);
    return apiFetch(`/menus/items/${itemId}/upload-image/`, {
      method: "POST",
      body: fd,
    });
  },

  deletePhoto: (itemId) => api.delete(`/menus/items/${itemId}/delete-image/`),
};

// ═══════════════════════════════════════════════════════════════════════════════
// COMMANDES
// ═══════════════════════════════════════════════════════════════════════════════
export const orderApi = {
  list: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return api.get(`/orders/${qs ? "?" + qs : ""}`);
  },

  get: (id) => api.get(`/orders/${id}/`),

  create: (data) => api.post("/orders/", data),

  advance: (id) => api.patch(`/orders/${id}/advance/`, {}),

  cancel: (id) => api.patch(`/orders/${id}/cancel/`, {}),
};

export default api;
