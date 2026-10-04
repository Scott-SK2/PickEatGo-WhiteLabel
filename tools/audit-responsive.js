// Audit responsive : grille d'appareils × écrans, détection automatique des débordements horizontaux,
// des cibles tactiles < 32 px et des champs < 16 px (zoom iOS). Captures + report.json dans <outdir>.
// Prérequis : backend sur :8000 avec les données de tools/seed_demo.py, frontend `next start` sur :3000, Playwright installé.
// Usage : node tools/audit-responsive.js <outdir>
//         DEVICES=iphone-se,ipad-mini ONLY=dash-home,client-cart-delivery node tools/audit-responsive.js out
const { chromium } = require("playwright");
const fs = require("fs");
const OUT = process.argv[2] || "audit";
fs.mkdirSync(OUT, { recursive: true });
const API = "http://localhost:8000/api/v1";
const login = async (email) => {
  const r = await fetch(`${API}/auth/login/`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password: "Demo1234!" }) });
  if (!r.ok) throw new Error("login " + email + " " + r.status);
  return r.json();
};
const nav = (n) => async p => { await p.click(`.sb-item >> nth=${n}`); await p.waitForTimeout(900); };
const DEVICES = {
  "android-320": { w: 320, h: 640, mobile: true, dsf: 2 },
  "galaxy-s8":   { w: 360, h: 740, mobile: true, dsf: 3 },
  "iphone-se":   { w: 375, h: 667, mobile: true, dsf: 2 },
  "iphone-14":   { w: 390, h: 844, mobile: true, dsf: 3 },
  "pixel-7":     { w: 412, h: 915, mobile: true, dsf: 2.6 },
  "iphone-max":  { w: 430, h: 932, mobile: true, dsf: 3 },
  "phone-land":  { w: 844, h: 390, mobile: true, dsf: 3 },
  "ipad-mini":   { w: 768, h: 1024, mobile: true, dsf: 2 },
  "ipad-land":   { w: 1024, h: 768, mobile: true, dsf: 2 },
  "ipad-pro":    { w: 1024, h: 1366, mobile: true, dsf: 2 },
  "laptop":      { w: 1280, h: 800, mobile: false, dsf: 1 },
  "desktop":     { w: 1440, h: 900, mobile: false, dsf: 1 },
};
const SEL = process.env.DEVICES ? process.env.DEVICES.split(",") : Object.keys(DEVICES);
const SCEN = [
  { name: "dash-home",     user: "marie@example.com", path: "/dashboard", wait: ".kpi-row" },
  { name: "dash-notifs",   user: "marie@example.com", path: "/dashboard", wait: ".kpi-row", act: async p => { await p.click(".notif-wrap .icon-btn"); await p.waitForSelector(".notif-panel"); }, noFull: true },
  { name: "dash-orders",   user: "marie@example.com", path: "/dashboard", wait: ".kpi-row", act: nav(1) },
  { name: "dash-orders-pay", user: "marie@example.com", path: "/dashboard", wait: ".kpi-row", act: async p => { await nav(1)(p); const b = p.locator(".btn-advance", { hasText: "Récupérée" }).first(); await b.click(); await p.waitForSelector(".pay-inline"); } },
  { name: "dash-counter",  user: "marie@example.com", path: "/dashboard", wait: ".kpi-row", act: async p => { await nav(1)(p); await p.click(".menu-add-btn"); await p.waitForSelector(".counter-modal"); await p.locator(".counter-item").nth(0).click(); await p.locator(".counter-item").nth(0).click(); await p.locator(".counter-item").nth(2).click(); await p.waitForTimeout(300); }, noFull: true },
  { name: "dash-menu",     user: "marie@example.com", path: "/dashboard", wait: ".kpi-row", act: nav(2) },
  { name: "dash-menu-form", user: "marie@example.com", path: "/dashboard", wait: ".kpi-row", act: async p => { await nav(2)(p); await p.locator(".icon-btn-sm").first().click(); await p.waitForSelector(".menu-modal"); }, noFull: true },
  { name: "dash-stock",    user: "marie@example.com", path: "/dashboard", wait: ".kpi-row", act: nav(3) },
  { name: "dash-stock-modal", user: "marie@example.com", path: "/dashboard", wait: ".kpi-row", act: async p => { await nav(3)(p); await p.locator(".pill-btn.primary").first().click(); await p.waitForSelector(".pin-modal"); }, noFull: true },
  { name: "dash-sales",    user: "marie@example.com", path: "/dashboard", wait: ".kpi-row", act: async p => { await nav(4)(p); await p.waitForSelector(".tbl"); await p.waitForTimeout(600); } },
  { name: "dash-sales-month", user: "marie@example.com", path: "/dashboard", wait: ".kpi-row", act: async p => { await nav(4)(p); await p.waitForSelector(".tbl"); await p.click(".filter-chip:has-text('Ce mois')"); await p.waitForTimeout(900); } },
  { name: "dash-customers", user: "marie@example.com", path: "/dashboard", wait: ".kpi-row", act: async p => { await nav(5)(p); await p.waitForSelector(".tbl"); await p.locator(".tbl tbody tr").first().click(); await p.waitForTimeout(900); } },
  { name: "dash-staff",    user: "marie@example.com", path: "/dashboard", wait: ".kpi-row", act: async p => { await p.click(".staff-btn"); await p.waitForSelector(".pin-modal"); for (const k of ["4","8","2","6"]) await p.locator(".pin-key", { hasText: new RegExp("^"+k+"$") }).first().click(); await p.waitForSelector(".staff-grid"); } },
  { name: "dash-staff-exit", user: "marie@example.com", path: "/dashboard", wait: ".kpi-row", act: async p => { await p.click(".staff-btn"); await p.waitForSelector(".pin-modal"); for (const k of ["4","8","2","6"]) await p.locator(".pin-key", { hasText: new RegExp("^"+k+"$") }).first().click(); await p.waitForSelector(".staff-grid"); await p.click(".staff-exit-btn:has-text('Quitter')"); await p.waitForSelector(".pin-modal"); for (const k of ["4","8","2","6"]) await p.locator(".pin-key", { hasText: new RegExp("^"+k+"$") }).first().click(); await p.waitForTimeout(600); }, noFull: true },
  { name: "dash-settings", user: "marie@example.com", path: "/dashboard", wait: ".kpi-row", act: nav(7) },
  { name: "dash-team-form", user: "marie@example.com", path: "/dashboard", wait: ".kpi-row", act: async p => { await nav(7)(p); await p.click(".btn-primary:has-text('Membre')"); await p.waitForSelector(".pin-modal"); }, noFull: true },
  { name: "dash-ingredients", user: "marie@example.com", path: "/dashboard", wait: ".kpi-row", act: async p => { await nav(3)(p); await p.click(".mini-tab:has-text('Ingrédients')"); await p.waitForSelector(".tbl"); await p.waitForTimeout(600); } },
  { name: "dash-ing-form", user: "marie@example.com", path: "/dashboard", wait: ".kpi-row", act: async p => { await nav(3)(p); await p.click(".mini-tab:has-text('Ingrédients')"); await p.waitForSelector(".tbl"); await p.click(".btn-primary:has-text('Ingrédient')"); await p.waitForSelector(".pin-modal"); }, noFull: true },
  { name: "dash-ing-restock", user: "marie@example.com", path: "/dashboard", wait: ".kpi-row", act: async p => { await nav(3)(p); await p.click(".mini-tab:has-text('Ingrédients')"); await p.waitForSelector(".tbl"); await p.locator(".pill-btn.primary").first().click(); await p.waitForSelector(".pin-modal"); }, noFull: true },
  { name: "dash-shopping", user: "marie@example.com", path: "/dashboard", wait: ".kpi-row", act: async p => { await nav(3)(p); await p.click(".mini-tab:has-text('Ingrédients')"); await p.click(".filter-chip:has-text('Liste de courses')"); await p.waitForSelector(".tbl"); await p.waitForTimeout(600); } },
  { name: "dash-suppliers", user: "marie@example.com", path: "/dashboard", wait: ".kpi-row", act: async p => { await nav(3)(p); await p.click(".mini-tab:has-text('Ingrédients')"); await p.click(".filter-chip:has-text('Fournisseurs')"); await p.waitForTimeout(600); } },
  { name: "dash-ing-moves", user: "marie@example.com", path: "/dashboard", wait: ".kpi-row", act: async p => { await nav(3)(p); await p.click(".mini-tab:has-text('Ingrédients')"); await p.click(".filter-chip:has-text('Mouvements')"); await p.waitForSelector(".tbl"); await p.waitForTimeout(600); } },
  { name: "dash-menu-recipe", user: "marie@example.com", path: "/dashboard", wait: ".kpi-row", act: async p => { await nav(2)(p); await p.locator(".menu-card", { hasText: "Burger Classic" }).locator(".icon-btn-sm").first().click(); await p.waitForSelector(".menu-modal"); await p.locator("text=Recette — ingrédients").scrollIntoViewIfNeeded(); await p.waitForTimeout(300); }, noFull: true },
  { name: "client-cart-window", user: "jean@example.com", path: "/", act: async p => { await p.waitForSelector(".rest-card-h"); await p.click(".rest-card-h"); await p.waitForSelector(".menu-item"); await p.click(".cat-tab:has-text('Plats')"); await p.locator(".menu-item", { hasText: "Formule midi" }).click(); await p.waitForSelector(".modal-add-btn"); await p.click(".modal-add-btn"); await p.waitForTimeout(400); await p.click(".fab-cart"); await p.waitForSelector("select.fi"); await p.selectOption("select.fi", { label: "18:30" }).catch(() => {}); await p.waitForTimeout(400); }, noFull: true },
  { name: "dash-menu-sched", user: "marie@example.com", path: "/dashboard", wait: ".kpi-row", act: async p => { await nav(2)(p); await p.locator(".menu-card", { hasText: "Formule midi" }).locator(".icon-btn-sm").first().click(); await p.waitForSelector(".menu-modal"); await p.locator("text=Disponibilité (menu du jour").scrollIntoViewIfNeeded(); await p.waitForTimeout(300); }, noFull: true },
  { name: "dash-ticket-receipt", user: "marie@example.com", path: "/dashboard", wait: ".kpi-row", act: async p => { await nav(7)(p); const [pop] = await Promise.all([p.context().waitForEvent("page"), p.click(".pill-btn:has-text('Aperçu ticket client')")]); await pop.waitForLoadState(); await pop.setViewportSize({ width: 340, height: 700 }); await pop.screenshot({ path: `${OUT}/ticket-receipt.png`, fullPage: true }); await pop.close(); }, noFull: true },
  { name: "dash-ticket-kitchen", user: "marie@example.com", path: "/dashboard", wait: ".kpi-row", act: async p => { await nav(7)(p); const [pop] = await Promise.all([p.context().waitForEvent("page"), p.click(".pill-btn:has-text('Aperçu ticket cuisine')")]); await pop.waitForLoadState(); await pop.setViewportSize({ width: 340, height: 600 }); await pop.screenshot({ path: `${OUT}/ticket-kitchen.png`, fullPage: true }); await pop.close(); }, noFull: true },
  { name: "client-home",   user: "jean@example.com",  path: "/", act: async p => { await p.waitForSelector(".rest-card-v"); await p.waitForTimeout(500); } },
  { name: "client-public", user: "jean@example.com",  path: "/", act: async p => { await p.waitForSelector(".rest-card-v"); await p.locator(".rcv-public-btn").last().click(); await p.waitForSelector(".pub-review"); await p.locator(".pub-review").first().scrollIntoViewIfNeeded(); } },
  { name: "client-history", user: "jean@example.com", path: "/", act: async p => { await p.click(".nav-avatar"); await p.waitForTimeout(500); await p.click("text=Mes commandes"); await p.waitForTimeout(900); } },
  { name: "client-reorder", user: "jean@example.com", path: "/", act: async p => { await p.click(".nav-avatar"); await p.waitForTimeout(500); await p.click("text=Mes commandes"); await p.waitForTimeout(900); await p.locator("button:has-text('Commander à nouveau')").first().click(); await p.waitForSelector(".rest-notice", { timeout: 15000 }); await p.waitForTimeout(400); }, noFull: true },
  { name: "client-item-modal", user: "jean@example.com", path: "/", act: async p => { await p.waitForSelector(".rest-card-h"); await p.click(".rest-card-h"); await p.waitForSelector(".menu-item"); await p.click(".cat-tab:has-text('Plats')"); await p.locator(".menu-item", { hasText: "Burger Classic" }).click(); await p.waitForSelector(".item-modal"); }, noFull: true },
  { name: "dash-reviews",  user: "marie@example.com", path: "/dashboard", wait: ".kpi-row", act: async p => { await nav(5)(p); await p.waitForSelector(".tbl"); await p.locator(".pill-btn:has-text('Répondre')").first().click(); await p.waitForTimeout(300); } },
  { name: "client-profile", user: "jean@example.com", path: "/", act: async p => { await p.click(".nav-avatar"); await p.waitForTimeout(1200); }, noFull: true },
  { name: "client-cart-promo", user: "jean@example.com", path: "/", act: async p => { await p.waitForSelector(".rest-card-h"); await p.click(".rest-card-h"); await p.waitForSelector(".menu-item"); await p.click(".cat-tab:has-text('Plats')"); await p.locator(".menu-item", { hasText: "Burger Classic" }).click(); await p.waitForSelector(".modal-add-btn"); await p.click(".modal-add-btn"); await p.waitForTimeout(300); await p.locator(".menu-item", { hasText: "Burger BBQ" }).click(); await p.waitForSelector(".modal-add-btn"); await p.click(".modal-add-btn"); await p.waitForTimeout(300); await p.click(".fab-cart"); await p.waitForSelector("select.fi"); await p.fill("input[placeholder='Ex. BIENVENUE10']", "MIDI5"); await p.click("button:has-text('Appliquer')"); await p.waitForTimeout(700); await p.locator(".cart-summary").scrollIntoViewIfNeeded(); }, noFull: true },
  { name: "dash-marketing", user: "marie@example.com", path: "/dashboard", wait: ".kpi-row", act: async p => { await nav(7)(p); await p.locator("text=Fidélité & codes promo").scrollIntoViewIfNeeded(); await p.waitForTimeout(500); }, noFull: true },
  { name: "login-forgot", user: "jean@example.com", path: "/login", act: async p => { await p.evaluate(() => localStorage.clear()); await p.goto("http://localhost:3000/login"); await p.click("text=Mot de passe oublié"); await p.fill("input[type=email]", "jean@example.com"); await p.click("button:has-text('Envoyer le lien')"); await p.waitForSelector(".info-box"); }, noFull: true },
  { name: "reset-page", user: "jean@example.com", path: "/reset?uid=abc&token=def", act: async p => { await p.waitForSelector(".login-card"); }, noFull: true },
  { name: "client-cart-zone", user: "jean@example.com", path: "/", act: async p => { await p.waitForSelector(".rest-card-h"); await p.click(".rest-card-h"); await p.waitForSelector(".menu-item"); await p.click(".cat-tab:has-text('Plats')"); await p.locator(".menu-item", { hasText: "Burger Classic" }).click(); await p.waitForSelector(".modal-add-btn"); await p.click(".modal-add-btn"); await p.waitForTimeout(300); await p.click(".fab-cart"); await p.waitForSelector(".type-btns"); await p.click(".type-btn:has-text('Livraison')"); await p.fill("input[placeholder='Adresse de livraison complète *']", "Rue du Test 4"); await p.fill("input[placeholder='Code postal *']", "1800"); await p.waitForTimeout(900); await p.locator(".cart-summary").scrollIntoViewIfNeeded(); }, noFull: true },
  { name: "dash-staff-deliv", user: "marie@example.com", path: "/dashboard", wait: ".kpi-row", act: async p => { await p.click(".staff-btn"); await p.waitForSelector(".pin-modal"); for (const k of ["4","8","2","6"]) await p.locator(".pin-key", { hasText: new RegExp("^"+k+"$") }).first().click(); await p.waitForSelector(".staff-grid"); }, noFull: true },
  { name: "client-cart-delivery", user: "jean@example.com", path: "/", act: async p => { await p.waitForSelector(".rest-card-h"); await p.click(".rest-card-h"); await p.waitForSelector(".menu-item"); await p.click(".cat-tab:has-text('Plats')"); await p.locator(".menu-item", { hasText: "Burger Classic" }).click(); await p.waitForSelector(".modal-add-btn"); await p.click(".modal-add-btn"); await p.waitForTimeout(300); await p.click(".fab-cart"); await p.waitForSelector(".type-btns"); await p.click(".type-btn:has-text('Livraison')"); await p.waitForTimeout(400); await p.locator(".type-btns").scrollIntoViewIfNeeded(); }, noFull: true },
  { name: "dash-modes", user: "marie@example.com", path: "/dashboard", wait: ".kpi-row", act: async p => { await nav(7)(p); await p.locator("text=Modes de commande").scrollIntoViewIfNeeded(); await p.waitForTimeout(400); }, noFull: true },
  { name: "client-gallery", user: "jean@example.com", path: "/", act: async p => { await p.waitForSelector(".rest-card-h"); await p.click(".rest-card-h"); await p.waitForSelector(".menu-item"); await p.click("button:has-text('Galerie')"); await p.waitForSelector(".gallery-grid"); await p.waitForTimeout(600); }, noFull: true },
  { name: "client-lightbox", user: "jean@example.com", path: "/", act: async p => { await p.waitForSelector(".rest-card-h"); await p.click(".rest-card-h"); await p.waitForSelector(".menu-item"); await p.click(".cat-tab:has-text('Plats')"); await p.locator(".menu-item", { hasText: "Burger Classic" }).locator(".mi-img").click(); await p.waitForSelector("[role=dialog]"); await p.waitForTimeout(500); }, noFull: true },
  { name: "client-item-carousel", user: "jean@example.com", path: "/", act: async p => { await p.waitForSelector(".rest-card-h"); await p.click(".rest-card-h"); await p.waitForSelector(".menu-item"); await p.click(".cat-tab:has-text('Plats')"); await p.locator(".menu-item", { hasText: "Burger Classic" }).locator(".mi-info").click(); await p.waitForSelector(".item-modal"); await p.waitForTimeout(400); }, noFull: true },
  { name: "dash-menu-photos", user: "marie@example.com", path: "/dashboard", wait: ".kpi-row", act: async p => { await nav(2)(p); await p.locator(".menu-card", { hasText: "Burger Classic" }).locator(".icon-btn-sm").first().click(); await p.waitForSelector(".menu-modal"); await p.waitForTimeout(400); }, noFull: true },
  { name: "client-public-gallery", user: "jean@example.com", path: "/", act: async p => { await p.waitForSelector(".rest-card-v"); await p.locator(".rcv-public-btn").last().click(); await p.waitForSelector(".place-strip"); await p.waitForTimeout(500); }, noFull: true },
  { name: "client-gallery-lieu", user: "jean@example.com", path: "/", act: async p => { await p.waitForSelector(".rest-card-h"); await p.click(".rest-card-h"); await p.waitForSelector(".menu-item"); await p.click("button:has-text('Galerie')"); await p.waitForSelector(".gallery-grid"); await p.waitForTimeout(500); }, noFull: true },
  { name: "dash-place-gallery", user: "marie@example.com", path: "/dashboard", wait: ".kpi-row", act: async p => { await nav(7)(p); await p.locator("text=Photos du restaurant").scrollIntoViewIfNeeded(); await p.waitForTimeout(500); }, noFull: true },
  { name: "client-menu",   user: "jean@example.com",  path: "/", act: async p => { await p.waitForSelector(".rest-card-h"); await p.click(".rest-card-h"); await p.waitForSelector(".menu-item"); await p.click(".cat-tab >> nth=1"); await p.waitForTimeout(400); } },
  { name: "admin-home",    user: "admin@example.com", path: "/admin", wait: ".sb-item", act: async p => { await p.waitForTimeout(1200); } },
  { name: "admin-restos",  user: "admin@example.com", path: "/admin", wait: ".sb-item", act: async p => { await nav(1)(p); await p.waitForTimeout(600); } },
  { name: "admin-resto-detail", user: "admin@example.com", path: "/admin", wait: ".sb-item", act: async p => { await nav(1)(p); await p.waitForTimeout(600); await p.locator("tbody tr, .rc-card, .resto-row").first().click(); await p.waitForTimeout(700); }, noFull: true },
  { name: "admin-users",   user: "admin@example.com", path: "/admin", wait: ".sb-item", act: async p => { await nav(2)(p); await p.waitForTimeout(600); } },
  { name: "admin-reports", user: "admin@example.com", path: "/admin", wait: ".sb-item", act: async p => { await nav(3)(p); await p.waitForTimeout(600); } },
  { name: "admin-contracts", user: "admin@example.com", path: "/admin", wait: ".sb-item", act: async p => { await nav(4)(p); await p.waitForTimeout(600); } },
  { name: "admin-stats",   user: "admin@example.com", path: "/admin", wait: ".sb-item", act: async p => { await nav(5)(p); await p.waitForTimeout(600); } },
  { name: "admin-settings", user: "admin@example.com", path: "/admin", wait: ".sb-item", act: async p => { await nav(6)(p); await p.waitForTimeout(600); } },
  { name: "login-page",    user: "jean@example.com", path: "/login", act: async p => { await p.evaluate(() => localStorage.clear()); await p.goto("http://localhost:3000/login"); await p.waitForSelector(".login-card"); }, noFull: true },
  { name: "login-register", user: "jean@example.com", path: "/login", act: async p => { await p.evaluate(() => localStorage.clear()); await p.goto("http://localhost:3000/login"); await p.click("text=Créer un compte"); await p.waitForTimeout(400); }, noFull: true },
  { name: "login-register-resto", user: "jean@example.com", path: "/login", act: async p => { await p.evaluate(() => localStorage.clear()); await p.goto("http://localhost:3000/login"); await p.click("text=Créer un compte"); await p.waitForTimeout(300); await p.click("text=Restaurateur"); await p.waitForTimeout(400); }, noFull: true },
  { name: "client-search", user: "jean@example.com", path: "/", act: async p => { await p.click(".nav-search"); await p.waitForTimeout(500); }, noFull: true },
  { name: "client-confirm", user: "jean@example.com", path: "/", act: async p => { await p.waitForSelector(".rest-card-h"); await p.click(".rest-card-h"); await p.waitForSelector(".menu-item"); await p.click(".cat-tab:has-text('Plats')"); await p.locator(".menu-item", { hasText: "Burger Classic" }).click(); await p.waitForSelector(".modal-add-btn"); await p.click(".modal-add-btn"); await p.waitForTimeout(300); await p.click(".fab-cart"); await p.waitForSelector("select.fi"); await p.locator("button.order-btn").first().click(); await p.waitForSelector(".confirm-home-btn, .order-steps, .confirm-page", { timeout: 15000 }); await p.waitForTimeout(600); }, noFull: true },
  { name: "dash-order-detail", user: "marie@example.com", path: "/dashboard", wait: ".kpi-row", act: async p => { await nav(1)(p); await p.locator(".order-card, .oc").first().click(); await p.waitForTimeout(600); }, noFull: true },
  { name: "dash-stock-moves", user: "marie@example.com", path: "/dashboard", wait: ".kpi-row", act: async p => { await nav(3)(p); await p.locator("text=Mouvements de stock").scrollIntoViewIfNeeded(); await p.waitForTimeout(600); } },
];
const only = process.env.ONLY ? process.env.ONLY.split(",") : null;
const SKIP = (process.env.SKIP || "client-cart-window").split(",");
const ANALYZE = () => {
  const vw = window.innerWidth;
  const vis = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && cs.display !== "none" && cs.opacity !== "0"; };
  const inScroller = (el) => { for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) { const o = getComputedStyle(a).overflowX; if (o === "auto" || o === "scroll") return true; } return false; };
  const desc = (el) => `${el.tagName.toLowerCase()}${el.className && typeof el.className === "string" ? "." + el.className.trim().split(/\s+/).slice(0, 2).join(".") : ""}${el.textContent ? " «" + el.textContent.trim().slice(0, 25).replace(/\s+/g, " ") + "»" : ""}`;
  const overflowers = [], smallTaps = [], smallInputs = [];
  const seen = new Set();
  for (const el of document.querySelectorAll("body *")) {
    if (!vis(el)) continue;
    const r = el.getBoundingClientRect();
    if ((r.right > vw + 1 || r.left < -1) && !inScroller(el) && getComputedStyle(el).position !== "fixed") {
      // ne garde que l'élément le plus haut de chaque chaîne (pas ses descendants)
      let dup = false; for (let a = el.parentElement; a; a = a.parentElement) if (seen.has(a)) { dup = true; break; }
      if (!dup) { seen.add(el); overflowers.push(`${desc(el)} [${Math.round(r.left)}→${Math.round(r.right)}]`); }
    }
    if (el.matches("button, a[href], [role=button], input[type=checkbox], input[type=radio], select") && (r.width < 32 || r.height < 32) && !el.closest("[role=dialog] .lb-btn")) smallTaps.push(`${desc(el)} ${Math.round(r.width)}×${Math.round(r.height)}`);
    if (el.matches("input:not([type=checkbox]):not([type=radio]):not([type=file]):not([type=range]), select, textarea")) { const fs = parseFloat(getComputedStyle(el).fontSize); if (fs < 16) smallInputs.push(`${desc(el)} ${fs}px`); }
  }
  const sw = Math.max(document.documentElement.scrollWidth, document.body.scrollWidth);
  return { vw, sw, overflow: sw > vw + 1, overflowers: overflowers.slice(0, 8), smallTaps: smallTaps.slice(0, 8), nSmallTaps: smallTaps.length, smallInputs: smallInputs.slice(0, 6), nSmallInputs: smallInputs.length };
};
(async () => {
  const tokens = {};
  for (const e of ["marie@example.com", "jean@example.com", "admin@example.com"]) tokens[e] = await login(e);
  const browser = await chromium.launch();
  const report = {};
  const lines = [];
  for (const dname of SEL) {
    const d = DEVICES[dname];
    for (const sc of SCEN) {
      if (only && !only.includes(sc.name)) continue;
      if (!only && SKIP.includes(sc.name)) continue;
      const ctx = await browser.newContext({ viewport: { width: d.w, height: d.h }, isMobile: d.mobile, hasTouch: d.mobile, deviceScaleFactor: d.dsf });
      const page = await ctx.newPage();
      // Pas de réseau externe dans cet environnement : les polices Google bloqueraient l'événement "load" pendant 30 s
      await page.route(/fonts\.(googleapis|gstatic)\.com|images\.unsplash\.com/, r => r.abort());
      const errors = [];
      page.on("pageerror", e => errors.push(e.message));
      page.on("console", m => { if (m.type() === "error" && !/favicon|ERR_CERT|ERR_FAILED|WebSocket|ws:\/\/|fonts\.g|unsplash/.test(m.text())) errors.push("console: " + m.text().slice(0, 120)); });
      const t = tokens[sc.user];
      await page.addInitScript(({ t }) => { localStorage.clear(); localStorage.setItem("user", JSON.stringify(t.user)); localStorage.setItem("access", t.access); localStorage.setItem("refresh", t.refresh); sessionStorage.setItem("pickeatgo_view_client", "1"); }, { t });
      const key = `${dname}/${sc.name}`;
      try {
        await page.goto("http://localhost:3000" + sc.path, { waitUntil: "load", timeout: 60000 });
        if (sc.wait) await page.waitForSelector(sc.wait, { timeout: 20000 }); else await page.waitForTimeout(800);
        if (sc.act) await sc.act(page);
        await page.waitForTimeout(400);
        const a = await page.evaluate(ANALYZE);
        a.errors = errors;
        report[key] = a;
        if (process.env.SHOTS !== "0") await page.screenshot({ path: `${OUT}/${dname}-${sc.name}.png`, fullPage: false });
        const flags = [a.overflow ? `OVERFLOW ${a.sw}>${a.vw}` : "", a.overflowers.length ? `out:${a.overflowers.length}` : "", d.mobile && a.nSmallInputs ? `inp<16:${a.nSmallInputs}` : "", d.mobile && a.nSmallTaps ? `tap<32:${a.nSmallTaps}` : "", errors.length ? "ERR" : ""].filter(Boolean).join(" ");
        lines.push(`${flags ? "!!" : "ok"} ${key.padEnd(34)} ${flags}`);
      } catch (e) {
        report[key] = { fail: e.message.split("\n")[0].slice(0, 160), errors };
        await page.screenshot({ path: `${OUT}/${dname}-${sc.name}-FAIL.png` }).catch(() => {});
        lines.push(`FAIL ${key.padEnd(32)} ${e.message.split("\n")[0].slice(0, 100)}`);
      }
      await ctx.close();
    }
  }
  await browser.close();
  fs.writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 1));
  console.log(lines.join("\n"));
})();
