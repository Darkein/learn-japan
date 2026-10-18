import { routeForLevel } from "../../data/routes";
import { cityOf } from "../../lib/trackInput";
import { Button } from "../kit/Button";
import { SectionLabel } from "../kit/SectionLabel";
import { Sheet } from "../kit/Sheet";
import { CityStamp } from "./Stamp";

interface Props {
  level: number;
  index: number;
  /** Tampon déjà obtenu ? Sinon la fiche montre son emplacement vide. */
  stamped: boolean;
  /** Étapes qui restent avant d'y arriver (prochaine ville). */
  stepsToGo?: number;
  onClose: () => void;
}

/** Fiche d'une ville de la route (SPEC §5c.2, §5c.5) : son tampon, son nom, un fait bref. */
export function CityFiche({ level, index, stamped, stepsToGo, onClose }: Props) {
  const route = routeForLevel(level);
  const station = route.stations[index];
  const city = cityOf(level, index);
  if (!station || !city) return null;
  return (
    <Sheet open onClose={onClose}>
      <div className="flex flex-col items-center gap-4 px-2 py-6 text-center">
        <SectionLabel>
          {index === 0 ? `Départ du ${route.name}` : `Ville ${index} · ${route.name}`}
        </SectionLabel>
        <CityStamp city={city} size={88} empty={!stamped && index > 0} />
        <p className="flex flex-col items-center gap-0.5">
          <ruby className="track-ruby font-jp text-2xl text-text">
            {station.kanji}
            {city.kana && <rt>{city.kana}</rt>}
          </ruby>
          <span className="text-sm text-muted">{station.romaji}</span>
        </p>
        {station.note && <p className="max-w-sm text-sm leading-relaxed text-muted">{station.note}</p>}
        {!stamped && index > 0 && (
          <p className="text-sm text-muted">
            {stepsToGo != null
              ? `Son tampon t'attend dans ${stepsToGo} étape${stepsToGo > 1 ? "s" : ""}.`
              : "Son tampon t'attend plus loin sur la route."}
          </p>
        )}
        <Button onClick={onClose}>Fermer</Button>
      </div>
    </Sheet>
  );
}
