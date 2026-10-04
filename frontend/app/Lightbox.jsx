"use client";
/**
 * Lightbox — visionneuse plein écran : flèches, balayage tactile, clavier (←, →, Échap),
 * compteur et légende. `images` : [{ url, caption? }] ou tableau d'URLs.
 */
import { useEffect, useRef, useState } from "react";

export default function Lightbox({ images, index = 0, onClose, title }) {
  const list = (images || []).map(i => (typeof i === "string" ? { url: i } : i)).filter(i => i && i.url);
  const [i, setI] = useState(Math.min(index, Math.max(0, list.length - 1)));
  const touch = useRef(null);
  const n = list.length;
  const go = (d) => setI(x => (x + d + n) % n);

  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); else if (e.key === "ArrowRight") go(1); else if (e.key === "ArrowLeft") go(-1); };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow; document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", onKey); document.body.style.overflow = prev; };
  }, [n]); // eslint-disable-line react-hooks/exhaustive-deps

  if (n === 0) return null;
  const cur = list[i];
  return (
    <div onClick={onClose} role="dialog" aria-label="Photo en grand"
      style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(10,12,20,.94)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "calc(12px + env(safe-area-inset-top)) 12px calc(12px + env(safe-area-inset-bottom))", animation: "lbFade .18s ease" }}
      onTouchStart={e => { touch.current = e.touches[0].clientX; }}
      onTouchEnd={e => { if (touch.current == null) return; const dx = e.changedTouches[0].clientX - touch.current; if (Math.abs(dx) > 40) go(dx < 0 ? 1 : -1); touch.current = null; }}>
      <style>{`@keyframes lbFade{from{opacity:0}to{opacity:1}} .lb-btn{background:rgba(255,255,255,.12);border:none;color:#fff;width:44px;height:44px;border-radius:50%;font-size:22px;cursor:pointer;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(4px)} .lb-btn:hover{background:rgba(255,255,255,.25)}`}</style>
      <div style={{ position: "absolute", top: "calc(10px + env(safe-area-inset-top))", left: 12, right: 12, display: "flex", alignItems: "center", justifyContent: "space-between", color: "#fff" }}>
        <span style={{ fontSize: 13, fontWeight: 700, opacity: .85 }}>{title ? `${title} · ` : ""}{i + 1} / {n}</span>
        <button className="lb-btn" aria-label="Fermer" onClick={onClose}>×</button>
      </div>
      <img src={cur.url} alt={cur.caption || title || ""} onClick={e => { e.stopPropagation(); if (n > 1) go(1); }}
        style={{ maxWidth: "100%", maxHeight: "78vh", objectFit: "contain", borderRadius: 12, boxShadow: "0 20px 60px rgba(0,0,0,.6)", userSelect: "none" }} />
      {(cur.caption || cur.sub) && (
        <div style={{ color: "#fff", textAlign: "center", marginTop: 12 }} onClick={e => e.stopPropagation()}>
          {cur.caption && <p style={{ fontWeight: 800, fontSize: 16 }}>{cur.caption}</p>}
          {cur.sub && <p style={{ fontSize: 13, opacity: .8 }}>{cur.sub}</p>}
        </div>
      )}
      {n > 1 && (
        <>
          <button className="lb-btn" aria-label="Précédente" onClick={e => { e.stopPropagation(); go(-1); }} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)" }}>‹</button>
          <button className="lb-btn" aria-label="Suivante" onClick={e => { e.stopPropagation(); go(1); }} style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)" }}>›</button>
          <div style={{ display: "flex", gap: 6, marginTop: 12 }} onClick={e => e.stopPropagation()}>
            {list.map((_, k) => <button key={k} aria-label={`Photo ${k + 1}`} onClick={() => setI(k)} style={{ width: k === i ? 22 : 8, height: 8, padding: "12px 4px", boxSizing: "content-box", backgroundClip: "content-box", borderRadius: 4, border: "none", background: k === i ? "#FF6B2C" : "rgba(255,255,255,.4)", cursor: "pointer", transition: "width .2s" }} />)}
          </div>
        </>
      )}
    </div>
  );
}
