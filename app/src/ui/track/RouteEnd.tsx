import { routeForLevel } from "../../data/routes";
import { cityOf } from "../../lib/trackInput";
import { Button } from "../kit/Button";
import { CityStamp } from "./Stamp";
import { ROUTE_KANA } from "./words";

interface Props {
  level: number;
  nextLevel?: number;
  reached: boolean;
  totals: { steps: number; lessons: number };
  onOpenCarnet: () => void;
}

/**
 * Fin de route sur la voie (SPEC §5c.7) : la carte de fin, qui reste dans le fil une fois la
 * route faite, puis le panneau de correspondance vers la route du niveau suivant. Placée sous
 * le butoir ; la nouvelle voie part juste en dessous, de sa ville de départ.
 */
export function RouteEnd({ level, nextLevel, reached, totals, onOpenCarnet }: Props) {
  const route = routeForLevel(level);
  const span = route.stations.length - 1;
  const terminus = cityOf(level, span) ?? { kanji: route.stations[span].kanji, size: "terminus" as const, index: span };
  const next = nextLevel ? routeForLevel(nextLevel) : undefined;
  return (
    <div className="flex h-full flex-col gap-10 px-4 pt-10">
      <section className="flex items-start gap-4 rounded-md border border-hairline bg-surface p-4 shadow-elev">
        <span className="mt-1 shrink-0">
          <CityStamp city={terminus} size={84} empty={!reached} />
        </span>
        <div className="flex min-w-0 flex-col gap-2">
          <ruby className="track-ruby font-jp text-xl text-text">
            {route.kanji}踏破
            <rt>{ROUTE_KANA[level]} とうは</rt>
          </ruby>
          {reached ? (
            <>
              <span className="font-serif text-lg leading-snug">
                Le {route.name} est fait. Niveau N{level} terminé.
              </span>
              <span className="text-xs text-muted">
                {span} tampons · {totals.steps} étapes · {totals.lessons} leçons
              </span>
              <Button size="sm" className="self-start" onClick={onOpenCarnet}>
                Ouvrir mon carnet
              </Button>
            </>
          ) : (
            <span className="text-sm text-muted">
              Au bout du niveau N{level}, le tampon de {route.arriveFr} attend : {span} villes,{" "}
              {totals.steps} étapes.
            </span>
          )}
        </div>
      </section>

      {next && (
        <section className="flex flex-col items-center gap-1 text-center">
          <div className="flex w-full items-center gap-2.5">
            <span className="h-px flex-1 bg-hairline" />
            <span className="text-xs uppercase tracking-wide text-muted">
              <span className="font-jp normal-case tracking-normal">乗り換え</span> · Correspondance
            </span>
            <span className="h-px flex-1 bg-hairline" />
          </div>
          <span className="text-base">
            <strong className="font-semibold">Niveau N{next.level}</strong> ·{" "}
            <ruby className="track-ruby font-jp">
              {next.kanji}
              <rt>{ROUTE_KANA[next.level]}</rt>
            </ruby>{" "}
            {next.name}
          </span>
          <span className="text-xs text-muted">
            {next.tagline} · {next.stations.length - 1} villes
          </span>
        </section>
      )}
    </div>
  );
}

/** Bout du curriculum (SPEC §5c.7) : la voie continue en pointillés, la suite se prépare. */
export function CurriculumEnd() {
  return (
    <div className="flex h-full flex-col items-center gap-4 pt-6 text-center">
      <span aria-hidden="true" className="h-24 border-l-2 border-dashed border-hairline-strong" />
      <span className="font-serif text-lg">La suite du voyage se prépare.</span>
      <span className="max-w-xs text-sm text-muted">
        En attendant les prochaines leçons, le parcours propose des révisions, toujours disponibles.
      </span>
    </div>
  );
}
