"use client";
/**
 * BrandContext — expose à toutes les pages le mode de l'instance, le restaurant lié et la marque.
 *
 *   const { single, ready, restaurant, brand, badge, timezone, refresh } = useBrand();
 *
 * Valeur initiale : celle lue côté serveur par le layout (ou le cache du navigateur), puis
 * revalidation auprès de l'API au montage. `ready` passe à vrai dès que la réponse de l'API
 * (ou le cache) est connue : la page client attend ce signal avant de choisir son accueil.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { fetchBrandingClient, normalize, readCachedBranding } from "./brand";
import { setRestaurantTimezone } from "./hours";
import { setTicketBrand } from "./ticket";

const BrandContext = createContext(null);

export function BrandProvider({ initial, children }) {
  const [state, setState] = useState(() => ({ data: normalize(initial), ready: false, error: null }));

  const refresh = useCallback(async () => {
    try {
      const data = await fetchBrandingClient();
      setState({ data, ready: true, error: null });
      return data;
    } catch (e) {
      // API injoignable : on garde la dernière marque connue (serveur ou cache) pour ne pas afficher une page vide
      setState((s) => ({ data: readCachedBranding() || s.data, ready: true, error: e.message }));
      return null;
    }
  }, []);

  useEffect(() => {
    const cached = readCachedBranding();
    if (cached) setState((s) => ({ ...s, data: cached }));
    refresh();
  }, [refresh]);

  useEffect(() => {
    setRestaurantTimezone(state.data.timezone);
    setTicketBrand({ single: state.data.single, appName: state.data.brand.app_name, badge: state.data.badge, platformName: state.data.platformName });
  }, [state.data]);

  const value = useMemo(() => ({
    ...state.data,
    ready: state.ready,
    error: state.error,
    refresh,
    /** Nom à afficher (marque en mode single, PickEatGo sinon). */
    appName: state.data.brand.app_name,
  }), [state, refresh]);

  return <BrandContext.Provider value={value}>{children}</BrandContext.Provider>;
}

export function useBrand() {
  const ctx = useContext(BrandContext);
  if (!ctx) throw new Error("useBrand must be used inside <BrandProvider>");
  return ctx;
}
