"use client";
/**
 * InputGuard — impose un modèle de saisie aux champs qui n'acceptent qu'un format :
 *   inputMode="numeric"  → chiffres uniquement (quantités, PIN, seuils)
 *   inputMode="decimal"  → chiffres et un seul séparateur décimal (prix, kg…), la virgule devient un point
 *   type="tel"           → chiffres, +, espaces, points, tirets, parenthèses
 * Le caractère interdit est bloqué avant d'apparaître (beforeinput) et la valeur est
 * nettoyée à la saisie / au collage (input). Fonctionne avec les champs contrôlés React.
 */
import { useEffect } from "react";

const MODES = {
  numeric: (v) => v.replace(/\D/g, ""),
  decimal: (v) => {
    let s = v.replace(/,/g, ".").replace(/[^\d.]/g, "");
    const i = s.indexOf(".");
    if (i !== -1) s = s.slice(0, i + 1) + s.slice(i + 1).replace(/\./g, "");
    return s;
  },
  tel: (v) => v.replace(/[^\d+\s().-]/g, ""),
};

function modeOf(el) {
  if (!el || el.tagName !== "INPUT") return null;
  const im = (el.getAttribute("inputmode") || "").toLowerCase();
  if (im === "numeric" || im === "decimal") return im;
  if ((el.getAttribute("type") || "").toLowerCase() === "tel") return "tel";
  return null;
}

export default function InputGuard() {
  useEffect(() => {
    const onBeforeInput = (e) => {
      const mode = modeOf(e.target);
      if (!mode || e.data == null) return;
      const allowed = MODES[mode](e.data.replace(/,/g, mode === "decimal" ? "." : ","));
      // Un point / une virgule supplémentaire est refusé si le champ en a déjà un
      const dupDot = mode === "decimal" && /\./.test(allowed) && e.target.value.includes(".");
      if (allowed !== (mode === "decimal" ? e.data.replace(/,/g, ".") : e.data) || dupDot) e.preventDefault();
    };
    const onInput = (e) => {
      const mode = modeOf(e.target);
      if (!mode) return;
      const clean = MODES[mode](e.target.value);
      if (clean !== e.target.value) {
        const pos = e.target.selectionStart;
        e.target.value = clean;                       // React relit la valeur nettoyée dans son onChange
        try { e.target.setSelectionRange(Math.min(pos || 0, clean.length), Math.min(pos || 0, clean.length)); } catch {}
      }
    };
    document.addEventListener("beforeinput", onBeforeInput, true);
    document.addEventListener("input", onInput, true);
    return () => { document.removeEventListener("beforeinput", onBeforeInput, true); document.removeEventListener("input", onInput, true); };
  }, []);
  return null;
}
