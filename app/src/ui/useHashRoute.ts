import { useSyncExternalStore } from "react";

// Routage par hash (`#/...`). Choix volontaire : le fragment d'URL ne touche jamais
// le serveur, donc le rechargement d'une « page » profonde fonctionne sur n'importe quel
// hébergement statique (GitLab Pages, GitHub Pages) sans règle de réécriture vers index.html.

export type Tab = "home" | "stories" | "articles" | "catalogue";

export type Route =
  | { kind: "home" }
  | { kind: "stories" }
  | { kind: "articles" }
  | { kind: "catalogue" }
  | { kind: "review"; from: string }
  | { kind: "exam"; id: string; from: string }
  | { kind: "course"; id: string; from: string }
  | { kind: "reader"; id: string; from: string }
  | { kind: "settings"; from: string }
  | { kind: "stats"; from: string }
  | { kind: "voyage"; from: string }
  | { kind: "flow"; from: string; activite?: string };

/** Emplacement courant (sans le « # »), normalisé avec un « / » initial. */
export function currentLocation(): string {
  const raw = window.location.hash.replace(/^#/, "");
  return raw.startsWith("/") ? raw : `/${raw}`;
}

/** Change de route. `to` est un chemin de hash (ex. "/catalogue", "/cours/n5-01").
 *  `restore` marque un RETOUR (bouton « Retour » de l'app) : la page cible se rouvre à la
 *  position mémorisée au lieu de repartir du haut. Voir `initScrollRestoration`. */
export function navigate(to: string, opts?: { restore?: boolean }): void {
  const path = to.startsWith("/") ? to : `/${to}`;
  if (currentLocation() === path) return;
  // Photographie de la position AVANT que React ne démonte la page : dès le clic, la page
  // sortante rétrécit et le navigateur écrête le défilement (on retrouverait sinon une
  // position tronquée au retour).
  rememberScroll();
  pendingIntent = opts?.restore ? "restore" : "top";
  window.location.hash = path;
}

// ---- Défilement : en haut à l'aller, à sa place au retour --------------------------
// Changer le hash ne repositionne pas la page : sans ce qui suit, ouvrir une leçon depuis
// le bas du catalogue affichait la leçon déjà défilée. On remet donc la page en haut à
// chaque navigation « avant », et on restaure la position mémorisée au retour (bouton
// Retour de l'app comme du navigateur) — la liste d'origine se rouvre là où on l'a laissée.

type ScrollIntent = "top" | "restore";

const scrollMemory = new Map<string, number>();
/** Intention posée par `navigate` pour le prochain `hashchange` (null = bouton du navigateur). */
let pendingIntent: ScrollIntent | null = null;
/** Emplacement auquel attribuer le défilement observé (mis à jour APRÈS le changement de hash). */
let trackedLocation = "/";
/** Délai max pour retrouver une position : les listes se peuplent depuis IndexedDB
 *  APRÈS le premier rendu (mesuré : ~600 ms pour le catalogue complet), la page n'est donc
 *  pas encore assez haute pour y redescendre. Au-delà, on abandonne plutôt que de voler le
 *  défilement à l'utilisateur. */
const RESTORE_TIMEOUT_MS = 1500;

/** Mémorise la position courante pour l'emplacement suivi. */
function rememberScroll(): void {
  scrollMemory.set(trackedLocation, window.scrollY);
}

let restoreFrame = 0;
let stopRestoreWatch: (() => void) | null = null;

function cancelRestore(): void {
  if (restoreFrame) cancelAnimationFrame(restoreFrame);
  restoreFrame = 0;
  stopRestoreWatch?.();
  stopRestoreWatch = null;
}

function restoreScroll(y: number): void {
  if (y <= 0) {
    window.scrollTo(0, 0);
    return;
  }
  const deadline = performance.now() + RESTORE_TIMEOUT_MS;
  // Un geste de l'utilisateur pendant la restauration l'emporte : on arrête d'insister.
  const gestures = ["wheel", "touchstart", "keydown"] as const;
  const abort = () => cancelRestore();
  for (const g of gestures) window.addEventListener(g, abort, { passive: true });
  stopRestoreWatch = () => {
    for (const g of gestures) window.removeEventListener(g, abort);
  };
  const step = () => {
    restoreFrame = 0;
    window.scrollTo(0, y);
    // Page encore trop courte (contenu asynchrone) → nouvelle tentative à la frame suivante.
    if (Math.abs(window.scrollY - y) > 1 && performance.now() < deadline) {
      restoreFrame = requestAnimationFrame(step);
    } else {
      cancelRestore();
    }
  };
  step();
}

/** Installe la gestion du défilement entre pages. À appeler une fois au montage de l'app ;
 *  renvoie la fonction de désinstallation. */
export function initScrollRestoration(): () => void {
  if (typeof window === "undefined") return () => {};
  // On pilote le défilement nous-mêmes : sinon le navigateur restaure sa propre position
  // sur les entrées d'historique (et au rechargement d'une page profonde) et entre en
  // conflit avec la mémoire ci-dessous.
  if ("scrollRestoration" in history) history.scrollRestoration = "manual";
  trackedLocation = currentLocation();

  const onScroll = () => {
    // Navigation en vol (position déjà photographiée par `navigate`) : les défilements
    // observés ici sont ceux du navigateur qui écrête la page sortante, pas ceux de
    // l'utilisateur — on ne les mémorise pas.
    if (pendingIntent === null) rememberScroll();
  };
  const onHashChange = () => {
    // Aucune intention posée par `navigate` → boutons Précédent/Suivant du navigateur :
    // on traite comme un retour (position mémorisée).
    const intent = pendingIntent ?? "restore";
    pendingIntent = null;
    cancelRestore();
    trackedLocation = currentLocation();
    if (intent === "top") {
      scrollMemory.delete(trackedLocation);
      window.scrollTo(0, 0);
    } else {
      restoreScroll(scrollMemory.get(trackedLocation) ?? 0);
    }
  };

  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("hashchange", onHashChange);
  return () => {
    cancelRestore();
    window.removeEventListener("scroll", onScroll);
    window.removeEventListener("hashchange", onHashChange);
  };
}

function parseRoute(location: string): Route {
  const [path, query] = location.split("?");
  const params = new URLSearchParams(query ?? "");
  const from = params.get("from") ? decodeURIComponent(params.get("from")!) : "/";
  const segs = path.split("/").filter(Boolean);

  switch (segs[0]) {
    case "histoires":
      return { kind: "stories" };
    case "articles":
      return { kind: "articles" };
    case "catalogue":
      return { kind: "catalogue" };
    case "revision":
      return { kind: "review", from };
    case "controle":
      return segs[1] ? { kind: "exam", id: decodeURIComponent(segs[1]), from } : { kind: "home" };
    case "cours":
      return segs[1]
        ? { kind: "course", id: decodeURIComponent(segs[1]), from }
        : { kind: "home" };
    case "lecture":
      return segs[1]
        ? { kind: "reader", id: decodeURIComponent(segs[1]), from }
        : { kind: "home" };
    case "parametres":
      return { kind: "settings", from };
    case "stats":
      return { kind: "stats", from };
    case "voyage":
      return { kind: "voyage", from };
    case "flux":
      return { kind: "flow", from, activite: params.get("activite") ?? undefined };
    default:
      return { kind: "home" };
  }
}

/** Route courante, dérivée du hash (utilisable hors React). */
export function currentRoute(): Route {
  return parseRoute(currentLocation());
}

/** Écrans « activité en cours » — lecture d'une histoire ou d'une leçon, session de flux,
 *  révision. On évite d'appliquer une mise à jour (qui recharge la page) tant que l'un
 *  d'eux est ouvert, pour ne pas faire perdre à l'utilisateur sa place ou sa saisie. */
export function isFocusedActivityRoute(route: Route): boolean {
  return (
    route.kind === "reader" ||
    route.kind === "course" ||
    route.kind === "flow" ||
    route.kind === "review" ||
    route.kind === "exam"
  );
}

/** Onglet correspondant à une route (les sous-pages n'ont pas d'onglet propre). */
export function tabForRoute(route: Route): Tab {
  switch (route.kind) {
    case "stories":
      return "stories";
    case "articles":
      return "articles";
    case "catalogue":
      return "catalogue";
    default:
      return "home";
  }
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener("hashchange", onChange);
  return () => window.removeEventListener("hashchange", onChange);
}

/** Route courante, ré-évaluée à chaque changement de hash. */
export function useHashRoute(): Route {
  const location = useSyncExternalStore(subscribe, currentLocation, () => "/");
  return parseRoute(location);
}
