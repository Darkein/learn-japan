import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { registerSW } from "virtual:pwa-register";
import "./styles/global.css";
import { App } from "./ui/App";

// ---- Mise à jour automatique de la PWA (web, PWA installée, Chrome mobile) --------
// Le problème historique : sans vérification périodique, un onglet / une PWA restée
// ouverte ne re-checkait le service worker qu'au relancement complet → il fallait
// recharger plusieurs fois avant que la nouvelle version soit prise en compte.
//
// Ici on enregistre explicitement le SW et on :
//   1. vérifie les mises à jour périodiquement, au retour de focus et à la reconnexion ;
//   2. applique la nouvelle version à un moment sûr — retour dans l'app, navigation
//      interne, ou tout de suite si l'onglet est en arrière-plan → jamais de
//      rechargement en pleine lecture.
// `updateSW(true)` envoie SKIP_WAITING au SW en attente (voir src/sw.ts) puis recharge
// la page une seule fois quand le nouveau SW prend le contrôle.
if (import.meta.env.PROD) {
  const UPDATE_CHECK_INTERVAL_MS = 30 * 60 * 1000; // 30 min
  let pendingUpdate = false;

  const updateSW = registerSW({
    immediate: true,
    onRegisteredSW(_swUrl, registration) {
      if (!registration) return;
      const checkForUpdate = () => {
        if (navigator.onLine) registration.update().catch(() => {});
      };
      setInterval(checkForUpdate, UPDATE_CHECK_INTERVAL_MS);
      window.addEventListener("online", checkForUpdate);
      // Retour dans l'app (onglet/PWA repassé au premier plan) : applique une MàJ en
      // attente, sinon re-checke.
      document.addEventListener("visibilitychange", () => {
        if (document.hidden) return;
        if (pendingUpdate) updateSW(true);
        else checkForUpdate();
      });
      // Navigation interne (routing par hash) : moment idéal — entre deux écrans — pour
      // appliquer une MàJ en attente même si l'app reste au premier plan (desktop web).
      window.addEventListener("hashchange", () => {
        if (pendingUpdate) updateSW(true);
      });
    },
    onNeedRefresh() {
      pendingUpdate = true;
      // App en arrière-plan → l'utilisateur ne lit rien : on applique immédiatement.
      if (document.hidden) updateSW(true);
    },
  });
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
