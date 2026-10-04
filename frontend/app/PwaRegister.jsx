"use client";
import { useEffect } from "react";
import { registerServiceWorker } from "../lib/push";

/** Enregistre le service worker (PWA + notifications push) au chargement. */
export default function PwaRegister() {
  useEffect(() => { registerServiceWorker(); }, []);
  return null;
}
