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
// Deux volets, volontairement découplés :
//   - DÉTECTION : on demande au navigateur de re-vérifier le service worker au
//     chargement (immediate), périodiquement, à la reconnexion réseau, à chaque
//     changement de visibilité et à chaque navigation interne. C'est ce qui manquait :
//     sans ces déclencheurs, un onglet / une PWA restée ouverte ne re-vérifiait qu'au
//     relancement complet.
//   - APPLICATION : dès qu'une nouvelle version est installée et prête (`onNeedRefresh`),
//     on l'active tout de suite. `registration.update()` étant asynchrone, on ne peut
//     pas décider d'appliquer « dans le même geste » que la détection ; appliquer
//     immédiatement à la détection garantit qu'un seul aller-retour (ou une seule
//     navigation) suffit, sur mobile comme sur desktop. `updateSW(true)` envoie
//     SKIP_WAITING au SW en attente (voir src/sw.ts) puis recharge la page une seule
//     fois quand le nouveau SW prend le contrôle.
if (import.meta.env.PROD) {
  const UPDATE_CHECK_INTERVAL_MS = 30 * 60 * 1000; // 30 min

  const updateSW = registerSW({
    immediate: true,
    onRegisteredSW(_swUrl, registration) {
      if (!registration) return;
      const checkForUpdate = () => {
        if (navigator.onLine) registration.update().catch(() => {});
      };
      setInterval(checkForUpdate, UPDATE_CHECK_INTERVAL_MS);
      window.addEventListener("online", checkForUpdate);
      // Changement de visibilité (départ ET retour au premier plan) et navigation interne
      // (routing par hash) : autant d'occasions de re-vérifier rapidement.
      document.addEventListener("visibilitychange", checkForUpdate);
      window.addEventListener("hashchange", checkForUpdate);
    },
    onNeedRefresh() {
      updateSW(true);
    },
  });
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
