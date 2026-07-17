import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { registerSW } from "virtual:pwa-register";
import "./styles/global.css";
import { App } from "./ui/App";
import { initTuning } from "./lib/tuning";
import { currentRoute, isFocusedActivityRoute } from "./ui/useHashRoute";

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
//     on l'active tout de suite — SAUF si une activité est en cours (lecture d'une
//     histoire/leçon, flux, révision) : dans ce cas on diffère jusqu'à ce que
//     l'utilisateur en sorte, pour ne pas recharger en pleine lecture et lui faire
//     perdre sa place. `registration.update()` étant asynchrone, appliquer dès la
//     détection (plutôt que d'attendre l'événement suivant) garantit qu'un seul
//     aller-retour, ou une seule navigation, suffit — sur mobile comme sur desktop.
//     `updateSW(true)` envoie SKIP_WAITING au SW en attente (voir src/sw.ts) puis
//     recharge la page une seule fois quand le nouveau SW prend le contrôle.
if (import.meta.env.PROD) {
  const UPDATE_CHECK_INTERVAL_MS = 30 * 60 * 1000; // 30 min
  let pendingUpdate = false;

  const isBusy = () => isFocusedActivityRoute(currentRoute());

  const updateSW = registerSW({
    immediate: true,
    onRegisteredSW(_swUrl, registration) {
      if (!registration) return;
      const checkForUpdate = () => {
        if (navigator.onLine) registration.update().catch(() => {});
      };
      // Applique une MàJ différée si l'utilisateur n'est plus en pleine activité.
      const applyIfSafe = () => {
        if (pendingUpdate && !isBusy()) updateSW(true);
      };
      setInterval(checkForUpdate, UPDATE_CHECK_INTERVAL_MS);
      window.addEventListener("online", checkForUpdate);
      // Changement de visibilité (départ ET retour au premier plan) et navigation interne
      // (routing par hash) : occasions de re-vérifier ET d'appliquer une MàJ différée à
      // un moment sûr — quitter une histoire/leçon est justement une telle occasion.
      document.addEventListener("visibilitychange", () => {
        applyIfSafe();
        checkForUpdate();
      });
      window.addEventListener("hashchange", () => {
        applyIfSafe();
        checkForUpdate();
      });
    },
    onNeedRefresh() {
      // En pleine activité → on diffère ; sinon on applique tout de suite.
      if (isBusy()) pendingUpdate = true;
      else updateSW(true);
    },
  });
}

// Auto-réglage du SRS : applique la cible de rétention stockée puis, si périmée, la recalcule
// à partir du taux d'erreur mesuré (voir lib/tuning.ts). Non bloquant.
if (typeof indexedDB !== "undefined") void initTuning();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
