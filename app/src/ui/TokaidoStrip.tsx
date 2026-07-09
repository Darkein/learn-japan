import {
  useEffect,
  useMemo,
  useRef,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import type { TokaidoPosition } from "../lib/tokaido";
import { SectionLabel } from "./kit/SectionLabel";

interface Props {
  pos: TokaidoPosition;
  onOpen: () => void;
}

/** Espacement horizontal entre deux stations (px) — fixe, la bande défile. */
const STEP = 48;
/** Hauteur de la bande décor. Seul le CIEL profite de cette hauteur (agrandi vers le haut) ;
    montagnes et arbres gardent leurs 32 px, ancrés en bas (voir masks + global.css). */
const BAND = 48;
/** Décor « historique » de base : montagnes/arbres tuilés sur 32 px. */
const BASE_BAND = 32;
const LINE_Y = BAND + 2; // ordonnée de la voie, juste sous la bande décor (px)
const STRIP_H = 96 + (BAND - BASE_BAND); // voie + poteaux kanji verticaux, décalés vers le bas
/** Marge de voie AVANT la 1re station : le train (~168 px) et sa traînée tiennent à l'étape 0. */
const LEAD = 180;
/** Longueur de la tuile de montagnes (px). Grande période → la répétition ne se lit plus ;
    le ridge est généré une fois puis bouclé (deux copies) par translation de cette valeur. */
const MTN_TILE = 960;

/** PRNG déterministe (mulberry32) : même seed → même ridge à chaque rendu, pas de scintillement. */
function mulberry32(a: number): () => number {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Polyligne de crête procédurale, PÉRIODIQUE sur MTN_TILE (bouclable sans couture) : somme
    d'octaves sinusoïdales (fréquences entières = wrap parfait) + quelques pics gaussiens dont
    un large « Fuji ». L'influence des pics est repliée aux bords (±MTN_TILE) pour rester
    périodique. Pas d'aléa non déterministe : le seed est fixe. */
function genRidge(seed: number, yOff = 0): string {
  const rand = mulberry32(seed);
  const base = 24;
  const amps = [3.5, 2.2, 1.4, 0.9, 0.5];
  const octs = [1, 2, 3, 5, 8].map((k, i) => ({ k, amp: amps[i], ph: rand() * Math.PI * 2 }));
  const peaks = [{ c: MTN_TILE * (0.3 + 0.4 * rand()), w: 38, h: 18 }];
  const n = 4 + Math.floor(rand() * 3);
  for (let i = 0; i < n; i++) peaks.push({ c: rand() * MTN_TILE, w: 18 + rand() * 26, h: 6 + rand() * 9 });
  const yAt = (x: number): number => {
    let y = base;
    for (const o of octs) y -= o.amp * (0.5 + 0.5 * Math.sin((o.k * 2 * Math.PI * x) / MTN_TILE + o.ph));
    for (const p of peaks)
      for (const off of [-MTN_TILE, 0, MTN_TILE]) {
        const d = x - (p.c + off);
        y -= p.h * Math.exp(-(d * d) / (2 * p.w * p.w));
      }
    return Math.max(2, y);
  };
  const seg: string[] = [];
  for (let x = 0; x <= MTN_TILE; x += 6) seg.push(`${x},${(yAt(x) + yOff).toFixed(1)}`);
  return `M${seg.join(" L")}`;
}

/** Emballe un `d` SVG en data-URI de mask (fill noir = zone visible). */
function maskUri(d: string, h = BASE_BAND): string {
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='${MTN_TILE}' height='${h}'><path d='${d}' fill='black'/></svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

/** Silhouette de pagode à trois toits (jalon « ville ») — remplie via currentColor. */
function CityGlyph() {
  return (
    <svg width="28" height="24" viewBox="0 0 28 24" fill="currentColor" aria-hidden="true">
      <path d="M13.4 0 h1.2 v3 h-1.2 Z M9 6 Q14 3 19 6 Z M12 6 h4 v3 h-4 Z M7 12 Q14 8 21 12 Z M11 12 h6 v3 h-6 Z M5 18 Q14 13 23 18 Z M9 18 h10 v6 h-10 Z" />
    </svg>
  );
}

/**
 * Bandeau du voyage (accueil) : fenêtre scrollable/swipable sur la route ACTIVE (une par
 * niveau JLPT, voir data/routes.ts), auto-centrée sur le train. Chaque station est un
 * poteau avec son nom en kanji vertical (façon panneau de route) ; le train — sa couleur
 * change de route en route — roule sur la ligne d'encre. Le détail complet (toutes les
 * étapes, notes) reste dans la vue Voyage, ouverte au tap.
 */
export function TokaidoStrip({ pos, onOpen }: Props) {
  const scroller = useRef<HTMLDivElement>(null);
  const decor = useRef<HTMLDivElement>(null);
  const { route } = pos;
  const stations = route.stations;
  const span = stations.length - 1;
  const arrived = !pos.next;
  const trainX = LEAD + pos.position * STEP + STEP / 2;
  const innerW = LEAD + span * STEP + STEP;
  // Villes majeures (jalons) : calées sur la position de leur station le long de la bande.
  const cities = useMemo(
    () =>
      stations
        .filter((s) => s.city)
        .map((s) => ({ index: s.index, x: LEAD + s.index * STEP + STEP / 2 })),
    [stations],
  );
  // Ridge procédural monté en MASK (même mécanisme que les arbres : mask-position animé,
  // fiable dans la durée), tuilé sur MTN_TILE — période assez grande pour masquer la répétition.
  // Deux masks issus de la MÊME crête : montagnes (rempli sous la crête) et ciel (rempli
  // AU-DESSUS de la crête). Le ciel étant clippé à la crête et défilant en phase avec les
  // montagnes, l'astre disparaît réellement DERRIÈRE les pics à l'horizon.
  const { mountainMask, skyMask } = useMemo(() => {
    // Même crête ; pour le ciel (boîte BAND), on la descend de (BAND-32) → elle rejoint
    // exactement le sommet des montagnes (boîte 32, ancrée en bas). L'astre disparaît pile
    // derrière les pics.
    const ridgeM = genRidge(20240707);
    const ridgeS = genRidge(20240707, BAND - BASE_BAND);
    return {
      mountainMask: maskUri(`${ridgeM} L${MTN_TILE},${BASE_BAND} L0,${BASE_BAND} Z`),
      skyMask: maskUri(`${ridgeS} L${MTN_TILE},0 L0,0 Z`, BAND),
    };
  }, []);
  // Astre positionné selon l'heure locale : le soleil arque de l'aube (6 h) au couchant (18 h),
  // la lune la nuit. x en %, top en px dans la bande (astre haut à midi/minuit, bas à l'horizon
  // où les montagnes le masquent). Étoiles fixes (seed) qui scintillent, visibles la nuit.
  const sky = useMemo(() => {
    const now = new Date();
    const h = now.getHours() + now.getMinutes() / 60;
    const day = h >= 6 && h < 18;
    const f = day ? (h - 6) / 12 : ((h - 18 + 24) % 24) / 12;
    // Phase lunaire réelle (mois synodique depuis une nouvelle lune connue). L'overlay couleur
    // ciel est décalé de `moonOff` px : concentrique = nouvelle lune (cachée), décalé à fond =
    // pleine lune ; le signe donne le sens (croissant à droite en phase croissante).
    const synodic = 29.530588853;
    const days = (now.getTime() - Date.UTC(2000, 0, 6, 18, 14)) / 86400000;
    const phase = (((days % synodic) / synodic) + 1) % 1;
    const lit = (1 - Math.cos(2 * Math.PI * phase)) / 2;
    const moonOff = `${((phase < 0.5 ? -1 : 1) * lit * 11).toFixed(1)}px`;
    // Arc de l'astre dans le ciel agrandi : haut à midi/minuit, bas vers l'horizon (crête).
    return { day, x: 8 + f * 84, top: BAND - 14 - Math.sin(f * Math.PI) * (BAND - 24), moonOff };
  }, []);
  const stars = useMemo(() => {
    const rand = mulberry32(8531);
    return Array.from({ length: 16 }, () => ({
      x: 4 + rand() * 92,
      // Réparties au-dessus de la crête, sur toute la hauteur de ciel disponible.
      y: 2 + rand() * (BAND - BASE_BAND),
      size: `${(0.8 + rand() * 0.9).toFixed(2)}px`,
      // Durée ET décalage (négatif → démarrage en plein cycle) aléatoires : périodes distinctes
      // → jamais toutes synchrones.
      dur: `${(2.4 + rand() * 4.2).toFixed(2)}s`,
      delay: `-${(rand() * 6).toFixed(2)}s`,
    }));
  }, []);

  // Publie le scroll de la bande vers le décor (--sx) → parallaxe des plans (voir global.css).
  const syncParallax = () => {
    if (scroller.current && decor.current)
      decor.current.style.setProperty("--sx", `${scroller.current.scrollLeft}px`);
  };

  // Centre la fenêtre sur le train (sans animation : c'est l'état, pas un mouvement).
  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollLeft = trainX - el.clientWidth / 2;
    syncParallax();
  }, [trainX]);

  // La bande est scrollable ET ouvre le voyage au tap. Un swipe/drag pour faire défiler se
  // termine sinon par un click → on n'ouvre que si le pointeur n'a quasi pas bougé (vrai tap).
  const pointerFrom = useRef<{ x: number; y: number } | null>(null);
  // Drag-to-pan à la souris : le tactile garde le défilement natif (overflow, inertie native),
  // on n'intercepte qu'au pointeur souris pour saisir-glisser la bande. startX + scrollLeft
  // figés à l'appui ; on suit la vitesse (px/ms) pour prolonger le défilement au relâché.
  const drag = useRef<{ x: number; scroll: number; lastX: number; lastT: number; v: number } | null>(
    null,
  );
  const fling = useRef<number | null>(null);
  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    pointerFrom.current = { x: e.clientX, y: e.clientY };
    if (e.pointerType !== "mouse" || !scroller.current) return;
    if (fling.current !== null) cancelAnimationFrame(fling.current); // saisir = stopper l'inertie
    drag.current = { x: e.clientX, scroll: scroller.current.scrollLeft, lastX: e.clientX, lastT: performance.now(), v: 0 };
    try {
      scroller.current.setPointerCapture(e.pointerId);
    } catch {
      // pointeur déjà relâché (edge navigateur) : le drag marche sans capture.
    }
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || !scroller.current) return;
    scroller.current.scrollLeft = d.scroll - (e.clientX - d.x);
    const now = performance.now();
    const dt = now - d.lastT;
    if (dt > 0) d.v = (e.clientX - d.lastX) / dt;
    d.lastX = e.clientX;
    d.lastT = now;
  };
  // Relâché : prolonge le défilement à la vitesse acquise, amortie à chaque frame (friction),
  // jusqu'à l'arrêt ou une butée. La bande défile à l'inverse du pointeur → vitesse scroll = -v.
  const endDrag = () => {
    const el = scroller.current;
    const d = drag.current;
    drag.current = null;
    if (!el || !d || Math.abs(d.v) < 0.05) return;
    let vs = -d.v;
    let prev = performance.now();
    const step = (t: number) => {
      const dt = t - prev;
      prev = t;
      el.scrollLeft += vs * dt;
      vs *= Math.pow(0.95, dt / 16);
      const max = el.scrollWidth - el.clientWidth;
      if (el.scrollLeft <= 0 || el.scrollLeft >= max || Math.abs(vs) < 0.02) {
        fling.current = null;
        return;
      }
      fling.current = requestAnimationFrame(step);
    };
    fling.current = requestAnimationFrame(step);
  };
  useEffect(() => () => void (fling.current !== null && cancelAnimationFrame(fling.current)), []);
  const openIfTap = (e: ReactMouseEvent) => {
    const from = pointerFrom.current;
    if (from && Math.hypot(e.clientX - from.x, e.clientY - from.y) > 8) return;
    onOpen();
  };

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <button
        className="flex min-w-0 cursor-pointer items-baseline justify-between gap-4 text-left"
        onClick={onOpen}
        aria-label={`Voir le voyage sur le ${route.name}`}
      >
        <SectionLabel className="shrink-0 whitespace-nowrap">
          {route.name} · étape {pos.station.index}/{span}
        </SectionLabel>
        <span className="truncate text-xs text-muted">
          <span className="font-jp text-text">{pos.station.kanji}</span> {pos.station.romaji}
          {pos.next && (
            <>
              {" → "}
              <span className="font-jp">{pos.next.kanji}</span> {pos.next.romaji} ·{" "}
              {pos.betweenPct} %
            </>
          )}
        </span>
      </button>
      <div className={`decor-scene relative min-w-0 overflow-hidden ${sky.day ? "" : "is-night"}`} ref={decor}>
        <div
          className={`decor-layer decor-sky ${sky.day ? "" : "is-night"}`}
          aria-hidden="true"
          style={{ WebkitMaskImage: skyMask, maskImage: skyMask }}
        >
          {!sky.day &&
            stars.map((s, i) => (
              <span
                key={i}
                className="sky-star"
                style={{
                  left: `${s.x}%`,
                  top: `${s.y}px`,
                  width: s.size,
                  height: s.size,
                  animationDuration: s.dur,
                  animationDelay: s.delay,
                }}
              />
            ))}
          <span
            className={sky.day ? "sky-sun" : "sky-moon"}
            style={{ left: `${sky.x}%`, top: `${sky.top}px`, "--moon-off": sky.moonOff } as CSSProperties}
          />
        </div>
        <div
          className="decor-layer decor-mountains"
          aria-hidden="true"
          style={{ WebkitMaskImage: mountainMask, maskImage: mountainMask }}
        />
        <div className="decor-layer decor-cities" aria-hidden="true">
          {cities.map((c) => (
            <span key={c.index} className="decor-city" style={{ left: `calc(${c.x}px - var(--sx, 0px))` }}>
              <CityGlyph />
            </span>
          ))}
        </div>
        <div className="decor-layer decor-trees-far" aria-hidden="true" />
        <div className="decor-layer decor-trees" aria-hidden="true" />
        <div
          ref={scroller}
          className="relative cursor-grab touch-pan-x select-none overflow-x-auto [scrollbar-width:none] active:cursor-grabbing [&::-webkit-scrollbar]:hidden"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onScroll={syncParallax}
          onClick={openIfTap}
          aria-hidden="true"
        >
          <div className="relative" style={{ width: innerW, height: STRIP_H }}>
            <svg
            className="absolute inset-0"
            width={innerW}
            height={STRIP_H}
            viewBox={`0 0 ${innerW} ${STRIP_H}`}
            aria-hidden="true"
          >
            {/* Voie ferrée : traverses (ligne épaisse en pointillés verticaux) sous deux
                rails parallèles. */}
            <line
              className="rail-sleepers"
              x1={0}
              y1={LINE_Y}
              x2={innerW}
              y2={LINE_Y}
              stroke="var(--hairline)"
              strokeWidth={5}
              strokeDasharray="1.5 8.1"
            />
            <line x1={0} y1={LINE_Y - 2} x2={innerW} y2={LINE_Y - 2} stroke="var(--hairline)" strokeWidth={1} />
            <line x1={0} y1={LINE_Y + 2} x2={innerW} y2={LINE_Y + 2} stroke="var(--hairline)" strokeWidth={1} />
            {/* Poteaux de station (passées = ink, à venir = hairline). */}
            {stations.map((s) => (
              <line
                key={s.index}
                x1={LEAD + s.index * STEP + STEP / 2}
                y1={LINE_Y + 5}
                x2={LEAD + s.index * STEP + STEP / 2}
                y2={LINE_Y + 9}
                stroke={s.index <= pos.position ? "var(--ink)" : "var(--hairline)"}
                strokeWidth={s.index === 0 || s.index === span ? 1.5 : 1}
              />
            ))}
            {/* Lignes de vitesse (集中線) : traînée à l'encre derrière le train, à hauteur de
                caisse. Deux plans — proche (net, rapide) et lointain (pâle, lent) — pour
                l'effet de profondeur. Défilent vers l'arrière quand le train « roule ». */}
            <g transform={`translate(${trainX - 176.5}, ${LINE_Y - 7})`} aria-hidden="true">
              {[
                { y: -2, len: 11, stroke: "var(--ink)", dur: "0.8s", delay: "0s" },
                { y: 2, len: 9, stroke: "var(--ink)", dur: "0.9s", delay: "0.25s" },
                { y: -6, len: 6, stroke: "var(--hairline)", dur: "1.3s", delay: "0.15s" },
                { y: 6, len: 6, stroke: "var(--hairline)", dur: "1.25s", delay: "0.5s" },
              ].map((s, i) => (
                <line
                  key={i}
                  className="speed-streak"
                  x1={0}
                  y1={s.y}
                  x2={s.len}
                  y2={s.y}
                  stroke={s.stroke}
                  strokeWidth={1}
                  strokeLinecap="round"
                  style={{ animationDuration: s.dur, animationDelay: s.delay }}
                />
              ))}
            </g>
            {/* Le train, rame shinkansen : motrice de queue (nez à gauche) + trois voitures +
                motrice de tête (nez à droite, EXACTEMENT sur l'avancement). Toutes attelées.
                Roues dessinées d'abord : les caisses passent par-dessus (roues à demi cachées,
                comme il se doit). La caisse tangue sans déplacer le nez (train-chug). */}
            <g transform={`translate(${trainX - 165.5}, ${LINE_Y - 15.5})`}>
              <g className="train-chug">
              {/* Motrice de queue : même caisse que la tête, retournée (nez vers l'arrière). */}
              <g transform="translate(37, 0) scale(-1, 1)">
                <circle cx={8} cy={15.5} r={2} fill="var(--ink)" />
                <circle cx={28} cy={15.5} r={2} fill="var(--ink)" />
                <g transform="translate(0, 1)">
                  <path
                    d="M2 4 q0 -3 3 -3 h14 c6 0 10.5 2.5 14 6 c2 2 3.3 3.6 3.8 5 q0.8 2.5 -2.6 2.5 h-30.2 q-2 0 -2 -1.5 z"
                    fill={route.trainColor}
                  />
                  <rect
                    x={25}
                    y={3.6}
                    width={6}
                    height={2}
                    rx={1}
                    fill="var(--bg)"
                    transform="rotate(33 28 4.6)"
                  />
                  <rect x={4} y={4.5} width={18} height={2.2} rx={1.1} fill="var(--bg)" />
                </g>
              </g>
              {/* Attelage motrice de queue → 1re voiture (rame resserrée, façon shinkansen). */}
              <line x1={35} y1={11} x2={36.5} y2={11} stroke="var(--ink)" strokeWidth={1.5} />
              {[36.5, 68, 99.5].map((x) => (
                <g key={x} transform={`translate(${x}, 0)`}>
                  <circle cx={7} cy={15.5} r={2} fill="var(--ink)" />
                  <circle cx={23} cy={15.5} r={2} fill="var(--ink)" />
                  {/* Caisse descendue d'1px sur les roues. Bandeau de fenêtres continu :
                      même langage visuel que les motrices shinkansen. */}
                  <g transform="translate(0, 1)">
                    <rect x={0} y={1} width={30} height={13.5} rx={2.5} fill={route.trainColor} />
                    <rect x={3} y={4.5} width={24} height={2.2} rx={1.1} fill="var(--bg)" />
                    {/* Attelage vers le véhicule suivant (voiture ou motrice de tête). */}
                    <line x1={30} y1={10} x2={31.5} y2={10} stroke="var(--ink)" strokeWidth={1.5} />
                  </g>
                </g>
              ))}
              {/* Motrice de tête : caisse longue, nez profilé (deux cubiques), vitre de cabine
                  effilée dans la pente, bandeau de fenêtres continu sur le flanc. */}
              <g transform="translate(129, 0)">
                <circle cx={8} cy={15.5} r={2} fill="var(--ink)" />
                <circle cx={28} cy={15.5} r={2} fill="var(--ink)" />
                {/* Caisse descendue d'1px sur les roues, pointe à grand rayon. */}
                <g transform="translate(0, 1)">
                  <path
                    d="M2 4 q0 -3 3 -3 h14 c6 0 10.5 2.5 14 6 c2 2 3.3 3.6 3.8 5 q0.8 2.5 -2.6 2.5 h-30.2 q-2 0 -2 -1.5 z"
                    fill={route.trainColor}
                  />
                  <rect
                    x={25}
                    y={3.6}
                    width={6}
                    height={2}
                    rx={1}
                    fill="var(--bg)"
                    transform="rotate(33 28 4.6)"
                  />
                  <rect x={4} y={4.5} width={18} height={2.2} rx={1.1} fill="var(--bg)" />
                </g>
              </g>
              </g>
            </g>
          </svg>
          {/* Noms en kanji verticaux sous les poteaux, façon panneaux de route. */}
          {stations.map((s) => (
            <span
              key={s.index}
              className={`absolute font-jp text-xs leading-none ${
                s.index === pos.station.index ? "text-text" : "text-muted"
              }`}
              style={{
                left: LEAD + s.index * STEP + STEP / 2,
                top: LINE_Y + 10,
                writingMode: "vertical-rl",
                translate: "-50%",
              }}
            >
              {s.kanji}
            </span>
          ))}
          </div>
        </div>
      </div>
      {arrived && (
        <span className="text-xs text-muted">{route.arriveFr} atteint — la route est faite.</span>
      )}
    </div>
  );
}
