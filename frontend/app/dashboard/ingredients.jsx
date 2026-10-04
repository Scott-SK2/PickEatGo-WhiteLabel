"use client";
/**
 * dashboard/ingredients.jsx — gestion des matières premières :
 * ingrédients (stock, seuils, prix d'achat), fournisseurs, liste de courses,
 * mouvements. Les recettes (plat ↔ ingrédients) se règlent dans le formulaire du plat.
 */
import { useState, useEffect, useCallback, useMemo } from "react";
import { get, post, patch, del, downloadFile, money, qty, fmtDateTime, Ic, UNIT_LABELS, REASON_LABELS, REASON_COLORS } from "./shared";

const EMPTY_ING = { name: "", unit: "pc", unit_cost: "", low_stock_threshold: "", supplier: "", reorder_qty: "", stock_qty: "" };
const EMPTY_SUP = { name: "", contact_name: "", phone: "", email: "", note: "" };

// ─── Formulaire ingrédient ───────────────────────────────────────────────────
function IngredientFormModal({ restaurant, ingredient, suppliers, onClose, onSaved, showToast }) {
  const editing = !!ingredient;
  const [f, setF] = useState(() => editing ? {
    name: ingredient.name, unit: ingredient.unit, unit_cost: String(ingredient.unit_cost ?? ""),
    low_stock_threshold: String(ingredient.low_stock_threshold ?? ""), supplier: ingredient.supplier || "",
    reorder_qty: ingredient.reorder_qty == null ? "" : String(ingredient.reorder_qty), stock_qty: "",
  } : EMPTY_ING);
  const [saving, setSaving] = useState(false);
  const set = (k) => (e) => setF(p => ({ ...p, [k]: e.target.value }));
  const num = (v) => v === "" ? null : parseFloat(String(v).replace(",", "."));

  const submit = async () => {
    if (!f.name.trim()) { showToast("Le nom est requis", "error"); return; }
    setSaving(true);
    try {
      const body = { name: f.name.trim(), unit: f.unit, unit_cost: num(f.unit_cost) ?? 0,
                     low_stock_threshold: num(f.low_stock_threshold) ?? 0, supplier: f.supplier || null, reorder_qty: num(f.reorder_qty) };
      let r;
      if (editing) r = await patch(`/menus/ingredients/${ingredient.id}/`, body);
      else r = await post("/menus/ingredients/", { ...body, restaurant: restaurant.id, stock_qty: num(f.stock_qty) ?? 0 });
      showToast(editing ? "Ingrédient modifié ✓" : "Ingrédient ajouté ✓");
      onSaved(r);
    } catch (e) { showToast(e.message, "error"); }
    finally { setSaving(false); }
  };

  return (
    <div className="modal-ov" onClick={onClose}>
      <div className="pin-modal" style={{ textAlign: "left", maxWidth: 440 }} onClick={e => e.stopPropagation()}>
        <h3 className="pin-title">{editing ? "Modifier l'ingrédient" : "Nouvel ingrédient"}</h3>
        <p className="pin-sub">Une matière première que vous stockez et que vos plats consomment.</p>
        <div className="sf">
          <div><label className="fl">Nom *</label><input className="fi" autoFocus placeholder="Steak haché, Pain burger, Cheddar…" value={f.name} onChange={set("name")} /></div>
          <div className="form-3col">
            <div><label className="fl">Unité</label>
              <select className="fi" value={f.unit} onChange={set("unit")}>{Object.entries(UNIT_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
            <div><label className="fl">Prix d'achat / {UNIT_LABELS[f.unit]?.split("(")[0].trim()}</label><input className="fi" type="text" inputMode="decimal" min="0" placeholder="12.50" value={f.unit_cost} onChange={set("unit_cost")} /></div>
            <div><label className="fl">Seuil d'alerte</label><input className="fi" type="text" inputMode="decimal" min="0" placeholder="0" value={f.low_stock_threshold} onChange={set("low_stock_threshold")} /></div>
          </div>
          <div className="form-3col" style={{ gridTemplateColumns: editing ? "1fr 1fr" : "1fr 1fr 1fr" }}>
            <div><label className="fl">Fournisseur</label>
              <select className="fi" value={f.supplier} onChange={set("supplier")}><option value="">—</option>{suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>
            <div><label className="fl">Qté à commander</label><input className="fi" type="text" inputMode="decimal" min="0" placeholder="auto" value={f.reorder_qty} onChange={set("reorder_qty")} /></div>
            {!editing && <div><label className="fl">Stock initial</label><input className="fi" type="text" inputMode="decimal" min="0" placeholder="0" value={f.stock_qty} onChange={set("stock_qty")} /></div>}
          </div>
          <p style={{ fontSize: 11, color: "#94A3B8", marginTop: -4 }}>
            Le prix d'achat sert à calculer le coût matière des plats. « Qté à commander » alimente la liste de courses (vide = 2 × le seuil).
            {editing && " Le stock se modifie par réappro / inventaire pour rester tracé."}
          </p>
        </div>
        <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
          <button className="btn-secondary" style={{ flex: 1 }} onClick={onClose}>Annuler</button>
          <button className="btn-primary" style={{ flex: 2, justifyContent: "center" }} disabled={saving} onClick={submit}>{saving ? "…" : editing ? "Enregistrer" : "Ajouter"}</button>
        </div>
      </div>
    </div>
  );
}

// ─── Réappro / inventaire / perte sur un ingrédient ──────────────────────────
function IngredientActionModal({ ingredient, mode, presetQty, onClose, onDone, showToast }) {
  const [q, setQ]       = useState(presetQty != null ? String(presetQty) : mode === "set" ? String(ingredient.stock_qty ?? "") : "");
  const [cost, setCost] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const titles = { set: "Inventaire", add: "Réception / réappro", waste: "Déclarer une perte" };
  const hints  = { set: "Quantité réellement en stock après comptage.", add: "Quantité reçue, ajoutée au stock. Indiquez le nouveau prix d'achat s'il a changé.", waste: "Quantité jetée ou périmée (retirée du stock, valorisée au prix d'achat)." };
  const submit = async () => {
    const n = parseFloat(String(q).replace(",", "."));
    if (isNaN(n) || n < 0 || (mode !== "set" && n === 0)) { showToast("Quantité invalide", "error"); return; }
    setSaving(true);
    try {
      const body = { qty: n, note };
      if (mode === "add" && cost !== "") body.unit_cost = parseFloat(String(cost).replace(",", "."));
      const r = mode === "waste"
        ? await post(`/menus/ingredients/${ingredient.id}/waste/`, body)
        : await post(`/menus/ingredients/${ingredient.id}/stock/`, { mode, ...body });
      showToast(mode === "waste" ? "Perte enregistrée" : "Stock mis à jour ✓");
      onDone(r.ingredient);
    } catch (e) { showToast(e.message, "error"); }
    finally { setSaving(false); }
  };
  return (
    <div className="modal-ov" onClick={onClose}>
      <div className="pin-modal" style={{ textAlign: "left", maxWidth: 380 }} onClick={e => e.stopPropagation()}>
        <h3 className="pin-title">{titles[mode]}</h3>
        <p className="pin-sub">{ingredient.name} · stock actuel <strong>{qty(ingredient.stock_qty, ingredient.unit)}</strong></p>
        <label className="fl">Quantité ({UNIT_LABELS[ingredient.unit]})</label>
        <input className="fi" type="text" inputMode="decimal" min={0} autoFocus value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => e.key === "Enter" && submit()} style={{ fontSize: 20, fontWeight: 800, textAlign: "center" }} />
        <p style={{ fontSize: 11, color: "#94A3B8", margin: "6px 0 12px" }}>{hints[mode]}</p>
        {mode === "add" && <><label className="fl">Nouveau prix d'achat (optionnel)</label>
          <input className="fi" type="text" inputMode="decimal" min="0" placeholder={`actuel : ${money(ingredient.unit_cost)}`} value={cost} onChange={e => setCost(e.target.value)} style={{ marginBottom: 10 }} /></>}
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

// ─── Formulaire fournisseur ──────────────────────────────────────────────────
function SupplierFormModal({ restaurant, supplier, onClose, onSaved, showToast }) {
  const editing = !!supplier;
  const [f, setF] = useState(() => editing ? { name: supplier.name, contact_name: supplier.contact_name || "", phone: supplier.phone || "", email: supplier.email || "", note: supplier.note || "" } : EMPTY_SUP);
  const [saving, setSaving] = useState(false);
  const set = (k) => (e) => setF(p => ({ ...p, [k]: e.target.value }));
  const submit = async () => {
    if (!f.name.trim()) { showToast("Le nom est requis", "error"); return; }
    setSaving(true);
    try {
      const r = editing ? await patch(`/menus/suppliers/${supplier.id}/`, f) : await post("/menus/suppliers/", { ...f, restaurant: restaurant.id });
      showToast(editing ? "Fournisseur modifié ✓" : "Fournisseur ajouté ✓"); onSaved(r);
    } catch (e) { showToast(e.message, "error"); }
    finally { setSaving(false); }
  };
  return (
    <div className="modal-ov" onClick={onClose}>
      <div className="pin-modal" style={{ textAlign: "left", maxWidth: 420 }} onClick={e => e.stopPropagation()}>
        <h3 className="pin-title">{editing ? "Modifier le fournisseur" : "Nouveau fournisseur"}</h3>
        <div className="sf" style={{ marginTop: 12 }}>
          <div><label className="fl">Nom *</label><input className="fi" autoFocus placeholder="Boucherie Dupont, Metro…" value={f.name} onChange={set("name")} /></div>
          <div className="form-3col" style={{ gridTemplateColumns: "1fr 1fr" }}>
            <div><label className="fl">Contact</label><input className="fi" placeholder="Prénom Nom" value={f.contact_name} onChange={set("contact_name")} /></div>
            <div><label className="fl">Téléphone</label><input className="fi" type="tel" placeholder="+32 …" value={f.phone} onChange={set("phone")} /></div>
          </div>
          <div><label className="fl">E-mail</label><input className="fi" type="email" placeholder="commandes@…" value={f.email} onChange={set("email")} /></div>
          <div><label className="fl">Note</label><input className="fi" placeholder="Livraison mardi et vendredi, minimum 50 €…" value={f.note} onChange={set("note")} /></div>
        </div>
        <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
          <button className="btn-secondary" style={{ flex: 1 }} onClick={onClose}>Annuler</button>
          <button className="btn-primary" style={{ flex: 2, justifyContent: "center" }} disabled={saving} onClick={submit}>{saving ? "…" : "Enregistrer"}</button>
        </div>
      </div>
    </div>
  );
}

// ─── Page ingrédients ────────────────────────────────────────────────────────
const VIEWS = [["list", "Ingrédients"], ["shopping", "Liste de courses"], ["suppliers", "Fournisseurs"], ["moves", "Mouvements"]];
const ING_FILTERS = [["all", "Tous"], ["alert", "En alerte"], ["ok", "OK"]];

export function IngredientsPage({ restaurant, ingredients, suppliers, onIngredientsChange, onSuppliersChange, showToast, refreshKey = 0 }) {
  const [view, setView]     = useState("list");
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [form, setForm]     = useState(null);        // { ingredient|null }
  const [action, setAction] = useState(null);        // { ingredient, mode, presetQty }
  const [supForm, setSupForm] = useState(null);      // { supplier|null }
  const [shopping, setShopping] = useState(null);
  const [movements, setMovements] = useState([]);
  const [reason, setReason] = useState("");
  const [exporting, setExporting] = useState(false);

  const loadShopping = useCallback(async () => {
    if (!restaurant) return;
    try { setShopping(await get(`/menus/ingredients/shopping-list/?restaurant=${restaurant.id}`)); } catch {}
  }, [restaurant]);
  const loadMovements = useCallback(async () => {
    if (!restaurant) return;
    try { const d = await get(`/menus/ingredient-movements/?restaurant=${restaurant.id}&page_size=40${reason ? `&reason=${reason}` : ""}`); setMovements(d.results || []); } catch {}
  }, [restaurant, reason]);
  useEffect(() => { if (view === "shopping") loadShopping(); }, [view, loadShopping, refreshKey, ingredients]);
  useEffect(() => { if (view === "moves") loadMovements(); }, [view, loadMovements, refreshKey]);

  const out = ingredients.filter(i => i.is_out_of_stock), low = ingredients.filter(i => i.is_low_stock);
  const stockValue = useMemo(() => ingredients.reduce((s, i) => s + parseFloat(i.stock_value || 0), 0), [ingredients]);
  const q = search.trim().toLowerCase();
  const rows = ingredients.filter(i => {
    if (q && !i.name.toLowerCase().includes(q)) return false;
    if (filter === "alert") return i.is_out_of_stock || i.is_low_stock;
    if (filter === "ok")    return !i.is_out_of_stock && !i.is_low_stock;
    return true;
  }).sort((a, b) => (a.is_out_of_stock ? 0 : a.is_low_stock ? 1 : 2) - (b.is_out_of_stock ? 0 : b.is_low_stock ? 1 : 2) || a.name.localeCompare(b.name));

  const badge = (i) => i.is_out_of_stock ? <span className="stock-badge out">Épuisé</span>
    : i.is_low_stock ? <span className="stock-badge low">⚠ {qty(i.stock_qty, i.unit)}</span>
    : <span className="stock-badge ok">{qty(i.stock_qty, i.unit)}</span>;

  const upsert = (ing) => onIngredientsChange(prev => prev.some(i => i.id === ing.id) ? prev.map(i => i.id === ing.id ? ing : i) : [...prev, ing]);
  const removeIng = async (i) => {
    if (!confirm(`Supprimer « ${i.name} » ?`)) return;
    try { await del(`/menus/ingredients/${i.id}/`); onIngredientsChange(prev => prev.filter(x => x.id !== i.id)); showToast("Ingrédient supprimé"); }
    catch (e) { showToast(e.message, "error"); }
  };
  const removeSup = async (s) => {
    if (!confirm(`Supprimer le fournisseur « ${s.name} » ? Les ingrédients liés seront conservés sans fournisseur.`)) return;
    try { await del(`/menus/suppliers/${s.id}/`); onSuppliersChange(prev => prev.filter(x => x.id !== s.id)); onIngredientsChange(prev => prev.map(i => i.supplier === s.id ? { ...i, supplier: null, supplier_name: null } : i)); showToast("Fournisseur supprimé"); }
    catch (e) { showToast(e.message, "error"); }
  };
  const exportShopping = async () => {
    setExporting(true);
    try { await downloadFile(`/menus/ingredients/shopping-list/?restaurant=${restaurant.id}&type=csv`, "liste-de-courses.csv"); }
    catch (e) { showToast(e.message, "error"); } finally { setExporting(false); }
  };

  return (
    <div className="fade-in">
      {(out.length > 0 || low.length > 0) && (
        <div className={`alert-banner ${out.length ? "" : "warn"}`} onClick={() => { setView("list"); setFilter("alert"); }}>
          <Ic n="warning" s={16} />
          {out.length > 0 && <span><strong>{out.length} ingrédient(s) épuisé(s)</strong> : {out.map(i => i.name).join(", ")}.</span>}
          {low.length > 0 && <span><strong>{low.length}</strong> bientôt épuisé(s) : {low.map(i => i.name).join(", ")}.</span>}
        </div>
      )}

      <div className="kpi-row" style={{ marginBottom: 16 }}>
        {[
          { label: "Ingrédients", v: ingredients.length, sub: `${ingredients.filter(i => i.used_by?.length).length} utilisé(s) dans une recette`, color: "#10B981", icon: "leaf" },
          { label: "En alerte", v: out.length + low.length, sub: out.length ? `${out.length} épuisé(s)` : "Aucun épuisé", color: out.length ? "#EF4444" : "#F59E0B", icon: "warning" },
          { label: "Valeur du stock", v: money(stockValue), sub: "au prix d'achat", color: "#6366F1", icon: "euro" },
          { label: "Fournisseurs", v: suppliers.length, sub: shopping ? `${shopping.count} article(s) à commander` : "—", color: "#FF6B2C", icon: "truck" },
        ].map((k, i) => (
          <div key={i} className="kpi-card">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
              <div><p className="kpi-label">{k.label}</p><p className="kpi-val" style={{ fontSize: 22 }}>{k.v}</p><p className="kpi-sub">{k.sub}</p></div>
              <div style={{ width: 40, height: 40, borderRadius: 12, background: k.color + "18", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}><Ic n={k.icon} s={18} c={k.color} /></div>
            </div>
          </div>
        ))}
      </div>

      <div className="filter-row" style={{ alignItems: "center" }}>
        {VIEWS.map(([v, l]) => <button key={v} className={`filter-chip ${view === v ? "active" : ""}`} onClick={() => setView(v)}>{l}
          {v === "list" && <span className="chip-n">{ingredients.length}</span>}
          {v === "shopping" && (out.length + low.length) > 0 && <span className="chip-n">{out.length + low.length}</span>}
          {v === "suppliers" && <span className="chip-n">{suppliers.length}</span>}
        </button>)}
        <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
          {view === "list" && <button className="btn-primary" style={{ padding: "8px 14px", fontSize: 13 }} onClick={() => setForm({ ingredient: null })}><Ic n="plus" s={14} c="white" /> Ingrédient</button>}
          {view === "suppliers" && <button className="btn-primary" style={{ padding: "8px 14px", fontSize: 13 }} onClick={() => setSupForm({ supplier: null })}><Ic n="plus" s={14} c="white" /> Fournisseur</button>}
          {view === "shopping" && <button className="pill-btn" disabled={exporting || !shopping?.count} onClick={exportShopping}><Ic n="download" s={13} /> CSV</button>}
        </div>
      </div>

      {/* ── Liste des ingrédients ── */}
      {view === "list" && (
        <div className="card">
          <div className="card-hd" style={{ flexWrap: "wrap", gap: 8 }}>
            <h3 className="card-title">Matières premières</h3>
            <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
              {ING_FILTERS.map(([v, l]) => <button key={v} className={`mini-tab ${filter === v ? "active" : ""}`} onClick={() => setFilter(v)}>{l}</button>)}
              <div style={{ display: "flex", alignItems: "center", gap: 8, background: "#fff", border: "1.5px solid var(--border)", borderRadius: 10, padding: "6px 10px" }}>
                <Ic n="search" s={14} c="#94A3B8" /><input value={search} onChange={e => setSearch(e.target.value)} placeholder="Rechercher…" style={{ border: "none", outline: "none", fontSize: 13, fontFamily: "inherit", width: 110 }} />
              </div>
            </div>
          </div>
          {ingredients.length === 0 ? (
            <div className="empty-msg"><p style={{ fontSize: 32, marginBottom: 10 }}>🥬</p><p style={{ fontWeight: 700, color: "var(--text)", marginBottom: 6 }}>Aucun ingrédient</p>
              <p style={{ fontSize: 12, color: "#94A3B8", maxWidth: 420, margin: "0 auto" }}>Ajoutez vos matières premières (pain, viande, fromage…), puis composez la recette de chaque plat depuis le menu. Les ventes décrémenteront le stock automatiquement.</p></div>
          ) : rows.length === 0 ? <div className="empty-msg">Aucun ingrédient ne correspond</div> : (
            <div className="tbl-wrap"><table className="tbl tbl-cards">
              <thead><tr><th>Ingrédient</th><th>Stock</th><th>Seuil</th><th className="num">Prix d'achat</th><th>Fournisseur</th><th>Actions</th></tr></thead>
              <tbody>{rows.map(i => (
                <tr key={i.id}>
                  <td><p style={{ fontWeight: 700 }}>{i.name}</p>
                    <p style={{ fontSize: 11, color: "var(--text-soft)" }}>{i.used_by?.length ? `Dans ${i.used_by.length} recette(s) : ${i.used_by.slice(0, 3).map(u => u.name).join(", ")}${i.used_by.length > 3 ? "…" : ""}` : "Pas encore dans une recette"}</p></td>
                  <td className="td-inline" data-label="Stock">{badge(i)}</td>
                  <td className="td-inline" data-label="Seuil" style={{ color: "var(--text-soft)" }}>{qty(i.low_stock_threshold, i.unit)}</td>
                  <td className="num td-inline" data-label="Prix d'achat">{money(i.unit_cost)} <span style={{ color: "var(--text-soft)", fontWeight: 500 }}>/ {UNIT_LABELS[i.unit]?.split("(")[0].trim()}</span></td>
                  <td className="td-inline" data-label="Fournisseur" style={{ color: "var(--text-soft)" }}>{i.supplier_name || "—"}</td>
                  <td data-label="Actions"><div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    <button className="pill-btn primary" onClick={() => setAction({ ingredient: i, mode: "add" })}>+ Réappro</button>
                    <button className="pill-btn" onClick={() => setAction({ ingredient: i, mode: "set" })}>Inventaire</button>
                    <button className="pill-btn danger" onClick={() => setAction({ ingredient: i, mode: "waste" })}>Perte</button>
                    <button className="icon-btn-sm" title="Modifier" onClick={() => setForm({ ingredient: i })}><Ic n="edit" s={14} c="#6366F1" /></button>
                    <button className="icon-btn-sm red" title="Supprimer" onClick={() => removeIng(i)}><Ic n="trash" s={14} c="#EF4444" /></button>
                  </div></td>
                </tr>
              ))}</tbody>
            </table></div>
          )}
        </div>
      )}

      {/* ── Liste de courses ── */}
      {view === "shopping" && (
        <div className="card">
          <div className="card-hd"><h3 className="card-title">À commander</h3>
            {shopping && shopping.count > 0 && <span style={{ fontWeight: 800 }}>≈ {money(shopping.total)}</span>}</div>
          {!shopping ? <div className="empty-msg">Chargement…</div> : shopping.count === 0 ? (
            <div className="empty-msg"><p style={{ fontSize: 32, marginBottom: 10 }}>✅</p><p style={{ fontWeight: 700, color: "var(--text)" }}>Rien à commander</p><p style={{ fontSize: 12, color: "#94A3B8" }}>Les ingrédients sous leur seuil d'alerte apparaîtront ici, groupés par fournisseur.</p></div>
          ) : shopping.groups.map((g, gi) => (
            <div key={gi} style={{ marginBottom: 18 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
                <div><p style={{ fontWeight: 800, display: "flex", alignItems: "center", gap: 6 }}><Ic n="truck" s={14} c="#FF6B2C" /> {g.supplier ? g.supplier.name : "Sans fournisseur"}</p>
                  {g.supplier && (g.supplier.phone || g.supplier.email) && <p style={{ fontSize: 12, color: "var(--text-soft)" }}>{[g.supplier.contact_name, g.supplier.phone, g.supplier.email].filter(Boolean).join(" · ")}</p>}
                  {g.supplier?.note && <p style={{ fontSize: 11, color: "#94A3B8" }}>{g.supplier.note}</p>}</div>
                <span style={{ fontWeight: 700, color: "var(--text-soft)" }}>≈ {money(g.total)}</span>
              </div>
              <div className="tbl-wrap"><table className="tbl tbl-cards">
                <thead><tr><th>Ingrédient</th><th>Stock</th><th>À commander</th><th className="num">Coût estimé</th><th></th></tr></thead>
                <tbody>{g.lines.map(l => (
                  <tr key={l.ingredient.id}>
                    <td style={{ fontWeight: 700 }}>{l.ingredient.name}</td>
                    <td className="td-inline" data-label="Stock">{badge(l.ingredient)}</td>
                    <td className="td-inline" data-label="À commander" style={{ fontWeight: 800 }}>{qty(l.qty, l.ingredient.unit)}</td>
                    <td className="num td-inline" data-label="Coût">{money(l.cost)}</td>
                    <td><button className="pill-btn primary" onClick={() => setAction({ ingredient: l.ingredient, mode: "add", presetQty: parseFloat(l.qty) })}>Réceptionner</button></td>
                  </tr>
                ))}</tbody>
              </table></div>
            </div>
          ))}
        </div>
      )}

      {/* ── Fournisseurs ── */}
      {view === "suppliers" && (
        <div className="card">
          <div className="card-hd"><h3 className="card-title">Fournisseurs</h3><span style={{ fontSize: 12, color: "var(--text-soft)" }}>Associez chaque ingrédient à son fournisseur pour une liste de courses prête à envoyer.</span></div>
          {suppliers.length === 0 ? <div className="empty-msg">Aucun fournisseur. Ajoutez-en un avec le bouton ci-dessus.</div> : (
            <div className="grid2">
              {suppliers.map(s => (
                <div key={s.id} style={{ border: "1.5px solid var(--border)", borderRadius: 12, padding: "12px 14px", display: "flex", gap: 10, alignItems: "flex-start" }}>
                  <div style={{ width: 38, height: 38, borderRadius: 10, background: "#FFF0E8", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}><Ic n="truck" s={17} c="#FF6B2C" /></div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ fontWeight: 800 }}>{s.name}</p>
                    <p style={{ fontSize: 12, color: "var(--text-soft)", wordBreak: "break-word" }}>{[s.contact_name, s.phone, s.email].filter(Boolean).join(" · ") || "Aucune coordonnée"}</p>
                    {s.note && <p style={{ fontSize: 11, color: "#94A3B8", marginTop: 2 }}>{s.note}</p>}
                    <p style={{ fontSize: 11, color: "#94A3B8", marginTop: 4 }}>{ingredients.filter(i => i.supplier === s.id).length} ingrédient(s)</p>
                  </div>
                  <div style={{ display: "flex", gap: 4 }}>
                    <button className="icon-btn-sm" onClick={() => setSupForm({ supplier: s })}><Ic n="edit" s={14} c="#6366F1" /></button>
                    <button className="icon-btn-sm red" onClick={() => removeSup(s)}><Ic n="trash" s={14} c="#EF4444" /></button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Mouvements ── */}
      {view === "moves" && (
        <div className="card">
          <div className="card-hd"><h3 className="card-title">Mouvements d'ingrédients</h3>
            <select className="fi" style={{ width: "auto", padding: "6px 10px", fontSize: 12 }} value={reason} onChange={e => setReason(e.target.value)}>
              <option value="">Tous les motifs</option>
              {Object.entries(REASON_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </div>
          {movements.length === 0 ? <div className="empty-msg">Aucun mouvement enregistré</div> : (
            <div className="tbl-wrap"><table className="tbl tbl-cards">
              <thead><tr><th>Date</th><th>Ingrédient</th><th>Motif</th><th className="num">Δ</th><th className="num">Stock</th><th>Par</th><th>Note</th></tr></thead>
              <tbody>{movements.map(m => (
                <tr key={m.id}>
                  <td className="td-inline" style={{ whiteSpace: "nowrap", color: "var(--text-soft)" }}>{fmtDateTime(m.created_at)}</td>
                  <td className="td-inline" style={{ fontWeight: 600 }}>{m.ingredient_name}</td>
                  <td className="td-inline"><span className="status-badge" style={{ background: REASON_COLORS[m.reason] + "18", color: REASON_COLORS[m.reason] }}>{m.reason_display}{m.order_number ? ` #${m.order_number}` : ""}</span></td>
                  <td className="num td-inline" style={{ fontWeight: 800, color: parseFloat(m.delta) > 0 ? "#15803D" : "#DC2626" }}>{parseFloat(m.delta) > 0 ? "+" : ""}{qty(m.delta)}</td>
                  <td className="num td-inline" data-label="Stock">{qty(m.qty_after, m.unit)}</td>
                  <td className="td-inline" style={{ color: "var(--text-soft)" }}>{m.user_name || "—"}</td>
                  <td style={{ color: "var(--text-soft)", fontSize: 12 }}>{m.note}{m.reason === "perte" && m.value && <span style={{ color: "#DC2626", marginLeft: 6 }}>−{money(m.value)}</span>}</td>
                </tr>
              ))}</tbody>
            </table></div>
          )}
        </div>
      )}

      {form && <IngredientFormModal restaurant={restaurant} ingredient={form.ingredient} suppliers={suppliers} showToast={showToast}
                                    onClose={() => setForm(null)} onSaved={(ing) => { upsert(ing); setForm(null); }} />}
      {action && <IngredientActionModal ingredient={action.ingredient} mode={action.mode} presetQty={action.presetQty} showToast={showToast}
                                        onClose={() => setAction(null)} onDone={(ing) => { upsert(ing); setAction(null); if (view === "moves") loadMovements(); }} />}
      {supForm && <SupplierFormModal restaurant={restaurant} supplier={supForm.supplier} showToast={showToast} onClose={() => setSupForm(null)}
                                     onSaved={(s) => { onSuppliersChange(prev => prev.some(x => x.id === s.id) ? prev.map(x => x.id === s.id ? s : x) : [...prev, s]); setSupForm(null); }} />}
    </div>
  );
}
