import { useSyncExternalStore } from "react";

// Routage par hash (`#/...`). Choix volontaire : le fragment d'URL ne touche jamais
// le serveur, donc le rechargement d'une « page » profonde fonctionne sur n'importe quel
// hébergement statique (GitLab Pages, GitHub Pages) sans règle de réécriture vers index.html.

export type Tab = "home" | "stories" | "catalogue";

export type Route =
  | { kind: "home" }
  | { kind: "stories" }
  | { kind: "catalogue" }
  | { kind: "review"; from: string }
  | { kind: "course"; id: string; from: string }
  | { kind: "reader"; id: string; from: string }
  | { kind: "settings"; from: string }
  | { kind: "stats"; from: string }
  | { kind: "voyage"; from: string };

/** Emplacement courant (sans le « # »), normalisé avec un « / » initial. */
export function currentLocation(): string {
  const raw = window.location.hash.replace(/^#/, "");
  return raw.startsWith("/") ? raw : `/${raw}`;
}

/** Change de route. `to` est un chemin de hash (ex. "/catalogue", "/cours/n5-01"). */
export function navigate(to: string): void {
  const path = to.startsWith("/") ? to : `/${to}`;
  if (currentLocation() === path) return;
  window.location.hash = path;
}

function parseRoute(location: string): Route {
  const [path, query] = location.split("?");
  const params = new URLSearchParams(query ?? "");
  const from = params.get("from") ? decodeURIComponent(params.get("from")!) : "/";
  const segs = path.split("/").filter(Boolean);

  switch (segs[0]) {
    case "histoires":
      return { kind: "stories" };
    case "catalogue":
      return { kind: "catalogue" };
    case "revision":
      return { kind: "review", from };
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
    default:
      return { kind: "home" };
  }
}

/** Onglet correspondant à une route (les sous-pages n'ont pas d'onglet propre). */
export function tabForRoute(route: Route): Tab {
  switch (route.kind) {
    case "stories":
      return "stories";
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
