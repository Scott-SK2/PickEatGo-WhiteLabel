"use client";
/**
 * useHistoryPage — relie l'écran courant (état React) à l'historique du navigateur.
 * Chaque changement d'écran crée une entrée : le bouton Retour du téléphone revient
 * à l'écran précédent au lieu de quitter le site. Au rechargement, l'écran est
 * restauré depuis l'URL (#écran) au lieu de repartir de l'accueil.
 *
 *   useHistoryPage(page, setPage, { home: "home", replace: ["confirm"], pages: [...] })
 *   - replace : écrans qui remplacent l'entrée courante (on ne revient pas dessus)
 *   - pages   : écrans restaurables depuis l'URL (tous si omis)
 */
import { useEffect, useRef } from "react";

/** Écran indiqué par l'URL courante (#écran), ou null. */
export function pageFromUrl() {
  if (typeof window === "undefined") return null;
  const h = decodeURIComponent(window.location.hash.replace(/^#/, "")).trim();
  return h || null;
}

export function useHistoryPage(page, setPage, { home = "home", replace = [], pages = null } = {}) {
  const fromPop = useRef(false);
  const ready = useRef(false);

  useEffect(() => {
    const onPop = (e) => {
      fromPop.current = true;
      // Entrée sans écran mémorisé (ancre tapée dans la barre d'adresse, lien #écran) : on lit l'URL
      const fromUrl = pageFromUrl();
      setPage((e.state && e.state.page) || (fromUrl && (!pages || pages.includes(fromUrl)) ? fromUrl : home));
    };
    window.addEventListener("popstate", onPop);
    // Rechargement : on reprend l'écran indiqué par l'URL
    const fromUrl = pageFromUrl();
    const restored = fromUrl && fromUrl !== page && (!pages || pages.includes(fromUrl)) ? fromUrl : page;
    if (restored !== page) { fromPop.current = true; setPage(restored); }
    // On conserve les données propres au routeur Next.js (sinon il recharge la page)
    window.history.replaceState({ ...(window.history.state || {}), page: restored }, "");
    ready.current = true;
    return () => window.removeEventListener("popstate", onPop);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!ready.current) return;
    if (fromPop.current) { fromPop.current = false; return; }
    if (window.history.state && window.history.state.page === page) return;
    const url = page === home ? window.location.pathname : `${window.location.pathname}#${page}`;
    const base = window.history.state || {};
    if (replace.includes(page)) window.history.replaceState({ ...base, page }, "", url);
    else window.history.pushState({ ...base, page }, "", url);
  }, [page]); // eslint-disable-line react-hooks/exhaustive-deps
}
