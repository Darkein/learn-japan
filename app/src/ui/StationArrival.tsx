import type { RouteArrival } from "../lib/tokaido";
import { cityOf } from "../lib/trackInput";
import { Button } from "./kit/Button";
import { SectionLabel } from "./kit/SectionLabel";
import { Sheet } from "./kit/Sheet";
import { CityStamp } from "./track/Stamp";
import { ROUTE_KANA } from "./track/words";

interface Props {
  arrival: RouteArrival;
  onClose: () => void;
}

/**
 * Arrivée dans une ville de la route (SPEC §5c.5) : son tampon s'imprime (coupé sous
 * prefers-reduced-motion par la règle globale), puis son nom et un fait bref. Plusieurs villes
 * franchies d'un coup : une seule fiche, la dernière, qui cite les autres. Au terminus, la
 * fiche fête la route entière et le niveau (§5c.7). Aucun confetti (DESIGN.md §2).
 */
export function StationArrival({ arrival, onClose }: Props) {
  const { route, station, others, totals } = arrival;
  const last = station.index === route.stations.length - 1;
  const city = cityOf(route.level, station.index) ?? { kanji: station.kanji, size: "ville" as const, index: station.index };
  return (
    <Sheet open onClose={onClose}>
      <div className="flex flex-col items-center gap-4 px-2 py-6 text-center">
        <SectionLabel>
          {last ? `Terme du ${route.name}` : `Ville ${station.index} · ${route.name}`}
        </SectionLabel>
        <span className="stamp-pose" style={{ animationDelay: "0.25s" }}>
          <CityStamp city={city} size={last ? 104 : 88} />
        </span>
        <p className="text-sm text-muted">
          Tu arrives à <span className="text-text">{station.romaji}</span>
          {others.length > 0 && (
            <>
              {" "}— et tu as passé{" "}
              {others.map((o, i) => (
                <span key={o.index}>
                  {i > 0 ? (i === others.length - 1 ? " et " : ", ") : ""}
                  <span className="font-jp text-text">{o.kanji}</span>
                </span>
              ))}
            </>
          )}
          .
        </p>
        {last && (
          <div className="flex flex-col items-center gap-1">
            <ruby className="track-ruby font-jp text-xl text-text">
              {route.kanji}踏破
              <rt>{ROUTE_KANA[route.level]} とうは</rt>
            </ruby>
            <p className="font-serif text-lg text-text">
              Le {route.name} est fait. Niveau N{route.level} terminé.
            </p>
            <p className="text-sm text-muted">
              {route.stations.length - 1} tampons · {totals.steps} étapes · {totals.lessons} leçons
            </p>
          </div>
        )}
        {station.note && <p className="max-w-sm text-sm leading-relaxed text-muted">{station.note}</p>}
        <Button variant="primary" onClick={onClose}>
          {last ? "Contempler le chemin" : "Continuer la route"}
        </Button>
      </div>
    </Sheet>
  );
}
