/**
 * Ouverture effective d'un restaurant : interrupteur du restaurateur ET horaires du jour.
 * Même règle que Restaurant.open_state côté serveur ; recalculée en direct dans le navigateur.
 *
 *   openState(hours, isOpen, now) → { open, label, reason }
 *   reason : "manual" (interrupteur fermé) | "closed_today" | "before" | "after" | "hours" | "always"
 *
 * Fuseau de référence : celui de l'instance (TENANT_TIMEZONE côté API, transmis par /branding/ et
 * appliqué via setRestaurantTimezone) ; Europe/Brussels par défaut.
 */
export const RESTAURANT_TZ = "Europe/Brussels";
let currentTz = RESTAURANT_TZ;

/** Fixe le fuseau de référence (appelé par le contexte de marque au chargement). */
export function setRestaurantTimezone(tz) {
  if (!tz || typeof tz !== "string") return;
  try { new Intl.DateTimeFormat("en-US", { timeZone: tz }); currentTz = tz; } catch { /* fuseau inconnu : on garde le précédent */ }
}
export function getRestaurantTimezone() { return currentTz; }

/**
 * « Maintenant » vu depuis le fuseau du restaurant : un Date dont les champs locaux (heures, jour…)
 * sont ceux du restaurant, même si l'appareil est réglé sur un autre fuseau (voyage, tablette mal réglée).
 */
export function localNow(tz = currentTz) {
  const now = new Date();
  try {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).formatToParts(now);
    const g = (t) => parseInt(parts.find(p => p.type === t).value, 10);
    return new Date(g("year"), g("month") - 1, g("day"), g("hour") % 24, g("minute"), g("second"));
  } catch { return now; }
}

/** AAAA-MM-JJ du jour, dans le fuseau du restaurant. */
export function todayLocalISO() {
  const d = localNow();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const hm = (t) => (t ? String(t).slice(0, 5) : "");
const minutes = (t) => { const [h, m] = hm(t).split(":").map(Number); return (h || 0) * 60 + (m || 0); };

export function openState(hours, isOpen, now = localNow()) {
  if (!isOpen) return { open: false, label: "Fermé", reason: "manual" };
  const day = (now.getDay() + 6) % 7;                     // 0 = lundi, comme Django
  const h = (hours || []).find(x => x.day_of_week === day);
  if (!h) return { open: true, label: "Ouvert", reason: "always" };
  if (h.is_open === false) return { open: false, label: "Fermé aujourd'hui", reason: "closed_today" };
  const t = now.getHours() * 60 + now.getMinutes();
  const o = minutes(h.open_time), c = minutes(h.close_time);
  const inside = c <= o ? (t >= o || t <= c) : (t >= o && t <= c);   // c <= o : ferme après minuit
  if (inside) return { open: true, label: `Ouvert · ferme à ${hm(h.close_time)}`, reason: "hours" };
  if (t < o) return { open: false, label: `Fermé · ouvre à ${hm(h.open_time)}`, reason: "before" };
  return { open: false, label: "Fermé · horaires terminés", reason: "after" };
}
