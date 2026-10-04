"use client";
/**
 * dashboard/management.jsx — outils de gestion du restaurateur :
 * ventes (journal, synthèse, export, clôture), stocks (alertes, mouvements),
 * encaissement au comptoir, centre de notifications.
 */
import { Fragment, useState, useEffect, useCallback, useMemo } from "react";
import { get, post, patch, downloadFile, money, qty, todayISO, shiftISO, fmtDate, fmtDateTime,
         Ic, PAYMENT_LABELS, REASON_LABELS, REASON_COLORS } from "./shared";
import { IngredientsPage } from "./ingredients";

// ─── Graphique à barres (activité par période) ───────────────────────────────
export function ActivityChart({ periods, metric = "orders", height = 110, highlightLast = true }) {
  const vals = periods.map(p => parseFloat(p[metric] || 0));
  const max  = Math.max(...vals, 1);
  if (periods.length === 0) return <div className="empty-msg">Aucune donnée sur la période</div>;
  return (
    <div className="bar-chart" style={{ height }}>
      {periods.map((p, i) => (
        <div key={p.key || p.date || i} className="bar-col" title={`${p.label} : ${p.orders} vente(s), ${money(p.revenue)}`}>
          <span className="bar-val">{metric === "revenue" ? `${Math.round(vals[i])}€` : vals[i]}</span>
          <div className={`bar ${highlightLast && i === periods.length - 1 ? "hi" : ""}`} style={{ height: `${Math.max(2, (vals[i] / max) * (height - 40))}px` }} />
          <span className="bar-lbl">{p.label}</span>
        </div>
      ))}
    </div>
  );
}

// ─── Choix du mode de paiement à la remise d'une commande ────────────────────
export function PaymentChooser({ onPick, onCancel, saving }) {
  return (
    <div className="pay-inline">
      <span style={{ fontSize: 12, fontWeight: 700, color: "var(--text-soft)" }}>Payé en :</span>
      <button className="pill-btn primary" disabled={saving} onClick={() => onPick("especes")}>💵 Espèces</button>
      <button className="pill-btn primary" disabled={saving} onClick={() => onPick("carte")}>💳 Carte</button>
      <button className="pill-btn" disabled={saving} onClick={() => onPick("")}>Ne pas préciser</button>
      <button className="pill-btn" onClick={onCancel}>Annuler</button>
    </div>
  );
}

// ─── Centre de notifications (cloche) ────────────────────────────────────────
export function NotificationsPanel({ newOrders, alerts, ingredientAlerts = { out: [], low: [] }, onGo, onClose }) {
  const items = [
    ...newOrders.map(o => ({ key: `o${o.id}`, color: "#3B82F6", page: "orders",
      title: `Nouvelle commande #${o.number}`, sub: `${o.client_name || "Client"} · ${money(o.total_price)} · retrait ${String(o.pickup_slot || "").slice(0, 5)}` })),
    ...alerts.out.map(i => ({ key: `out${i.id}`, color: "#EF4444", page: "stock", title: `${i.name} — épuisé`,
      sub: i.limited_by && i.portions_available === 0 ? `Retiré de la carte : plus de ${i.limited_by}.` : "Retiré de la carte. Réapprovisionnez pour le remettre." })),
    ...alerts.low.map(i => ({ key: `low${i.id}`, color: "#F59E0B", page: "stock", title: `${i.name} — plus que ${i.effective_stock ?? i.stock_qty}`,
      sub: i.limited_by && i.portions_available === i.effective_stock ? `Limité par ${i.limited_by}` : `Seuil d'alerte : ${i.low_stock_threshold}` })),
    ...ingredientAlerts.out.map(i => ({ key: `iout${i.id}`, color: "#EF4444", page: "stock", title: `${i.name} — ingrédient épuisé`, sub: i.used_by?.length ? `Bloque : ${i.used_by.map(u => u.name).join(", ")}` : "À commander." })),
    ...ingredientAlerts.low.map(i => ({ key: `ilow${i.id}`, color: "#F59E0B", page: "stock", title: `${i.name} — reste ${qty(i.stock_qty, i.unit)}`, sub: "Ingrédient sous le seuil : ajouté à la liste de courses." })),
  ];
  return (
    <div className="notif-panel">
      <div className="notif-head">Notifications <button className="icon-btn-sm" onClick={onClose}><Ic n="x" s={12} c="#64748B" /></button></div>
      {items.length === 0 && <div className="empty-msg" style={{ padding: 22 }}>Tout est en ordre 👌</div>}
      {items.map(n => (
        <div key={n.key} className="notif-item" onClick={() => { onGo(n.page); onClose(); }}>
          <span className="notif-dot" style={{ background: n.color }} />
          <div><p style={{ fontWeight: 700 }}>{n.title}</p><p style={{ color: "var(--text-soft)", fontSize: 12, marginTop: 2 }}>{n.sub}</p></div>
        </div>
      ))}
    </div>
  );
}

// ─── Encaissement au comptoir ────────────────────────────────────────────────
export function CounterSaleModal({ restaurant, menu, employee = null, onClose, onSaved, showToast }) {
  const [cart, setCart]       = useState({});
  const [payment, setPayment] = useState("especes");
  const [note, setNote]       = useState("");
  const [search, setSearch]   = useState("");
  const [saving, setSaving]   = useState(false);
  const [promo, setPromo]     = useState("");
  const [promoInfo, setPromoInfo] = useState(null);   // { code, label, discount } | { error }

  const groups = useMemo(() => {
    const q = search.trim().toLowerCase();
    const byCat = {};
    menu.filter(i => !q || i.name.toLowerCase().includes(q)).forEach(i => {
      (byCat[i.category_name || "Menu"] ||= []).push(i);
    });
    return Object.entries(byCat);
  }, [menu, search]);

  const lines = Object.entries(cart).filter(([, q]) => q > 0).map(([id, qty]) => ({ item: menu.find(i => i.id === id), qty })).filter(l => l.item);
  const total = lines.reduce((s, l) => s + parseFloat(l.item.price) * l.qty, 0);
  useEffect(() => { setPromoInfo(p => (p?.code ? null : p)); }, [total]);   // le panier a changé : la remise doit être revérifiée
  const maxQty = (item) => item.track_stock ? item.stock_qty : 99;
  const change = (item, d) => setCart(c => {
    const next = Math.max(0, Math.min(maxQty(item), (c[item.id] || 0) + d));
    return { ...c, [item.id]: next };
  });

  const submit = async () => {
    if (lines.length === 0) { showToast("Ajoutez au moins un article", "error"); return; }
    setSaving(true);
    try {
      const order = await post("/orders/counter/", {
        restaurant: restaurant.id, payment_method: payment, note, employee: employee?.id || null, promo_code: promoInfo?.code || "",
        items: lines.map(l => ({ menu_item_id: l.item.id, qty: l.qty })),
      });
      showToast(`Vente de ${money(order.total_price)} encaissée ✓`);
      onSaved(order);
    } catch (e) { showToast(e.message, "error"); }
    finally { setSaving(false); }
  };

  return (
    <div className="modal-ov" onClick={onClose}>
      <div className="menu-modal counter-modal" onClick={e => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <h3 style={{ fontFamily: "'Sora',sans-serif", fontSize: 18, fontWeight: 800 }}>🧾 Vente au comptoir</h3>
          <button className="icon-btn" onClick={onClose}><Ic n="x" s={18} c="#64748B" /></button>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, background: "var(--bg)", border: "1.5px solid var(--border)", borderRadius: 10, padding: "8px 12px", marginBottom: 10 }}>
          <Ic n="search" s={15} c="#94A3B8" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Chercher un plat…" style={{ border: "none", outline: "none", background: "transparent", flex: 1, fontSize: 14, fontFamily: "inherit" }} />
        </div>
        <div className="counter-list">
          {groups.length === 0 && <div className="empty-msg">Aucun plat</div>}
          {groups.map(([cat, items]) => (
            <div key={cat}>
              <div className="counter-cat">{cat}</div>
              {items.map(item => {
                const soldOut = item.is_out_of_stock;
                const qty = cart[item.id] || 0;
                return (
                  <div key={item.id} className={`counter-item ${soldOut ? "disabled" : ""} ${qty > 0 ? "in-cart" : ""}`}
                       onClick={() => !soldOut && change(item, +1)}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p className="counter-name">{item.name}{!item.is_available && !soldOut && <span className="stock-badge none" style={{ marginLeft: 6 }}>hors carte</span>}</p>
                      <p className="counter-price">{money(item.price)}{item.track_stock && <span style={{ marginLeft: 8, color: soldOut ? "#DC2626" : item.is_low_stock ? "#B45309" : "#64748B" }}>· {soldOut ? "épuisé" : `${item.stock_qty} en stock`}</span>}</p>
                    </div>
                    {!soldOut && (
                      <div className="stepper" onClick={e => e.stopPropagation()}>
                        <button onClick={() => change(item, -1)} aria-label="Retirer"><Ic n="minus" s={13} c="#64748B" /></button>
                        <span>{qty}</span>
                        <button onClick={() => change(item, +1)} aria-label="Ajouter"><Ic n="plus" s={13} c="#64748B" /></button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>

        {lines.length > 0 && (
          <div style={{ marginTop: 12, fontSize: 13, color: "var(--text-soft)" }}>
            {lines.map(l => <div key={l.item.id} style={{ display: "flex", justifyContent: "space-between", padding: "3px 0" }}><span>{l.qty}× {l.item.name}</span><span>{money(parseFloat(l.item.price) * l.qty)}</span></div>)}
          </div>
        )}
        <div className="counter-total"><span>Total</span><span style={{ color: "var(--primary)" }}>{money(total)}</span></div>
        <div className="pay-row">
          <button className={`pay-btn ${payment === "especes" ? "active" : ""}`} onClick={() => setPayment("especes")}><Ic n="cash" s={18} /> Espèces</button>
          <button className={`pay-btn ${payment === "carte" ? "active" : ""}`} onClick={() => setPayment("carte")}><Ic n="card" s={18} /> Carte</button>
        </div>
        <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
          <input className="fi" placeholder="Code promo (optionnel)" value={promo} onChange={e => { setPromo(e.target.value.toUpperCase()); setPromoInfo(null); }} style={{ flex: 1, textTransform: "uppercase" }} />
          <button className="pill-btn" disabled={!promo || total <= 0} onClick={async () => {
            try { const r = await post("/orders/promo/check/", { restaurant: restaurant.id, code: promo, subtotal: total }); setPromoInfo(r); }
            catch (e) { setPromoInfo({ error: e.message }); }
          }}>Appliquer</button>
        </div>
        {promoInfo?.error && <p style={{ fontSize: 12, color: "#DC2626", marginTop: 4 }}>{promoInfo.error}</p>}
        {promoInfo?.code && <p style={{ fontSize: 12, color: "#15803D", marginTop: 4, fontWeight: 700 }}>Code {promoInfo.code} ({promoInfo.label}) : −{money(promoInfo.discount)} → à encaisser {money(promoInfo.total)}</p>}
        <input className="fi" style={{ marginTop: 10 }} placeholder="Note (optionnel)" value={note} onChange={e => setNote(e.target.value)} />
        <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
          <button className="btn-secondary" style={{ flex: 1 }} onClick={onClose}>Annuler</button>
          <button className="btn-primary" style={{ flex: 2, justifyContent: "center", opacity: saving ? .7 : 1 }} disabled={saving || lines.length === 0} onClick={submit}>
            {saving ? "Encaissement…" : <><Ic n="check" s={15} c="white" /> Encaisser {money(promoInfo?.code ? promoInfo.total : total)}</>}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Page VENTES ─────────────────────────────────────────────────────────────
const PRESETS = [["today", "Aujourd'hui"], ["7", "7 jours"], ["30", "30 jours"], ["month", "Ce mois"], ["custom", "Personnalisé"]];

export function SalesPage({ restaurant, showToast, refreshKey = 0 }) {
  const [preset, setPreset] = useState("7");
  const [from, setFrom]     = useState(shiftISO(-6));
  const [to, setTo]         = useState(todayISO());
  const [group, setGroup]   = useState("day");
  const [metric, setMetric] = useState("revenue");
  const [data, setData]     = useState(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [closures, setClosures] = useState([]);
  const [preview, setPreview]   = useState(null);
  const [closureNote, setClosureNote] = useState("");
  const [closing, setClosing]   = useState(false);
  const [openClosure, setOpenClosure] = useState(null);

  const applyPreset = (p) => {
    setPreset(p);
    const t = todayISO();
    if (p === "today") { setFrom(t); setTo(t); setGroup("day"); }
    if (p === "7")     { setFrom(shiftISO(-6)); setTo(t); setGroup("day"); }
    if (p === "30")    { setFrom(shiftISO(-29)); setTo(t); setGroup("day"); }
    if (p === "month") { setFrom(t.slice(0, 8) + "01"); setTo(t); setGroup("day"); }
  };

  const load = useCallback(async () => {
    if (!restaurant) return;
    setLoading(true);
    try { setData(await get(`/orders/sales/?restaurant=${restaurant.id}&from=${from}&to=${to}&group=${group}`)); }
    catch (e) { showToast(e.message, "error"); }
    finally { setLoading(false); }
  }, [restaurant, from, to, group, showToast]);
  useEffect(() => { load(); }, [load, refreshKey]);

  const closureDate = from === to ? to : todayISO();
  const loadClosures = useCallback(async () => {
    if (!restaurant) return;
    try {
      const [list, prev] = await Promise.all([
        get(`/orders/closures/?restaurant=${restaurant.id}`),
        get(`/orders/closures/preview/?restaurant=${restaurant.id}&date=${closureDate}`),
      ]);
      setClosures(list.results || []); setPreview(prev);
    } catch {}
  }, [restaurant, closureDate]);
  useEffect(() => { loadClosures(); }, [loadClosures, refreshKey]);

  const doExport = async (type) => {
    setExporting(true);
    try { await downloadFile(`/orders/sales/export/?restaurant=${restaurant.id}&from=${from}&to=${to}&type=${type}`, `ventes-${from}-${to}.${type}`); }
    catch (e) { showToast(e.message, "error"); }
    finally { setExporting(false); }
  };

  const closeDay = async () => {
    if (!confirm(`Clôturer la journée du ${fmtDate(closureDate)} ? Les totaux seront figés.`)) return;
    setClosing(true);
    try { await post("/orders/closures/", { restaurant: restaurant.id, date: closureDate, note: closureNote }); showToast("Journée clôturée ✓"); setClosureNote(""); loadClosures(); }
    catch (e) { showToast(e.message, "error"); }
    finally { setClosing(false); }
  };

  const t = data?.totals;
  const maxHour = Math.max(...(data?.by_hour || [0]), 1);
  const revenue = parseFloat(t?.revenue || 0);

  return (
    <div className="fade-in">
      <div className="filter-row" style={{ alignItems: "center" }}>
        {PRESETS.map(([v, l]) => <button key={v} className={`filter-chip ${preset === v ? "active" : ""}`} onClick={() => applyPreset(v)}>{l}</button>)}
        {preset === "custom" && (
          <>
            <input type="date" className="fi" style={{ width: "auto" }} value={from} max={to} onChange={e => setFrom(e.target.value)} />
            <span style={{ color: "var(--text-soft)" }}>→</span>
            <input type="date" className="fi" style={{ width: "auto" }} value={to} min={from} max={todayISO()} onChange={e => setTo(e.target.value)} />
          </>
        )}
        <select className="fi" style={{ width: "auto" }} value={group} onChange={e => setGroup(e.target.value)}>
          <option value="day">Par jour</option><option value="week">Par semaine</option><option value="month">Par mois</option>
        </select>
        <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
          <button className="pill-btn" disabled={exporting} onClick={() => doExport("csv")}><Ic n="download" s={13} /> CSV</button>
          <button className="pill-btn" disabled={exporting} onClick={() => doExport("xlsx")}><Ic n="download" s={13} /> Excel</button>
        </div>
      </div>

      {loading && !data ? <div className="empty-msg">Chargement…</div> : data && (
        <>
          <div className="kpi-row">
            {[
              { label: "Chiffre d'affaires", v: money(t.revenue), sub: `${t.items_sold} article(s) vendu(s)`, color: "#10B981", icon: "euro", delta: data.previous?.delta?.revenue },
              { label: "Ventes", v: t.orders, sub: `${t.online_orders} en ligne · ${t.counter_orders} comptoir`, color: "#FF6B2C", icon: "sales", delta: data.previous?.delta?.orders },
              { label: "Panier moyen", v: money(t.avg_basket), sub: t.cancelled_orders ? `${t.cancelled_orders} annulée(s)` : "Aucune annulation", color: "#6366F1", icon: "orders", delta: data.previous?.delta?.avg_basket },
              { label: "Pertes / invendus", v: t.waste_count, sub: parseFloat(t.waste_value) > 0 ? `${money(t.waste_value)} de coût matière` : "Pas de perte déclarée", color: "#EF4444", icon: "warning" },
            ].map((k, i) => (
              <div key={i} className="kpi-card">
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                  <div><p className="kpi-label">{k.label}</p><p className="kpi-val" style={{ fontSize: 22 }}>{k.v}</p><p className="kpi-sub">{k.sub}</p>
                    {k.delta != null && <p style={{ fontSize: 11, fontWeight: 800, marginTop: 4, color: k.delta >= 0 ? "#15803D" : "#DC2626" }}>{k.delta >= 0 ? "▲ +" : "▼ "}{k.delta} % <span style={{ color: "#94A3B8", fontWeight: 600 }}>vs période précédente</span></p>}
                    {k.delta === null && data.previous && i < 3 && <p style={{ fontSize: 11, color: "#94A3B8", marginTop: 4 }}>Pas de vente sur la période précédente</p>}</div>
                  <div style={{ width: 40, height: 40, borderRadius: 12, background: k.color + "18", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}><Ic n={k.icon} s={18} c={k.color} /></div>
                </div>
              </div>
            ))}
          </div>
          {(t.best_period || t.best_hour != null || parseFloat(t.discounts) > 0) && (
            <div className="alert-banner" style={{ background: "#F0FDF4", borderColor: "#BBF7D0", color: "#166534", cursor: "default" }}>
              <Ic n="stats" s={16} />
              {t.best_period && <span>Meilleur {group === "day" ? "jour" : group === "week" ? "semaine" : "mois"} : <strong>{t.best_period.label}</strong> ({money(t.best_period.revenue)}, {t.best_period.orders} vente(s)).</span>}
              {t.best_hour != null && <span>Heure la plus chargée : <strong>{t.best_hour}h</strong>.</span>}
              {parseFloat(t.discounts) > 0 && <span>Remises accordées : <strong>{money(t.discounts)}</strong> sur {t.discounted_orders} commande(s).</span>}
              {data.previous && <span style={{ color: "#4D7C0F", fontWeight: 500 }}>Période précédente ({fmtDate(data.previous.from)} → {fmtDate(data.previous.to)}) : {money(data.previous.revenue)}, {data.previous.orders} vente(s).</span>}
            </div>
          )}

          <div className="card" style={{ marginBottom: 16 }}>
            <div className="card-hd"><h3 className="card-title">Évolution des ventes</h3>
              <div style={{ display: "flex", gap: 4, background: "var(--bg)", borderRadius: 8, padding: 4 }}>
                {[["revenue", "CA"], ["orders", "Ventes"]].map(([m, l]) => <button key={m} className={`mini-tab ${metric === m ? "active" : ""}`} onClick={() => setMetric(m)}>{l}</button>)}
              </div>
            </div>
            <div className="tbl-wrap"><div style={{ minWidth: Math.max(320, data.periods.length * 34) }}><ActivityChart periods={data.periods} metric={metric} highlightLast={false} /></div></div>
          </div>

          <div className="grid2" style={{ marginBottom: 16 }}>
            <div className="card">
              <div className="card-hd"><h3 className="card-title">Modes de paiement</h3></div>
              {data.by_payment.length === 0 && <div className="empty-msg">Aucune vente</div>}
              {data.by_payment.map(p => (
                <div key={p.key ?? "none"} className="closure-row" style={{ flexWrap: "wrap" }}>
                  <span>{PAYMENT_LABELS[p.key ?? ""] || p.label} <span style={{ color: "var(--text-soft)" }}>· {p.orders} vente(s)</span></span>
                  <span style={{ fontWeight: 700, whiteSpace: "nowrap" }}>{money(p.revenue)} <span style={{ color: "var(--text-soft)", fontWeight: 500 }}>· {revenue ? Math.round(parseFloat(p.revenue) / revenue * 100) : 0} %</span></span>
                </div>
              ))}
            </div>
            {data.by_employee?.length > 0 && (
              <div className="card">
                <div className="card-hd"><h3 className="card-title">Ventes par membre de l'équipe</h3></div>
                {data.by_employee.map(e => (
                  <div key={e.key} className="closure-row" style={{ flexWrap: "wrap" }}>
                    <span>👤 {e.name} <span style={{ color: "var(--text-soft)" }}>· {e.orders} vente(s)</span></span>
                    <span style={{ fontWeight: 700, whiteSpace: "nowrap" }}>{money(e.revenue)} <span style={{ color: "var(--text-soft)", fontWeight: 500 }}>· {revenue ? Math.round(parseFloat(e.revenue) / revenue * 100) : 0} %</span></span>
                  </div>
                ))}
              </div>
            )}
            <div className="card">
              <div className="card-hd"><h3 className="card-title">Heures d'affluence</h3></div>
              <div className="bar-chart" style={{ height: 90 }}>
                {data.by_hour.map((v, h) => (h >= 7 && h <= 23) && (
                  <div key={h} className="bar-col" title={`${h}h : ${v} vente(s)`}>
                    <div className={`bar ${v === maxHour && v > 0 ? "hi" : ""}`} style={{ height: `${Math.max(2, v / maxHour * 60)}px` }} />
                    <span className="bar-lbl">{h % 2 ? `${h}h` : ""}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="card" style={{ marginBottom: 16 }}>
            <div className="card-hd"><h3 className="card-title">Produits vendus</h3><span style={{ fontSize: 12, color: "var(--text-soft)" }}>{data.by_product.length} produit(s)</span></div>
            {data.by_product.length === 0 ? <div className="empty-msg">Aucune vente sur la période</div> : (
              <div className="tbl-wrap"><table className="tbl">
                <thead><tr><th>Produit</th><th className="num">Qté</th><th className="num">CA</th><th className="num">% CA</th><th className="num">Coût</th><th className="num">Marge</th></tr></thead>
                <tbody>{data.by_product.map((p, i) => (
                  <tr key={p.menu_item_id || p.name}>
                    <td><span style={{ color: "#94A3B8", fontWeight: 800, marginRight: 8 }}>#{i + 1}</span>{p.name}</td>
                    <td className="num" style={{ fontWeight: 700 }}>{p.qty}</td>
                    <td className="num">{money(p.revenue)}</td>
                    <td className="num">{revenue ? Math.round(parseFloat(p.revenue) / revenue * 100) : 0} %</td>
                    <td className="num" style={{ color: "var(--text-soft)" }}>{p.cost != null ? money(p.cost) : "—"}</td>
                    <td className="num" style={{ fontWeight: 700, color: p.margin != null ? (parseFloat(p.margin) >= 0 ? "#15803D" : "#DC2626") : "var(--text-soft)" }}>{p.margin != null ? money(p.margin) : "—"}</td>
                  </tr>
                ))}</tbody>
              </table></div>
            )}
            {data.by_product.some(p => p.margin == null) && <p style={{ fontSize: 11, color: "#94A3B8", marginTop: 8 }}>Renseignez le prix de revient des plats (Menu → modifier) pour voir leur marge.</p>}
          </div>
        </>
      )}

      {/* ── Clôture de journée ── */}
      <div className="grid2">
        <div className="card">
          <div className="card-hd"><h3 className="card-title">🔒 Clôture du {fmtDate(closureDate)}</h3>
            {preview?.already_closed && <span className="stock-badge ok">Clôturée</span>}
          </div>
          {!preview ? <div className="empty-msg">Chargement…</div> : (
            <>
              {[["Ventes", preview.orders_count], ["Articles", preview.items_count], ["Espèces", money(preview.total_cash)], ["Carte", money(preview.total_card)],
                ["En ligne", money(preview.total_online)], ["Non renseigné", money(preview.total_unspecified)], ["Pertes", `${preview.waste_count} (${money(preview.waste_value)})`]]
                .map(([l, v]) => <div key={l} className="closure-row"><span style={{ color: "var(--text-soft)" }}>{l}</span><span style={{ fontWeight: 700 }}>{v}</span></div>)}
              <div className="closure-row" style={{ fontFamily: "'Sora',sans-serif", fontSize: 16 }}><span>Total</span><span style={{ fontWeight: 800, color: "var(--primary)" }}>{money(preview.total)}</span></div>
              {!preview.already_closed && (
                <>
                  <input className="fi" style={{ marginTop: 12 }} placeholder="Remarque (fond de caisse, incident…)" value={closureNote} onChange={e => setClosureNote(e.target.value)} />
                  <button className="btn-primary" style={{ width: "100%", justifyContent: "center", marginTop: 10, opacity: closing ? .7 : 1 }} disabled={closing} onClick={closeDay}>
                    <Ic n="lock" s={14} c="white" /> {closing ? "Clôture…" : "Clôturer la journée"}
                  </button>
                  <p style={{ fontSize: 11, color: "#94A3B8", marginTop: 8 }}>Les totaux sont figés à la clôture : c'est votre référence comptable du jour. Pour clôturer une autre date, sélectionnez-la en période personnalisée (même jour de début et de fin).</p>
                </>
              )}
            </>
          )}
        </div>
        <div className="card">
          <div className="card-hd"><h3 className="card-title">Historique des clôtures</h3></div>
          {closures.length === 0 && <div className="empty-msg">Aucune clôture enregistrée</div>}
          {closures.slice(0, 12).map(c => (
            <div key={c.id}>
              <div className="closure-hist" onClick={() => setOpenClosure(openClosure === c.id ? null : c.id)}>
                <span style={{ fontWeight: 700, minWidth: 70 }}>{fmtDate(c.date)}</span>
                <span style={{ color: "var(--text-soft)", flex: 1 }}>{c.orders_count} vente(s) · 💵 {money(c.total_cash)} · 💳 {money(c.total_card)}</span>
                <span style={{ fontWeight: 800 }}>{money(c.total)}</span>
              </div>
              {openClosure === c.id && (
                <div style={{ padding: "4px 12px 12px", fontSize: 12, color: "var(--text-soft)" }}>
                  <p>Clôturé par {c.closed_by_name || "—"} · {fmtDateTime(c.created_at)}{c.note && <> · « {c.note} »</>}</p>
                  {c.items_summary.map(s => <div key={s.name} className="closure-row"><span>{s.qty}× {s.name}</span><span>{money(s.revenue)}</span></div>)}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Page STOCKS ─────────────────────────────────────────────────────────────
function StockActionModal({ item, mode, onClose, onDone, showToast }) {
  const [qty, setQty]   = useState(mode === "set" ? String(item.stock_qty ?? "") : "");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const titles = { set: "Inventaire", add: "Réapprovisionnement", waste: "Déclarer une perte" };
  const hints  = { set: "Quantité réellement en stock après comptage.", add: "Quantité reçue à ajouter au stock.", waste: "Quantité jetée ou invendue (retirée du stock, valorisée au prix de revient)." };
  const submit = async () => {
    const n = parseInt(qty, 10);
    if (isNaN(n) || n < 0 || (mode !== "set" && n === 0)) { showToast("Quantité invalide", "error"); return; }
    setSaving(true);
    try {
      const r = mode === "waste"
        ? await post(`/menus/items/${item.id}/waste/`, { qty: n, note })
        : await post(`/menus/items/${item.id}/stock/`, { mode, qty: n, note });
      showToast(mode === "waste" ? "Perte enregistrée" : "Stock mis à jour ✓");
      onDone(r.item);
    } catch (e) { showToast(e.message, "error"); }
    finally { setSaving(false); }
  };
  return (
    <div className="modal-ov" onClick={onClose}>
      <div className="pin-modal" style={{ textAlign: "left", maxWidth: 380 }} onClick={e => e.stopPropagation()}>
        <h3 className="pin-title">{titles[mode]}</h3>
        <p className="pin-sub">{item.name}{item.track_stock && <> · stock actuel <strong>{item.stock_qty}</strong></>}</p>
        <label className="fl">Quantité</label>
        <input className="fi" type="text" inputMode="numeric" min={0} autoFocus value={qty} onChange={e => setQty(e.target.value)} onKeyDown={e => e.key === "Enter" && submit()} style={{ fontSize: 20, fontWeight: 800, textAlign: "center" }} />
        <p style={{ fontSize: 11, color: "#94A3B8", margin: "6px 0 12px" }}>{hints[mode]}</p>
        <label className="fl">Note</label>
        <input className="fi" placeholder="Livraison, fin de service…" value={note} onChange={e => setNote(e.target.value)} />
        <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
          <button className="btn-secondary" style={{ flex: 1 }} onClick={onClose}>Annuler</button>
          <button className="btn-primary" style={{ flex: 2, justifyContent: "center" }} disabled={saving} onClick={submit}>{saving ? "…" : "Valider"}</button>
        </div>
      </div>
    </div>
  );
}

const STOCK_FILTERS = [["all", "Tous"], ["tracked", "Suivis"], ["low", "Bientôt épuisés"], ["out", "Épuisés"], ["untracked", "Non suivis"]];

export function StockPage({ restaurant, menu, onMenuItemChange, ingredients = [], suppliers = [], onIngredientsChange, onSuppliersChange,
                            onEditRecipe, showToast, refreshKey = 0, initialSection = "dishes" }) {
  const [section, setSection] = useState(initialSection);   // "dishes" | "ingredients"
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [action, setAction] = useState(null);         // {item, mode}
  const [movements, setMovements] = useState([]);
  const [reason, setReason] = useState("");
  const [thresholdEdit, setThresholdEdit] = useState({});

  const loadMovements = useCallback(async () => {
    if (!restaurant) return;
    try { const d = await get(`/menus/stock-movements/?restaurant=${restaurant.id}&page_size=40${reason ? `&reason=${reason}` : ""}`); setMovements(d.results || []); }
    catch {}
  }, [restaurant, reason]);
  useEffect(() => { if (section === "dishes") loadMovements(); }, [loadMovements, refreshKey, section]);

  const out = menu.filter(i => i.is_out_of_stock), low = menu.filter(i => i.is_low_stock);
  const ingAlerts = ingredients.filter(i => i.is_out_of_stock || i.is_low_stock).length;
  const tracked = (i) => i.track_stock || i.has_recipe;
  const q = search.trim().toLowerCase();
  const rows = menu.filter(i => {
    if (q && !i.name.toLowerCase().includes(q)) return false;
    if (filter === "tracked")   return tracked(i);
    if (filter === "untracked") return !tracked(i);
    if (filter === "low")       return i.is_low_stock;
    if (filter === "out")       return i.is_out_of_stock;
    return true;
  }).sort((a, b) => (a.is_out_of_stock ? 0 : a.is_low_stock ? 1 : tracked(a) ? 2 : 3) - (b.is_out_of_stock ? 0 : b.is_low_stock ? 1 : tracked(b) ? 2 : 3) || a.name.localeCompare(b.name));

  const badge = (i) => !tracked(i) ? <span className="stock-badge none">Non suivi</span>
    : i.is_out_of_stock ? <span className="stock-badge out">Épuisé</span>
    : i.is_low_stock ? <span className="stock-badge low">⚠ {i.effective_stock}</span>
    : <span className="stock-badge ok">{i.effective_stock}</span>;
  const recipeInfo = (i) => {
    if (!i.has_recipe) return null;
    const byRecipe = i.portions_available != null && (!i.track_stock || i.portions_available <= i.stock_qty);
    return <p style={{ fontSize: 11, color: byRecipe && i.is_low_stock ? "#B45309" : "var(--text-soft)", marginTop: 3 }}>
      Recette : {i.portions_available} portion(s) possible(s){i.limited_by ? ` · limité par ${i.limited_by}` : ""}{i.track_stock ? ` · ${i.stock_qty} préparé(s)` : ""}
    </p>;
  };

  const sectionBar = (
    <div style={{ display: "flex", gap: 4, background: "#fff", border: "1.5px solid var(--border)", borderRadius: 12, padding: 4, marginBottom: 16, width: "fit-content", maxWidth: "100%" }}>
      {[["dishes", "Plats", out.length + low.length], ["ingredients", "Ingrédients & fournisseurs", ingAlerts]].map(([k, l, n]) => (
        <button key={k} className={`mini-tab ${section === k ? "active" : ""}`} style={{ padding: "8px 14px", fontSize: 13, display: "flex", alignItems: "center", gap: 6 }} onClick={() => setSection(k)}>
          <Ic n={k === "dishes" ? "stock" : "leaf"} s={14} />{l}{n > 0 && <span className="sb-badge" style={{ position: "static", marginLeft: 2 }}>{n}</span>}
        </button>
      ))}
    </div>
  );

  if (section === "ingredients") return (
    <div className="fade-in">
      {sectionBar}
      <IngredientsPage restaurant={restaurant} ingredients={ingredients} suppliers={suppliers} showToast={showToast} refreshKey={refreshKey}
                       onIngredientsChange={onIngredientsChange} onSuppliersChange={onSuppliersChange} />
    </div>
  );

  const saveThreshold = async (item) => {
    const v = parseInt(thresholdEdit[item.id], 10);
    if (isNaN(v) || v < 0 || v === item.low_stock_threshold) { setThresholdEdit(t => { const n = { ...t }; delete n[item.id]; return n; }); return; }
    try { const r = await patch(`/menus/items/${item.id}/`, { low_stock_threshold: v }); onMenuItemChange(r); showToast("Seuil mis à jour ✓"); }
    catch (e) { showToast(e.message, "error"); }
    setThresholdEdit(t => { const n = { ...t }; delete n[item.id]; return n; });
  };
  const untrack = async (item) => {
    if (!confirm(`Ne plus suivre le stock de « ${item.name} » ?`)) return;
    try { const r = await post(`/menus/items/${item.id}/stock/`, { track: false }); onMenuItemChange(r.item); showToast("Suivi désactivé"); }
    catch (e) { showToast(e.message, "error"); }
  };

  return (
    <div className="fade-in">
      {sectionBar}
      {(out.length > 0 || low.length > 0) && (
        <div className={`alert-banner ${out.length ? "" : "warn"}`} onClick={() => setFilter(out.length ? "out" : "low")}>
          <Ic n="warning" s={16} />
          {out.length > 0 && <span><strong>{out.length} plat(s) épuisé(s)</strong> retiré(s) de la carte.</span>}
          {low.length > 0 && <span><strong>{low.length} plat(s)</strong> bientôt épuisé(s).</span>}
        </div>
      )}
      {ingAlerts > 0 && out.length === 0 && low.length === 0 && (
        <div className="alert-banner warn" onClick={() => setSection("ingredients")}>
          <Ic n="leaf" s={16} /><span><strong>{ingAlerts} ingrédient(s)</strong> à commander.</span><span style={{ marginLeft: "auto" }}>Voir →</span>
        </div>
      )}
      <div className="filter-row" style={{ alignItems: "center" }}>
        {STOCK_FILTERS.map(([v, l]) => <button key={v} className={`filter-chip ${filter === v ? "active" : ""}`} onClick={() => setFilter(v)}>{l}
          <span className="chip-n">{v === "all" ? menu.length : v === "tracked" ? menu.filter(tracked).length : v === "untracked" ? menu.filter(i => !tracked(i)).length : v === "low" ? low.length : out.length}</span></button>)}
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8, background: "#fff", border: "1.5px solid var(--border)", borderRadius: 10, padding: "7px 12px" }}>
          <Ic n="search" s={14} c="#94A3B8" /><input value={search} onChange={e => setSearch(e.target.value)} placeholder="Rechercher…" style={{ border: "none", outline: "none", fontSize: 13, fontFamily: "inherit", width: 130 }} />
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-hd"><h3 className="card-title">Stock par plat</h3><span style={{ fontSize: 12, color: "var(--text-soft)" }}>Un plat épuisé (à l'unité ou par ses ingrédients) disparaît de la carte et revient dès qu'il est réapprovisionné.</span></div>
        {rows.length === 0 ? <div className="empty-msg">Aucun plat dans cette catégorie</div> : (
          <div className="tbl-wrap"><table className="tbl tbl-cards">
            <thead><tr><th>Plat</th><th>Stock</th><th>Seuil d'alerte</th><th>Actions</th></tr></thead>
            <tbody>{rows.map(i => (
              <tr key={i.id}>
                <td><p style={{ fontWeight: 700 }}>{i.name}</p><p style={{ fontSize: 11, color: "var(--text-soft)" }}>{i.category_name || "Menu"}{!i.is_available && !i.is_out_of_stock && " · hors carte"}</p>{recipeInfo(i)}</td>
                <td className="td-inline" data-label="Stock">{badge(i)}</td>
                <td className="td-inline" data-label="Seuil d'alerte">{tracked(i) ? (
                  <input type="text" inputMode="numeric" min={0} className="fi" style={{ width: 70, padding: "5px 8px", fontSize: 13 }}
                         value={thresholdEdit[i.id] ?? i.low_stock_threshold}
                         onChange={e => setThresholdEdit(t => ({ ...t, [i.id]: e.target.value }))}
                         onBlur={() => thresholdEdit[i.id] !== undefined && saveThreshold(i)}
                         onKeyDown={e => e.key === "Enter" && e.target.blur()} />
                ) : <span style={{ color: "#94A3B8" }}>—</span>}</td>
                <td data-label="Actions"><div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {i.track_stock ? (
                    <>
                      <button className="pill-btn primary" onClick={() => setAction({ item: i, mode: "add" })}>+ Réappro</button>
                      <button className="pill-btn" onClick={() => setAction({ item: i, mode: "set" })}>Inventaire</button>
                      <button className="pill-btn danger" onClick={() => setAction({ item: i, mode: "waste" })}>Perte</button>
                      <button className="pill-btn" title="Ne plus suivre à l'unité" onClick={() => untrack(i)}>✕ Suivi</button>
                    </>
                  ) : (
                    <>
                      <button className="pill-btn" onClick={() => setAction({ item: i, mode: "set" })}>{i.has_recipe ? "Compter à l'unité" : "Activer le suivi"}</button>
                      <button className="pill-btn danger" onClick={() => setAction({ item: i, mode: "waste" })}>Perte</button>
                    </>
                  )}
                  {i.has_recipe
                    ? <button className="pill-btn" style={{ color: "#15803D", borderColor: "#BBF7D0" }} onClick={() => setSection("ingredients")}><Ic n="leaf" s={12} /> Ingrédients</button>
                    : onEditRecipe && <button className="pill-btn" title="Composer la recette" onClick={() => onEditRecipe(i)}><Ic n="leaf" s={12} /> Recette</button>}
                </div></td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </div>

      <div className="card">
        <div className="card-hd"><h3 className="card-title">Mouvements de stock</h3>
          <select className="fi" style={{ width: "auto", padding: "6px 10px", fontSize: 12 }} value={reason} onChange={e => setReason(e.target.value)}>
            <option value="">Tous les motifs</option>
            {Object.entries(REASON_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </div>
        {movements.length === 0 ? <div className="empty-msg">Aucun mouvement enregistré</div> : (
          <div className="tbl-wrap"><table className="tbl tbl-cards">
            <thead><tr><th>Date</th><th>Plat</th><th>Motif</th><th className="num">Δ</th><th className="num">Stock</th><th>Par</th><th>Note</th></tr></thead>
            <tbody>{movements.map(m => (
              <tr key={m.id}>
                <td className="td-inline" style={{ whiteSpace: "nowrap", color: "var(--text-soft)" }}>{fmtDateTime(m.created_at)}</td>
                <td className="td-inline" style={{ fontWeight: 600 }}>{m.item_name}</td>
                <td className="td-inline"><span className="status-badge" style={{ background: REASON_COLORS[m.reason] + "18", color: REASON_COLORS[m.reason] }}>{m.reason_display}{m.order_number ? ` #${m.order_number}` : ""}</span></td>
                <td className="num td-inline" style={{ fontWeight: 800, color: m.delta > 0 ? "#15803D" : "#DC2626" }}>{m.delta > 0 ? "+" : ""}{m.delta}</td>
                <td className="num td-inline" data-label="Stock">{m.qty_after ?? "—"}</td>
                <td className="td-inline" style={{ color: "var(--text-soft)" }}>{m.user_name || "—"}</td>
                <td style={{ color: "var(--text-soft)", fontSize: 12 }}>{m.note}{m.reason === "perte" && m.value && <span style={{ color: "#DC2626", marginLeft: 6 }}>−{money(m.value)}</span>}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </div>

      {action && <StockActionModal item={action.item} mode={action.mode} showToast={showToast} onClose={() => setAction(null)}
                                   onDone={(item) => { onMenuItemChange(item); setAction(null); loadMovements(); }} />}
    </div>
  );
}

// ─── Avis clients (avec réponse du restaurateur) ─────────────────────────────
function ReviewsCard({ restaurant, showToast, refreshKey = 0 }) {
  const [data, setData] = useState(null);
  const [replying, setReplying] = useState(null);   // id de l'avis en cours de réponse
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const load = useCallback(async () => {
    if (!restaurant) return;
    try { setData(await get(`/orders/reviews/?restaurant=${restaurant.id}`)); } catch {}
  }, [restaurant]);
  useEffect(() => { load(); }, [load, refreshKey]);
  const send = async (id) => {
    setSaving(true);
    try { await post(`/orders/${id}/reply/`, { reply: text }); showToast(text ? "Réponse publiée ✓" : "Réponse retirée"); setReplying(null); setText(""); load(); }
    catch (e) { showToast(e.message, "error"); }
    finally { setSaving(false); }
  };
  if (!data) return null;
  const list = showAll ? data.reviews : data.reviews.slice(0, 5);
  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div className="card-hd" style={{ flexWrap: "wrap", gap: 8 }}>
        <h3 className="card-title">⭐ Avis clients</h3>
        <span style={{ fontSize: 12, color: "var(--text-soft)" }}>
          {data.count ? <><strong style={{ color: "var(--text)" }}>{data.average} / 5</strong> · {data.count} avis{data.unanswered ? <> · <strong style={{ color: "#B45309" }}>{data.unanswered} sans réponse</strong></> : ""}</> : "Aucun avis pour le moment"}
        </span>
      </div>
      {data.count > 0 && (
        <div style={{ display: "flex", gap: 6, marginBottom: 12, flexWrap: "wrap" }}>
          {[5, 4, 3, 2, 1].map(n => <span key={n} className="status-badge" style={{ background: "var(--bg)", color: "var(--text-soft)" }}>{n}★ <strong style={{ color: "var(--text)" }}>{data.distribution[String(n)]}</strong></span>)}
        </div>
      )}
      {list.map(r => (
        <div key={r.id} style={{ padding: "10px 0", borderTop: "1px solid var(--border)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
            <span style={{ fontWeight: 700, fontSize: 13 }}><span style={{ color: "#F59E0B" }}>{"★".repeat(r.rating)}{"☆".repeat(5 - r.rating)}</span> {r.client_name} <span style={{ color: "var(--text-soft)", fontWeight: 500 }}>· #{r.number} · {fmtDate(r.date)}</span></span>
            {!r.owner_reply && r.comment && replying !== r.id && <button className="pill-btn" onClick={() => { setReplying(r.id); setText(""); }}>Répondre</button>}
          </div>
          {r.comment ? <p style={{ fontSize: 13, marginTop: 4 }}>{r.comment}</p> : <p style={{ fontSize: 12, color: "var(--text-soft)", marginTop: 4 }}>Note sans commentaire · {r.items.join(", ")}</p>}
          {r.owner_reply && replying !== r.id && (
            <div style={{ marginTop: 6, marginLeft: 10, paddingLeft: 10, borderLeft: "3px solid var(--primary)", fontSize: 13 }}>
              <p style={{ color: "var(--text-soft)", fontSize: 12 }}>Votre réponse · {fmtDate(r.owner_reply_at)} <button className="link-btn" style={{ marginLeft: 6 }} onClick={() => { setReplying(r.id); setText(r.owner_reply); }}>Modifier</button></p>
              <p>{r.owner_reply}</p>
            </div>
          )}
          {replying === r.id && (
            <div style={{ marginTop: 8 }}>
              <textarea className="fi" rows={2} autoFocus placeholder="Merci pour votre retour…" value={text} onChange={e => setText(e.target.value)} style={{ resize: "vertical" }} />
              <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
                <button className="pill-btn primary" disabled={saving} onClick={() => send(r.id)}>{saving ? "…" : "Publier la réponse"}</button>
                {r.owner_reply && <button className="pill-btn danger" disabled={saving} onClick={() => { setText(""); send(r.id); }}>Retirer</button>}
                <button className="pill-btn" onClick={() => setReplying(null)}>Annuler</button>
              </div>
              <p style={{ fontSize: 11, color: "#94A3B8", marginTop: 4 }}>Visible par tous sur votre page publique, sous l'avis du client.</p>
            </div>
          )}
        </div>
      ))}
      {data.count > 5 && <button className="link-btn" style={{ marginTop: 8 }} onClick={() => setShowAll(v => !v)}>{showAll ? "Réduire" : `Voir les ${data.count} avis`}</button>}
    </div>
  );
}

// ─── Page CLIENTS ────────────────────────────────────────────────────────────
const CUSTOMER_SORTS = [["-total_spent", "Plus dépensé"], ["-orders", "Plus de commandes"], ["-last_order", "Dernière visite"], ["name", "Nom A→Z"]];

export function CustomersPage({ restaurant, showToast, refreshKey = 0 }) {
  const [data, setData]         = useState(null);
  const [search, setSearch]     = useState("");
  const [ordering, setOrdering] = useState("-total_spent");
  const [expanded, setExpanded] = useState(null);
  const [history, setHistory]   = useState({});
  const [exporting, setExporting] = useState(false);

  const load = useCallback(async () => {
    if (!restaurant) return;
    try { setData(await get(`/orders/customers/?restaurant=${restaurant.id}&search=${encodeURIComponent(search)}&ordering=${ordering}`)); }
    catch (e) { showToast(e.message, "error"); }
  }, [restaurant, search, ordering, showToast]);
  useEffect(() => { const t = setTimeout(load, search ? 250 : 0); return () => clearTimeout(t); }, [load, refreshKey]);

  const toggle = async (c) => {
    if (expanded === c.id) { setExpanded(null); return; }
    setExpanded(c.id);
    if (!history[c.id]) {
      try { const d = await get(`/orders/?restaurant=${restaurant.id}&client=${c.id}&ordering=-created_at&page_size=10`); setHistory(h => ({ ...h, [c.id]: d.results || [] })); }
      catch { setHistory(h => ({ ...h, [c.id]: [] })); }
    }
  };
  const doExport = async () => {
    setExporting(true);
    try { await downloadFile(`/orders/customers/?restaurant=${restaurant.id}&type=csv&ordering=${ordering}`, "clients.csv"); }
    catch (e) { showToast(e.message, "error"); }
    finally { setExporting(false); }
  };
  const daysAgo = (iso) => { const d = Math.max(0, Math.floor((Date.now() - new Date(iso)) / 86400000)); return d === 0 ? "aujourd'hui" : d === 1 ? "hier" : `il y a ${d} j`; };
  const STATUS = { nouvelle: "Nouvelle", confirmee: "Confirmée", en_cuisine: "En cuisine", prete: "Prête", en_livraison: "En livraison", recuperee: "Récupérée", annulee: "Annulée" };

  return (
    <div className="fade-in">
      {data && (
        <div className="kpi-row">
          {[
            { label: "Clients", v: data.stats.customers, sub: "ont commandé chez vous", color: "#FF6B2C", icon: "staff" },
            { label: "Nouveaux ce mois", v: data.stats.new_month, sub: "première commande ce mois-ci", color: "#10B981", icon: "plus" },
            { label: "Fidèles", v: data.stats.regulars, sub: "3 commandes ou plus", color: "#6366F1", icon: "check" },
            { label: "Dépense moyenne", v: money(data.stats.avg_spent), sub: "par client, toutes visites", color: "#F59E0B", icon: "euro" },
          ].map((k, i) => (
            <div key={i} className="kpi-card">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                <div><p className="kpi-label">{k.label}</p><p className="kpi-val" style={{ fontSize: 22 }}>{k.v}</p><p className="kpi-sub">{k.sub}</p></div>
                <div style={{ width: 40, height: 40, borderRadius: 12, background: k.color + "18", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}><Ic n={k.icon} s={18} c={k.color} /></div>
              </div>
            </div>
          ))}
        </div>
      )}
      <ReviewsCard restaurant={restaurant} showToast={showToast} refreshKey={refreshKey} />
      <div className="filter-row" style={{ alignItems: "center" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, background: "#fff", border: "1.5px solid var(--border)", borderRadius: 10, padding: "7px 12px", flex: "1 1 200px" }}>
          <Ic n="search" s={14} c="#94A3B8" /><input value={search} onChange={e => setSearch(e.target.value)} placeholder="Nom ou e-mail…" style={{ border: "none", outline: "none", fontSize: 13, fontFamily: "inherit", width: "100%" }} />
        </div>
        <select className="fi" style={{ width: "auto" }} value={ordering} onChange={e => setOrdering(e.target.value)}>
          {CUSTOMER_SORTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <button className="pill-btn" disabled={exporting || !data?.customers.length} onClick={doExport}><Ic n="download" s={13} /> CSV</button>
      </div>

      <div className="card">
        <div className="card-hd"><h3 className="card-title">Ma clientèle</h3><span style={{ fontSize: 12, color: "var(--text-soft)" }}>{data ? `${data.customers.length} client(s)` : "…"}</span></div>
        {!data ? <div className="empty-msg">Chargement…</div> : data.customers.length === 0 ? (
          <div className="empty-msg">{search ? "Aucun client ne correspond." : "Aucun client pour l'instant : la liste se remplit avec les commandes passées en ligne (les ventes comptoir, anonymes, n'y figurent pas)."}</div>
        ) : (
          <div className="tbl-wrap"><table className="tbl tbl-cards">
            <thead><tr><th>Client</th><th>Contact</th><th className="num">Commandes</th><th className="num">Total</th><th>Dernière visite</th><th>Plat préféré</th><th>Note</th></tr></thead>
            <tbody>{data.customers.map(c => (
              <Fragment key={c.id}>
                <tr onClick={() => toggle(c)} style={{ cursor: "pointer", background: expanded === c.id ? "var(--bg)" : undefined }}>
                  <td><div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span className="sb-av" style={{ width: 34, height: 34, fontSize: 14, borderRadius: 10 }}>{c.initial}</span>
                    <div><p style={{ fontWeight: 700 }}>{c.name}</p>
                      <p style={{ fontSize: 11 }}>{c.is_new && <span className="stock-badge ok" style={{ fontSize: 10, padding: "1px 7px" }}>Nouveau</span>}{c.is_regular && <span className="stock-badge low" style={{ fontSize: 10, padding: "1px 7px", marginLeft: 4, background: "#EEF2FF", color: "#4338CA" }}>Fidèle</span>}</p>
                    </div></div></td>
                  <td className="td-inline" data-label="Contact">{c.contact_visible
                    ? <div style={{ fontSize: 12 }}>{c.phone && <p style={{ fontWeight: 600 }}>{c.phone}</p>}<p style={{ color: "var(--text-soft)" }}>{c.email}</p></div>
                    : <span className="stock-badge none" title="Le client n'a pas partagé ses coordonnées"><Ic n="lock" s={11} /> Non partagé</span>}</td>
                  <td className="num td-inline" data-label="Commandes" style={{ fontWeight: 700 }}>{c.orders}</td>
                  <td className="num td-inline" data-label="Total" style={{ fontWeight: 800, color: "var(--primary)" }}>{money(c.total_spent)}</td>
                  <td className="td-inline" data-label="Dernière visite">{fmtDate(c.last_order)} <span style={{ color: "var(--text-soft)", fontSize: 12 }}>· {daysAgo(c.last_order)}</span></td>
                  <td className="td-inline" data-label="Plat préféré">{c.favorite || "—"}</td>
                  <td className="td-inline" data-label="Note">{c.avg_rating ? `⭐ ${c.avg_rating}` : <span style={{ color: "#94A3B8" }}>—</span>}</td>
                </tr>
                {expanded === c.id && (
                  <tr><td colSpan={7} style={{ background: "var(--bg)", padding: "10px 14px" }}>
                    <p style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", color: "var(--text-soft)", marginBottom: 6 }}>Dernières commandes · panier moyen {money(c.avg_basket)} · client depuis le {fmtDate(c.first_order)}</p>
                    {!history[c.id] ? <p style={{ fontSize: 12 }}>Chargement…</p> : history[c.id].map(o => (
                      <div key={o.id} className="closure-row" style={{ flexWrap: "wrap" }}>
                        <span><strong>#{o.number}</strong> <span style={{ color: "var(--text-soft)" }}>{fmtDateTime(o.created_at)} · {STATUS[o.status] || o.status}</span></span>
                        <span style={{ color: "var(--text-soft)", flex: "1 1 100%", fontSize: 12 }}>{(o.items || []).map(i => `${i.qty}× ${i.name}`).join(", ")}{o.note && ` · « ${o.note} »`}</span>
                        <span style={{ fontWeight: 700 }}>{money(o.total_price)}</span>
                      </div>
                    ))}
                  </td></tr>
                )}
              </Fragment>
            ))}</tbody>
          </table></div>
        )}
        <p style={{ fontSize: 11, color: "#94A3B8", marginTop: 10 }}>Les coordonnées n'apparaissent que pour les clients qui ont choisi de les partager lors de leur inscription.</p>
      </div>
    </div>
  );
}
