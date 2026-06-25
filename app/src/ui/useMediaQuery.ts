import { useEffect, useState } from "react";

/**
 * Abonnement réactif à une media query (matchMedia). Renvoie `true` quand la
 * requête correspond. Utilisé pour basculer entre vue splittée (desktop) et
 * navigation par page (mobile) sans router.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() =>
    typeof window !== "undefined" ? window.matchMedia(query).matches : false,
  );

  useEffect(() => {
    const mql = window.matchMedia(query);
    const onChange = () => setMatches(mql.matches);
    onChange();
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, [query]);

  return matches;
}
