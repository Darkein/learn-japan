import { useEffect, useState } from "react";
import { bumpSrsDaily, getSrsDaily, localDateString } from "../lib/db";

const TICK_MS = 60_000;

/**
 * Horloge du flux d'étude : chaque minute VISIBLE passée dans le flux est créditée dans
 * srsDaily.flowMs (l'onglet caché ne compte pas). Ne mesure que le temps dans FlowSession —
 * le temps « app totale » n'est volontairement pas suivi.
 * Renvoie le total du jour (ms), rafraîchi à chaque tick.
 */
export function useFlowClock(): number {
  const [total, setTotal] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void getSrsDaily(localDateString()).then((d) => {
      if (!cancelled) setTotal(d?.flowMs ?? 0);
    });
    const id = setInterval(() => {
      if (document.visibilityState !== "visible") return;
      void bumpSrsDaily(localDateString(), { flowMs: TICK_MS }).then(() => {
        if (!cancelled) setTotal((t) => t + TICK_MS);
      });
    }, TICK_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  return total;
}
