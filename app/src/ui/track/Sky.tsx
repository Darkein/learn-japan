import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { Season } from "../../lib/scenery";
import { moonLitPath, skyAt, type SkyState } from "../../lib/sky";


/** PRNG déterministe (mulberry32) : les étoiles restent à leur place. */
function rng(seed: number): () => number {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const STARS = (() => {
  const r = rng(8531);
  return Array.from({ length: 22 }, () => ({
    x: 3 + r() * 94,
    /** Part de la hauteur du ciel au-dessus de la crête. */
    y: 0.06 + r() * 0.74,
    size: 1 + r() * 1.1,
    // Durées et décalages distincts : les étoiles ne scintillent jamais ensemble.
    dur: 2.4 + r() * 4.2,
    delay: -r() * 6,
  }));
})();

const PETALS = (() => {
  const r = rng(4409);
  return Array.from({ length: 7 }, () => ({ x: r() * 100, dur: 9 + r() * 7, delay: -r() * 14, size: 3 + r() * 2 }));
})();

const FIREFLIES = (() => {
  const r = rng(717);
  return Array.from({ length: 9 }, () => ({ x: 4 + r() * 92, y: 0.55 + r() * 0.4, dur: 2 + r() * 3, delay: -r() * 4 }));
})();

/** Un oiseau en vol, ailes en V. */
function Bird({ x, y, s = 1 }: { x: number; y: number; s?: number }) {
  return <path d={`M${x} ${y} q${3 * s} ${-3 * s} ${6 * s} 0 q${3 * s} ${-3 * s} ${6 * s} 0`} />;
}

function Birds({ kind }: { kind: "swallows" | "geese" | "crane" }) {
  let body;
  if (kind === "geese") {
    // Le vol d'oies en V.
    body = [0, 1, 2, 3].flatMap((k) => (k ? [<Bird key={`a${k}`} x={-k * 11} y={k * 6} s={0.8} />, <Bird key={`b${k}`} x={-k * 11} y={-k * 6} s={0.8} />] : [<Bird key="h" x={0} y={0} s={0.8} />]));
  } else if (kind === "swallows") {
    body = [<Bird key="1" x={0} y={0} s={0.9} />, <Bird key="2" x={-22} y={10} s={0.7} />, <Bird key="3" x={-40} y={-4} s={0.6} />];
  } else {
    // La grue : grandes ailes, cou tendu, pattes en arrière.
    body = (
      <>
        <path d="M-14 0 Q-4 -12 4 -2 Q12 -12 22 -3" />
        <path d="M4 -2 L16 1 M4 -2 L-12 2" />
        <circle cx={17} cy={1} r={1.2} fill="var(--accent)" stroke="none" />
      </>
    );
  }
  return (
    <svg className="sky-birds absolute" style={{ top: 10, left: 0 }} width={80} height={60} viewBox="-50 -30 80 60" fill="none" stroke="currentColor" strokeOpacity={0.5} strokeWidth={1.3} strokeLinecap="round">
      {body}
    </svg>
  );
}

/** L'état du ciel, remis à l'heure chaque minute. */
export function useSky(season: Season): SkyState {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(t);
  }, []);
  const minute = Math.floor(now.getTime() / 60_000);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => skyAt(now, season), [minute, season]);
}

/**
 * Le ciel de la voie (SPEC §5c.6), en haut de la bande d'horizon (§5c.6b), sur son propre fond.
 * Le soleil suit l'heure (à demi caché derrière une crête à l'aube et au crépuscule), la nuit
 * la lune a sa phase réelle et les étoiles scintillent ; brume du matin, oiseaux et pétales
 * selon la saison. `ground` est la profondeur du sol sous l'horizon ; `children` se dessine
 * par-dessus (le sol et ses plans).
 */
export function Sky({ sky, height, ground, children }: { sky: SkyState; height: number; ground: number; children?: ReactNode }) {
  const horizon = height - ground;
  const body = sky.sun ?? sky.moon;
  const bodyTop = body ? horizon - 8 - body.alt * Math.max(20, horizon - 30) : 0;
  return (
    <div aria-hidden="true" data-sky={sky.time} className="horizon-sky absolute inset-x-0 top-0 overflow-hidden text-text" style={{ height }}>
      {sky.stars &&
        STARS.map((s, i) => (
          <span
            key={i}
            className="sky-star"
            style={{ left: `${s.x}%`, top: 6 + s.y * (horizon - 20), width: s.size, height: s.size, animationDuration: `${s.dur}s`, animationDelay: `${s.delay}s` }}
          />
        ))}

      {sky.sun && (
        <span
          className="absolute rounded-full bg-accent"
          style={{ left: `${sky.sun.x * 100}%`, top: bodyTop, width: 18, height: 18, transform: "translate(-50%, -50%)", opacity: 0.85 }}
        />
      )}
      {sky.moon && (
        <svg className="absolute" style={{ left: `${sky.moon.x * 100}%`, top: bodyTop, transform: "translate(-50%, -50%)" }} width={22} height={22} viewBox="0 0 22 22">
          <circle cx={11} cy={11} r={9} fill="currentColor" fillOpacity={0.1} />
          <path d={moonLitPath(11, 11, 9, sky.moon.phase)} fill="currentColor" fillOpacity={0.6} />
        </svg>
      )}
      {(sky.time === "dawn" || sky.time === "dusk") && sky.sun && (
        // La crête qui cache à demi le soleil levant ou couchant.
        <svg className="absolute" style={{ left: `calc(${sky.sun.x * 100}% - 90px)`, top: horizon - 34 }} width={180} height={40} viewBox="0 0 180 40">
          <path d="M0 40 L30 22 L52 30 L88 6 L118 26 L140 18 L180 40 Z" fill="var(--sky-ridge)" />
        </svg>
      )}

      {sky.mist && (
        <>
          <span className="sky-mist absolute" style={{ top: horizon - 26, left: "-20%", width: "70%" }} />
          <span className="sky-mist absolute" style={{ top: horizon - 46, left: "40%", width: "60%", animationDelay: "-20s" }} />
        </>
      )}

      {sky.birds && <Birds kind={sky.birds} />}

      {sky.petals &&
        PETALS.map((p, i) => (
          <span
            key={i}
            className="sky-petal absolute rounded-full"
            style={{ left: `${p.x}%`, width: p.size, height: p.size * 0.7, animationDuration: `${p.dur}s`, animationDelay: `${p.delay}s` }}
          />
        ))}
      {sky.fireflies &&
        FIREFLIES.map((f, i) => (
          <span
            key={i}
            className="sky-firefly absolute rounded-full"
            style={{ left: `${f.x}%`, top: f.y * horizon, animationDuration: `${f.dur}s`, animationDelay: `${f.delay}s` }}
          />
        ))}
      {children}
    </div>
  );
}
