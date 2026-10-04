/**
 * lib/ticket.js — Tickets imprimables (imprimante thermique 80 mm ou imprimante classique).
 *
 *   printTicket(order, restaurant, "kitchen")  → ticket cuisine (gros numéro, articles, note)
 *   printTicket(order, restaurant, "receipt")  → ticket client (prix, total, paiement, mentions)
 *
 * L'impression passe par un iframe caché : pas de fenêtre pop-up à autoriser.
 */
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

// Marque de l'instance (édition Marque Blanche) : fixée par le contexte de marque au chargement.
// En mode plateforme, l'en-tête reste le nom du restaurant et le pied « Commande via PickEatGo ».
let BRAND = { single: false, appName: "PickEatGo", badge: false, platformName: "PickEatGo" };
export function setTicketBrand(b) { if (b && typeof b === "object") BRAND = { ...BRAND, ...b }; }
export function getTicketBrand() { return BRAND; }
const money = (v) => `${parseFloat(v || 0).toFixed(2)} €`;
const TYPE = { sur_place: "SUR PLACE", emporter: "À EMPORTER", livraison: "LIVRAISON", comptoir: "COMPTOIR" };
const PAY  = { especes: "Espèces", carte: "Carte", en_ligne: "En ligne" };

const CSS = `
  @page { size: 80mm auto; margin: 4mm; }
  * { box-sizing: border-box; }
  body { width: 72mm; margin: 0; font-family: "Courier New", Courier, monospace; font-size: 12px; color: #000; }
  .c { text-align: center; } .b { font-weight: 700; } .big { font-size: 26px; font-weight: 700; } .xl { font-size: 18px; font-weight: 700; }
  .hr { border-top: 1px dashed #000; margin: 6px 0; }
  .row { display: flex; justify-content: space-between; gap: 6px; }
  .qty { display: inline-block; min-width: 26px; font-weight: 700; font-size: 15px; }
  .line { margin: 3px 0; font-size: 14px; }
  .opt { font-size: 11px; padding-left: 26px; }
  .note { border: 1px solid #000; padding: 4px 6px; margin: 6px 0; font-weight: 700; }
  .small { font-size: 10px; }
  .mt { margin-top: 8px; }
`;

function head(restaurant) {
  // Mode mono-restaurant : l'en-tête porte le nom de l'application ; le nom du restaurant suit s'il diffère
  const title = BRAND.single ? (BRAND.appName || restaurant?.name || "") : (restaurant?.name || "");
  const sub = BRAND.single && restaurant?.name && restaurant.name !== title ? `<div class="c small">${esc(restaurant.name)}</div>` : "";
  return `<div class="c b" style="font-size:15px">${esc(title)}</div>${sub}`;
}

function foot() {
  if (!BRAND.single) return `<div class="c small mt">Commande via ${esc(BRAND.platformName)}</div>`;
  return BRAND.badge ? `<div class="c small mt">Application propulsée par ${esc(BRAND.platformName)}</div>` : "";
}

export function ticketHTML(order, restaurant, kind = "kitchen") {
  const items = order.items || order.order_items || [];
  const created = order.created_at ? new Date(order.created_at) : new Date();
  const when = created.toLocaleString("fr-BE", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
  const pickup = String(order.pickup_slot || "").slice(0, 5);
  const type = TYPE[order.order_type] || order.order_type || "";
  const who = order.employee_name || order.created_by_name;

  let body;
  if (kind === "kitchen") {
    body = `
      <div class="c big">#${esc(order.number || "")}</div>
      <div class="c xl">${esc(type)}${pickup ? ` · ${esc(pickup)}` : ""}</div>
      <div class="c small">${esc(when)}${order.client_name && order.order_type !== "comptoir" ? ` · ${esc(order.client_name)}` : ""}</div>
      <div class="hr"></div>
      ${items.map(i => `
        <div class="line"><span class="qty">${esc(i.qty || 1)}×</span>${esc(i.name || i.item_name)}</div>
        ${(i.options || []).map(o => `<div class="opt">+ ${esc(o.label || o)}</div>`).join("")}
      `).join("")}
      ${order.delivery_address ? `<div class="note">LIVRER À : ${esc(order.delivery_address)}</div>` : ""}
      ${order.note ? `<div class="note">NOTE : ${esc(order.note)}</div>` : ""}
      <div class="hr"></div>
      <div class="c small">${items.reduce((s, i) => s + (i.qty || 1), 0)} article(s)</div>`;
  } else {
    body = `
      ${head(restaurant)}
      <div class="c small">${esc(restaurant?.address || "")}${restaurant?.city && !String(restaurant.address || "").toLowerCase().includes(String(restaurant.city).toLowerCase()) ? `, ${esc(restaurant.city)}` : ""}</div>
      ${restaurant?.phone ? `<div class="c small">Tél. ${esc(restaurant.phone)}</div>` : ""}
      ${restaurant?.vat_number ? `<div class="c small">TVA ${esc(restaurant.vat_number)}</div>` : ""}
      <div class="hr"></div>
      <div class="row"><span>Ticket #${esc(order.number || "")}</span><span>${esc(when)}</span></div>
      <div class="row small"><span>${esc(type)}${pickup && order.order_type !== "comptoir" ? ` · retrait ${esc(pickup)}` : ""}</span><span>${who ? `Servi par ${esc(who)}` : ""}</span></div>
      <div class="hr"></div>
      ${items.map(i => {
        const unit = parseFloat(i.price || 0), sub = i.subtotal != null ? parseFloat(i.subtotal) : unit * (i.qty || 1);
        return `<div class="row"><span><span class="qty">${esc(i.qty || 1)}×</span>${esc(i.name || i.item_name)}</span><span>${money(sub)}</span></div>
                ${(i.options || []).map(o => `<div class="opt">+ ${esc(o.label || o)}${o.extra_price && parseFloat(o.extra_price) > 0 ? ` (${money(o.extra_price)})` : ""}</div>`).join("")}`;
      }).join("")}
      <div class="hr"></div>
      ${parseFloat(order.discount_amount || 0) > 0 ? `<div class="row"><span>Sous-total</span><span>${money(parseFloat(order.total_price) + parseFloat(order.discount_amount))}</span></div>
      <div class="row"><span>${esc(order.discount_label || "Remise")}</span><span>-${money(order.discount_amount)}</span></div>` : ""}
      ${parseFloat(order.delivery_fee || 0) > 0 ? `<div class="row"><span>Frais de livraison</span><span>${money(order.delivery_fee)}</span></div>` : ""}
      ${order.delivery_address ? `<div class="small">Livraison : ${esc(order.delivery_address)}</div>` : ""}
      <div class="row xl"><span>TOTAL</span><span>${money(order.total_price)}</span></div>
      ${order.payment_method ? `<div class="row"><span>Payé en</span><span>${esc(PAY[order.payment_method] || order.payment_method)}</span></div>` : ""}
      <div class="hr"></div>
      <div class="c mt">${esc(restaurant?.receipt_footer || "Merci de votre visite !")}</div>
      ${foot()}`;
  }
  return `<!doctype html><html><head><meta charset="utf-8"><title>Ticket #${esc(order.number || "")}</title><style>${CSS}</style></head><body>${body}</body></html>`;
}

export function printTicket(order, restaurant, kind = "kitchen") {
  if (typeof window === "undefined") return;
  const html = ticketHTML(order, restaurant, kind);
  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;opacity:0;";
  document.body.appendChild(frame);
  const doc = frame.contentWindow.document;
  doc.open(); doc.write(html); doc.close();
  const done = () => setTimeout(() => frame.remove(), 1500);
  frame.contentWindow.onafterprint = done;
  setTimeout(() => {
    try { frame.contentWindow.focus(); frame.contentWindow.print(); }
    catch { done(); }
    // Sécurité si onafterprint ne se déclenche pas (certains navigateurs mobiles)
    setTimeout(done, 60000);
  }, 150);
}

/** Ouvre le ticket dans un nouvel onglet (aperçu / enregistrement PDF). */
export function previewTicket(order, restaurant, kind = "kitchen") {
  const w = window.open("", "_blank");
  if (!w) return;
  w.document.write(ticketHTML(order, restaurant, kind));
  w.document.close();
}

// Préférences d'impression, propres à l'appareil (tablette de la cuisine, caisse…)
const KEY = "peg_print";
export function getPrintPrefs() {
  try { return { autoKitchen: false, autoReceipt: false, ...JSON.parse(localStorage.getItem(KEY) || "{}") }; }
  catch { return { autoKitchen: false, autoReceipt: false }; }
}
export function setPrintPrefs(prefs) {
  try { localStorage.setItem(KEY, JSON.stringify(prefs)); } catch {}
}
