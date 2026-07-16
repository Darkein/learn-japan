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
//   2. applique la nouvelle version au PROCHAIN retour dans l'app (ou tout de suite si
//      l'onglet est déjà en arrière-plan) → jamais de rechargement en pleine lecture.
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
      document.addEventListener("visibilitychange", () => {
        if (document.hidden) return;
        // Au retour dans l'app : applique une MàJ en attente, sinon re-checke.
        if (pendingUpdate) updateSW(true);
        else checkForUpdate();
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
