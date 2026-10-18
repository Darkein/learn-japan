import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { routeForLevel } from "../data/routes";
import { SCENERIES } from "../data/scenery";
import { getMeta, localDateString, recentSrsDaily, type SrsDailyRecord } from "../lib/db";
import { gatherFlowState, pickNext, restKey, type FlowActivity } from "../lib/flow";
import type { Lesson } from "../lib/lessons";
import { estimateLabel, loadFormDurations, stepPlan } from "../lib/pathPlan";
import { sessionStats } from "../lib/reviewSession";
import { goalStreak } from "../lib/stats";
import { markStationCelebrated, stampTotal, tokaidoStatus, type RouteArrival, type TokaidoStatus } from "../lib/tokaido";
import { placeDecor, seasonOf } from "../lib/scenery";
import { layoutTrack, type TrackNode, type TrackSection } from "../lib/track";
import { trackInput } from "../lib/trackInput";
import { Button } from "./kit/Button";
import { IconBook } from "./kit/Icon";
import { LoadingScreen } from "./kit/LoadingScreen";
import { claimOmikujiAutoOpen, OmikujiSheet } from "./OmikujiSheet";
import { StationArrival } from "./StationArrival";
import { CityFiche } from "./track/CityFiche";
import { CurriculumEnd, RouteEnd } from "./track/RouteEnd";
import { Sky } from "./track/Sky";
import { Track } from "./track/Track";
import { EXTRA_WORDS, STEP_WORDS } from "./track/words";
import { useGenJobs } from "./useGenJobs";
import { useSettings } from "./useSettings";

interface Props {
  onOpenCourse: (lesson: Lesson) => void;
  onStartReview: () => void;
  onStartFlow: () => void;
  onGoStats: () => void;
  onGoVoyage: () => void;
}

interface HomeData {
  lessons: Lesson[];
  activity: FlowActivity;
  dueCount: number;
  daily: SrsDailyRecord[];
  tokaido: TokaidoStatus;
  restDone: Set<string>;
  formMs: Map<string, number>;
}

/** Flamme de la série de jours (trait du kit, 1.6). */
function IconFlame() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3c1 3.5 5 5.5 5 10a5 5 0 0 1-10 0c0-2.5 1.5-3.8 2.5-5 .3 1.6 1 2.6 2 3 .3-3-1-5.5.5-8z" />
    </svg>
  );
}

/** Anneau des étapes du jour sur l'objectif. */
function StepsRing({ done, goal }: { done: number; goal: number }) {
  const c = 2 * Math.PI * 7;
  const f = Math.min(1, goal > 0 ? done / goal : 0);
  return (
    <svg width="16" height="16" viewBox="0 0 18 18" aria-hidden="true">
      <circle cx="9" cy="9" r="7" fill="none" stroke="var(--hairline-strong)" strokeWidth="2" />
      <circle cx="9" cy="9" r="7" fill="none" stroke="var(--accent)" strokeWidth="2" strokeDasharray={`${f * c} ${c}`} transform="rotate(-90 9 9)" />
    </svg>
  );
}

/**
 * L'accueil : la voie du voyage (SPEC §5c). En haut, la route, les tampons, la série et les
 * étapes du jour ; puis le bandeau de la leçon visible ; puis la voie, sans fin, centrée sur
 * l'étape à faire.
 */
export function Home({ onOpenCourse, onStartReview, onStartFlow, onGoStats, onGoVoyage }: Props) {
  const [data, setData] = useState<HomeData | null>(null);
  const [width, setWidth] = useState(0);
  const [section, setSection] = useState<TrackSection | undefined>();
  const [omikujiOpen, setOmikujiOpen] = useState(false);
  const [arrival, setArrival] = useState<RouteArrival | null>(null);
  const [fiche, setFiche] = useState<{ level: number; index: number; stamped: boolean } | null>(null);
  const measure = useRef<HTMLDivElement>(null);
  const banner = useRef<HTMLDivElement>(null);
  const [bannerH, setBannerH] = useState(64);
  const { dataVersion } = useGenJobs();
  const { settings } = useSettings();

  useEffect(() => {
    void (async () => {
      const [{ state, lessons }, stats, daily, formMs] = await Promise.all([
        gatherFlowState(),
        sessionStats(),
        recentSrsDaily(30), // 30 jours : ne plafonne pas la série affichée à 7
        loadFormDurations(),
      ]);
      const tokaido = await tokaidoStatus(lessons);
      const restDone = new Set<string>();
      for (let i = 4; i < lessons.length; i += 5) {
        if ((await getMeta<number>(restKey(lessons[i].id))) != null) restDone.add(lessons[i].id);
      }
      setData({ lessons, activity: pickNext(state), dueCount: stats.dueCount, daily, tokaido, restDone, formMs });
      setArrival(tokaido.newlyArrived ?? null);
    })();
  }, [dataVersion]);

  // L'omikuji du jour s'ouvre d'elle-même au lancement de l'app tant qu'elle n'a pas été vue.
  useEffect(() => {
    void claimOmikujiAutoOpen().then((open) => {
      if (open) setOmikujiOpen(true);
    });
  }, []);

  // Le ciel se colle sous le bandeau de leçon : sa hauteur suit le bandeau.
  useEffect(() => {
    const el = banner.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setBannerH(Math.round(el.getBoundingClientRect().height)));
    ro.observe(el);
    return () => ro.disconnect();
  }, [data !== null]);

  // La voie se met en page à la largeur réelle (bord à bord sur téléphone).
  useEffect(() => {
    const el = measure.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(Math.round(el.clientWidth)));
    ro.observe(el);
    setWidth(Math.round(el.clientWidth));
    return () => ro.disconnect();
  }, [data !== null]);

  const layout = useMemo(() => {
    if (!data || width < 200) return null;
    return layoutTrack(
      trackInput({
        width,
        lessons: data.lessons,
        activity: data.activity,
        stamps: data.tokaido.stamps,
        restDone: data.restDone,
        sceneries: SCENERIES,
      }),
    );
  }, [data, width]);
  // La saison du jour (date locale) : fixée à l'ouverture de l'accueil.
  const season = useMemo(() => seasonOf(new Date()), []);
  const decor = useMemo(() => (layout ? placeDecor(layout, SCENERIES, season) : undefined), [layout, season]);

  const lessonById = useMemo(() => new Map(data?.lessons.map((l) => [l.id, l]) ?? []), [data]);
  const onSection = useCallback((s: TrackSection | undefined) => setSection((p) => (p?.lessonId === s?.lessonId ? p : s)), []);

  if (!data) return <LoadingScreen />;

  const todayStr = localDateString();
  const today = data.daily.find((d) => d.date === todayStr);
  const stepsToday = today?.steps ?? 0;
  const streak = goalStreak(data.daily, settings, todayStr);
  const { pos, stamps } = data.tokaido;

  /** Durée annoncée d'une étape (§5.7). */
  function estimateOf(lessonId: string, step: Lesson["steps"][number]): string | undefined {
    const l = lessonById.get(lessonId);
    if (!l) return undefined;
    const e = stepPlan(l, data!.formMs).find((x) => x.step === step);
    return e ? estimateLabel(e) : undefined;
  }

  const metaOf = (n: TrackNode): string | undefined => {
    if (n.kind !== "step" || n.state !== "todo" || n.dim) return undefined;
    const l = lessonById.get(n.lessonId);
    const e = l && stepPlan(l, data.formMs).find((x) => x.step === n.step);
    return e ? `~${e.minutes} min` : undefined;
  };

  const cur = layout?.current;
  let bubble: React.ReactNode = null;
  if (cur && cur.kind !== "city") {
    const w = cur.kind === "step" ? STEP_WORDS[cur.step] : EXTRA_WORDS[cur.extra];
    const lesson = cur.lessonId ? lessonById.get(cur.lessonId) : undefined;
    const isReview = cur.kind === "extra" || (cur.kind === "step" && cur.step === "review");
    const detail =
      cur.kind === "step"
        ? [lesson ? `Leçon ${lesson.order} · ${lesson.title}` : undefined, estimateOf(cur.lessonId, cur.step)]
        : [data.activity.title];
    bubble = (
      <>
        <span className="text-xs uppercase tracking-wide text-accent">
          {cur.kind === "step" ? `Étape ${cur.number} · À faire` : "À faire"}
        </span>
        <ruby className="track-ruby font-jp text-xl leading-tight text-text">
          {w.word}
          <rt>
            {w.kana} · {w.fr}
          </rt>
        </ruby>
        {detail.filter(Boolean).map((d) => (
          <span key={d} className="text-xs text-muted">
            {d}
          </span>
        ))}
        <Button variant="primary" className="mt-1.5" onClick={onStartFlow}>
          Commencer
        </Button>
        {!isReview && data.dueCount > 0 && (
          <Button variant="quiet" size="sm" onClick={onStartReview}>
            Réviser seulement · {data.dueCount} carte{data.dueCount > 1 ? "s" : ""}
          </Button>
        )}
      </>
    );
  }

  function tapNode(n: TrackNode) {
    if ((n.kind === "step" || n.kind === "extra") && n.state === "cur") return onStartFlow();
    if (n.kind === "city") return setFiche({ level: n.level, index: n.city.index, stamped: n.passed });
    const lesson = n.lessonId ? lessonById.get(n.lessonId) : undefined;
    if (lesson) onOpenCourse(lesson);
  }

  const shown = section ? lessonById.get(section.lessonId) : undefined;
  const bases = layout ? layout.nodes.filter((n) => n.kind === "step" && n.lessonId === shown?.id) : [];
  const first = bases[0];
  const last = bases[bases.length - 1];

  return (
    <div className="flex flex-col">
      <div className="flex items-center justify-between gap-3 pb-3 text-sm text-muted">
        <button type="button" onClick={onGoVoyage} className="flex cursor-pointer items-center gap-2.5 text-left" aria-label="Le voyage et le carnet de tampons">
          <span className="font-jp text-base text-text">{pos.route.kanji}</span>
          <span className="text-xs">
            {pos.station.index}/{pos.route.stations.length - 1}
          </span>
          <span className="flex items-center gap-1 text-xs">
            <span className="flex h-[18px] w-[18px] items-center justify-center rounded-sm border-[1.5px] border-accent font-jp text-xs leading-none text-accent">
              印
            </span>
            {stampTotal(stamps)}
          </span>
        </button>
        <button type="button" onClick={onGoStats} className="flex cursor-pointer items-center gap-4" aria-label="Statistiques">
          <span className="flex items-center gap-1.5" title="Série de jours">
            <IconFlame />
            <strong className="font-semibold text-text">{streak}</strong>
          </span>
          <span className="flex items-center gap-1.5" title="Étapes du jour">
            <StepsRing done={stepsToday} goal={settings.dailySteps} />
            <span>
              <strong className="font-semibold text-text">{stepsToday}</strong>/{settings.dailySteps}
            </span>
          </span>
        </button>
      </div>

      <div ref={banner} className="sticky top-0 z-20 -mx-4 border-b border-hairline bg-bg/95 px-4 py-2.5 backdrop-blur-sm">
        {shown ? (
          <div className="flex items-center gap-3">
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="text-xs uppercase tracking-wide text-muted">
                N{shown.level} · Leçon {shown.order}
                {first?.kind === "step" && last?.kind === "step" ? ` · étapes ${first.number} à ${last.number}` : ""}
              </span>
              <span className="truncate font-serif text-lg">{shown.title}</span>
            </div>
            <Button size="icon" onClick={() => onOpenCourse(shown)} aria-label={`Relire le cours de la leçon ${shown.order}`}>
              <IconBook />
            </Button>
          </div>
        ) : (
          <span className="font-serif text-lg">
            {pos.route.name} · {routeForLevel(pos.route.level).tagline}
          </span>
        )}
      </div>

      <div ref={measure} className="-mx-4 overflow-x-clip">
        {layout && <Sky season={season} top={bannerH} />}
        {layout && (
          <Track
            layout={layout}
            decor={decor}
            trainColor={(level) => routeForLevel(level).trainColor}
            bubble={bubble}
            metaOf={metaOf}
            onTapNode={tapNode}
            onSection={onSection}
            renderMarker={(m) => {
              if (m.kind === "curriculum-end") return <CurriculumEnd />;
              if (m.kind !== "route-end") return null;
              const stat = data.tokaido.levels.find((s) => s.level === m.level);
              return (
                <RouteEnd
                  level={m.level}
                  nextLevel={m.nextLevel}
                  reached={m.reached}
                  totals={{ steps: stat?.stepsTotal ?? 0, lessons: stat?.lessonsTotal ?? 0 }}
                  onOpenCarnet={onGoVoyage}
                />
              );
            }}
            backLabel={cur?.kind === "step" ? `Revenir à l'étape ${cur.number}` : undefined}
          />
        )}
      </div>

      {arrival && (
        <StationArrival
          arrival={arrival}
          onClose={() => {
            void markStationCelebrated(arrival.route.level, arrival.station.index);
            setArrival(null);
          }}
        />
      )}
      {omikujiOpen && <OmikujiSheet onClose={() => setOmikujiOpen(false)} />}
      {fiche && (
        <CityFiche
          {...fiche}
          stepsToGo={
            !fiche.stamped && fiche.level === pos.route.level && pos.next?.index === fiche.index ? pos.stepsToNext : undefined
          }
          onClose={() => setFiche(null)}
        />
      )}
    </div>
  );
}
