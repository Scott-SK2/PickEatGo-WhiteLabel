"use client";
import { ensureFreshToken } from "./api";
import { useEffect, useRef, useState } from "react";

const WS_BASE        = (process.env.NEXT_PUBLIC_WS_URL || "ws://localhost:8000").replace(/\/+$/, "");
const DEBUG          = process.env.NODE_ENV !== "production";
const PING_INTERVAL  = 10000;  // Détecte les connexions mortes plus vite (10s)
const POLL_INTERVAL  = 5000;   // Polling toutes les 5s
const MAX_RECONNECT  = 60000;  // Délai max de reconnexion (1 min)

export function useOrderWebSocket({ onNewOrder, onStatusUpdate, pollFn, enabled = true } = {}) {
  const [connected, setConnected] = useState(false);
  const wsRef           = useRef(null);
  const pingRef         = useRef(null);
  const reconnRef       = useRef(null);
  const pollRef         = useRef(null);
  const mountedRef      = useRef(true);
  const failCountRef    = useRef(0);
  const startPollingRef = useRef(null); // exposé pour l'appeler depuis l'effet pollFn

  const onNewOrderRef     = useRef(onNewOrder);
  const onStatusUpdateRef = useRef(onStatusUpdate);
  const pollFnRef         = useRef(pollFn);
  const enabledRef        = useRef(enabled);
  // Détecte la transition null → non-null de pollFn
  const pollFnWasNullRef  = useRef(pollFn === null || pollFn === undefined);

  useEffect(() => { onNewOrderRef.current = onNewOrder; }, [onNewOrder]);
  useEffect(() => { onStatusUpdateRef.current = onStatusUpdate; }, [onStatusUpdate]);
  const connectRef = useRef(null);
  useEffect(() => {
    enabledRef.current = enabled;
    if (enabled && connectRef.current) connectRef.current();                 // le restaurant vient d'arriver : on se connecte
    if (!enabled && wsRef.current && wsRef.current.readyState < 2) wsRef.current.close(1000, "disabled");
  }, [enabled]);

  // Quand pollFn passe de null → non-null (user vient de charger, ou nouvelle commande),
  // on démarre le polling et on fait un appel immédiat pour synchroniser l'état.
  useEffect(() => {
    const wasNull = pollFnWasNullRef.current;
    pollFnWasNullRef.current = (pollFn === null || pollFn === undefined);
    pollFnRef.current = pollFn;

    if (pollFn && wasNull) {
      // Transition null → non-null : démarrer le polling et appeler immédiatement
      if (startPollingRef.current) startPollingRef.current();
    }
  }, [pollFn]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    mountedRef.current = true;

    const getToken = () =>
      typeof window !== "undefined" ? localStorage.getItem("access") : null;

    const clearTimers = () => {
      clearInterval(pingRef.current);
      clearTimeout(reconnRef.current);
    };

    // Démarre l'intervalle de polling.
    // L'intervalle tourne toujours quand il y a une commande active ;
    // il sert de filet de sécurité en cas de message WS perdu.
    const startPolling = () => {
      if (pollRef.current) return; // déjà en cours
      if (DEBUG) console.log("[WS] 📡 Polling actif (toutes les", POLL_INTERVAL / 1000, "s)");
      pollRef.current = setInterval(() => {
        if (mountedRef.current && pollFnRef.current) pollFnRef.current();
      }, POLL_INTERVAL);
      // Appel immédiat pour synchroniser l'état courant
      if (pollFnRef.current) pollFnRef.current();
    };

    // Expose startPolling à l'effet pollFn (pour la transition null→non-null)
    startPollingRef.current = startPolling;

    const stopPolling = () => {
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    };

    const connect = async () => {
      if (!mountedRef.current || !enabledRef.current) return;
      if (wsRef.current && wsRef.current.readyState <= 1) return;
      const token = await ensureFreshToken();          // un jeton expiré ferait refuser la connexion en boucle
      if (!token || !mountedRef.current || !enabledRef.current) return;
      if (wsRef.current && wsRef.current.readyState <= 1) return;

      // Le jeton est envoyé dans le premier message, jamais dans l'URL (qui finit dans les journaux du serveur)
      const ws = new WebSocket(`${WS_BASE}/ws/orders/`);
      wsRef.current = ws;

      ws.onopen = () => {
        if (!mountedRef.current) { ws.close(1000); return; }
        ws.send(JSON.stringify({ type: "auth", token }));
      };

      ws.onmessage = (event) => {
        if (!mountedRef.current) return;
        try {
          const data = JSON.parse(event.data);
          if (data.type === "connection_established") {
            if (DEBUG) console.log("[WS] ✅ Connecté — mises à jour en temps réel actives");
            failCountRef.current = 0;
            setConnected(true);
            // Le polling continue même quand WS est connecté (filet de sécurité)
            clearInterval(pingRef.current);
            pingRef.current = setInterval(() => {
              if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "ping" }));
            }, PING_INTERVAL);
          } else if (data.type === "new_order" && onNewOrderRef.current) {
            onNewOrderRef.current(data.order);
          } else if (data.type === "status_update" && onStatusUpdateRef.current) {
            onStatusUpdateRef.current(data.order);
          }
        } catch {}
      };

      ws.onclose = (event) => {
        if (!mountedRef.current) return;
        if (DEBUG) console.log("[WS] 🔴 Fermé code:", event.code);
        clearInterval(pingRef.current);
        setConnected(false);
        // 4001 = jeton refusé : ensureFreshToken() en obtiendra un nouveau à la prochaine tentative
        if (event.code !== 1000 && mountedRef.current) {
          failCountRef.current++;
          // Backoff exponentiel : 3s → 6s → 12s → ... → 60s max
          const delay = Math.min(3000 * Math.pow(2, failCountRef.current - 1), MAX_RECONNECT);
          reconnRef.current = setTimeout(connect, delay);
        }
      };

      ws.onerror = () => { /* onclose sera appelé */ };
    };
    connectRef.current = connect;

    // Si pollFn est déjà non-null au montage (commande en cours depuis localStorage),
    // démarrer le polling immédiatement.
    if (pollFnRef.current) startPolling();
    // Tente la connexion WS 500ms après le montage
    const initTimer = setTimeout(connect, 500);

    return () => {
      mountedRef.current = false;
      clearTimeout(initTimer);
      clearTimers();
      stopPolling();
      if (wsRef.current && wsRef.current.readyState < 2) {
        wsRef.current.close(1000, "unmount");
      }
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return { connected };
}
