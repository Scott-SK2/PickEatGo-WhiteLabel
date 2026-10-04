"use client";
/**
 * lib/hooks.js — Hooks React de la page client
 * Usage : const { data, loading, error, refetch } = useRestaurants({ status: "active" })
 */
import { useState, useEffect, useCallback, useRef } from "react";
import { restaurantApi, orderApi } from "./api";

// ─── Hook générique : exécute une promesse et expose data / loading / error ──
function useAsync(asyncFn, deps = [], opts = {}) {
  const { immediate = true, initialData = null } = opts;
  const [data,    setData]    = useState(initialData);
  const [loading, setLoading] = useState(immediate);
  const [error,   setError]   = useState(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const execute = useCallback(async (...args) => {
    setLoading(true);
    setError(null);
    try {
      const result = await asyncFn(...args);
      if (mountedRef.current) setData(result);
      return result;
    } catch (err) {
      if (mountedRef.current) setError(err.message || "Erreur inconnue");
      throw err;
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => {
    if (immediate) execute();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [immediate, ...deps]);

  return { data, loading, error, refetch: execute, setData };
}

// ─── Liste des restaurants (page d'accueil, recherche) ────────────────────────
export function useRestaurants(params = {}) {
  const key = JSON.stringify(params);
  return useAsync(
    () => restaurantApi.list(params),
    [key],
    { initialData: { results: [], count: 0 } }
  );
}

// ─── Création de commande (panier) ────────────────────────────────────────────
export function useCreateOrder() {
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState(null);

  const createOrder = async (orderData) => {
    setLoading(true);
    setError(null);
    try {
      return await orderApi.create(orderData);
    } catch (err) {
      setError(err.message);
      throw err;
    } finally {
      setLoading(false);
    }
  };

  return { createOrder, loading, error };
}
