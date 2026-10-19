import type { CSSProperties } from "react";
import type { StampMotif, TrackCity } from "../../lib/track";

/** Motifs des tampons (viewBox 46 × 18, trait vermillon) : le repère de la ville. */
const MOTIF: Record<StampMotif, string> = {
  castle: "M10 16 L13 11 H33 L36 16 M15 11 L17 7 H29 L31 11 M19 7 L21 3 H25 L27 7",
  bridge: "M2 15 Q23 4 44 15 M6 12 V16 M16 8 V16 M30 8 V16 M40 12 V16",
  mountain: "M2 16 L14 4 Q16 2 18 4 L24 10 M20 16 L30 7 Q32 5 34 7 L44 16",
  fuji: "M4 16 L18 4 Q23 0 28 4 L42 16 M16 6 L20 8 L23 5 L26 8 L30 6",
  wave: "M2 14 Q8 4 14 12 Q12 7 17 7 Q22 7 20 13 Q28 5 34 12 Q32 8 37 8 Q42 8 40 14",
  temple: "M4 9 Q12 8 15 3 H31 Q34 8 42 9 M10 9 V16 M36 9 V16 M6 16 H40",
  shrine: "M8 4 Q23 1 38 4 M10 8 H36 M13 4 V16 M33 4 V16",
  lake: "M4 12 Q23 5 42 12 Q23 18 4 12 M12 12 H18 M26 11 H34",
  rice: "M2 16 L10 6 H44 L38 16 Z M8 11 H41 M18 6 L14 16 M28 6 L25 16",
  pine: "M23 16 Q21 11 24 6 M14 9 Q23 5 32 8 M17 5 Q24 1 30 4",
  town: "M3 9 Q9 6 15 9 M17 6 Q23 2 29 6 M31 9 Q37 6 43 9 M5 9 V16 M13 9 V16 M19 6 V16 M27 6 V16 M33 9 V16 M41 9 V16",
  boat: "M6 12 H40 L35 16 H11 Z M18 12 V2 L30 10 Z",
  gate: "M8 5 H38 L35 2 H11 Z M12 5 V16 M34 5 V16 M12 9 H34",
  tea: "M8 8 L16 2 H30 L38 8 Z M11 8 V16 M35 8 V16 M2 4 Q6 1 10 4",
  pagoda: "M23 1 V3 M18 5 Q23 3 28 5 M16 9 Q23 6 30 9 M14 13 Q23 10 32 13 M20 13 V16 M26 13 V16",
};

/** Motif par défaut d'une ville, selon sa taille (les données de la route le précisent). */
export function motifOf(city: Pick<TrackCity, "motif" | "size">): StampMotif {
  if (city.motif) return city.motif;
  return city.size === "terminus" ? "bridge" : city.size === "grande" ? "castle" : city.size === "village" ? "rice" : "town";
}

/** Formes des tampons : chaque ville a la sienne, comme les vrais 駅スタンプ. */
export type StampShape = "square" | "circle" | "octagon" | "hexagon" | "ema" | "arch";

/**
 * Contour extérieur et filet intérieur de chaque forme (viewBox 100 × 100), avec l'échelle et le
 * décalage vertical du contenu pour qu'il tienne dedans.
 */
const SHAPE: Record<StampShape, { outer: string; inner: string; scale: number; dy: number }> = {
  square: {
    outer: "M12 2 H88 Q98 2 98 12 V88 Q98 98 88 98 H12 Q2 98 2 88 V12 Q2 2 12 2 Z",
    inner: "M14 9 H86 Q91 9 91 14 V86 Q91 91 86 91 H14 Q9 91 9 86 V14 Q9 9 14 9 Z",
    scale: 1,
    dy: 0,
  },
  circle: {
    outer: "M50 2 A48 48 0 1 1 50 98 A48 48 0 1 1 50 2 Z",
    inner: "M50 9 A41 41 0 1 1 50 91 A41 41 0 1 1 50 9 Z",
    scale: 0.86,
    dy: 0,
  },
  octagon: { outer: polygon(8, 48, Math.PI / 8), inner: polygon(8, 41, Math.PI / 8), scale: 0.92, dy: 0 },
  // Pointe en haut, un peu élargi pour garder la place du nom.
  hexagon: { outer: polygon(6, 41.6, 0, 1.1), inner: polygon(6, 35.5, 0, 1.1), scale: 0.84, dy: 0 },
  // La plaque votive (絵馬) : un toit à deux pentes.
  ema: {
    outer: "M2 32 L50 3 L98 32 V96 Q98 98 96 98 H4 Q2 98 2 96 Z",
    inner: "M9 35 L50 11 L91 35 V91 H9 Z",
    scale: 0.88,
    dy: 0.07,
  },
  // La fenêtre en cloche (花頭窓) des temples.
  arch: {
    outer: "M2 98 V50 A48 48 0 0 1 98 50 V98 Z",
    inner: "M9 91 V50 A41 41 0 0 1 91 50 V91 Z",
    scale: 0.9,
    dy: 0.05,
  },
};

/** Polygone régulier centré, d'apothème `a` (côtés à `a` du centre), tourné de `rot`, élargi de `squash`. */
function polygon(n: number, a: number, rot: number, squash = 1): string {
  const r = a / Math.cos(Math.PI / n);
  const pts = Array.from({ length: n }, (_, i) => {
    const t = rot + (i * 2 * Math.PI) / n - Math.PI / 2;
    return `${(50 + r * Math.cos(t) * squash).toFixed(1)} ${(50 + r * Math.sin(t)).toFixed(1)}`;
  });
  return `M${pts.join(" L")} Z`;
}

const SHAPES: StampShape[] = ["square", "circle", "ema", "octagon", "arch", "hexagon"];

/** Forme du tampon d'une ville : stable, et jamais la même que celle de sa voisine. */
export function shapeOf(city: Pick<TrackCity, "index">): StampShape {
  return SHAPES[(city.index * 5) % SHAPES.length];
}

interface Props {
  city: Pick<TrackCity, "kanji" | "motif" | "size" | "index">;
  size?: number;
  /** Tampon pas encore obtenu : pointillés d'encre, sans motif. */
  empty?: boolean;
  className?: string;
  style?: CSSProperties;
}

/**
 * Tampon de gare (駅スタンプ, SPEC §5c.5) : contour vermillon à double filet, d'une forme propre
 * à la ville, le motif de son repère et son nom. Légèrement de biais, d'un angle stable par ville.
 */
export function CityStamp({ city, size = 62, empty, className = "", style }: Props) {
  const angle = ((city.index * 29) % 13) - 6;
  const shape = SHAPE[shapeOf(city)];
  const fontSize = Math.max(12, Math.round(size * 0.21 * shape.scale));
  return (
    <span
      className={`relative flex flex-col items-center justify-center gap-px ${empty ? "font-jp text-muted" : "text-accent"} ${className}`}
      style={{ width: size, height: size, transform: empty ? undefined : `rotate(${angle}deg)`, ...style }}
      aria-label={empty ? undefined : `Tampon de ${city.kanji}`}
    >
      <svg className="absolute inset-0" width={size} height={size} viewBox="0 0 100 100" fill="none" aria-hidden="true">
        {empty ? (
          <path d={shape.outer} stroke="var(--hairline-strong)" strokeWidth="1" strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />
        ) : (
          <>
            <path d={shape.outer} fill="color-mix(in srgb, var(--bg) 85%, transparent)" stroke="currentColor" strokeWidth="2" vectorEffect="non-scaling-stroke" />
            <path d={shape.inner} stroke="currentColor" strokeWidth="1" vectorEffect="non-scaling-stroke" />
          </>
        )}
      </svg>
      {empty ? (
        <span className="relative" style={{ fontSize: city.kanji.length > 3 ? fontSize * 0.85 : fontSize, marginTop: size * shape.dy }}>
          {city.kanji}
        </span>
      ) : (
        <span className="relative flex flex-col items-center gap-px" style={{ marginTop: size * shape.dy }}>
          <svg
            width={size * 0.5 * shape.scale}
            height={size * 0.2 * shape.scale}
            viewBox="0 0 46 18"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d={MOTIF[motifOf(city)]} />
          </svg>
          <span className="font-jp font-semibold leading-tight" style={{ fontSize: city.kanji.length > 3 ? fontSize * 0.9 : fontSize }}>
            {city.kanji}
          </span>
        </span>
      )}
    </span>
  );
}

/** Tampon de fortune de l'omikuji (大吉, 吉…) : sceau rond, le kanji de la fortune. */
export function FortuneStamp({ kanji, size = 56 }: { kanji: string; size?: number }) {
  return (
    <span
      className="flex items-center justify-center rounded-full border-2 border-accent font-jp font-semibold text-accent"
      style={{ width: size, height: size, outline: "1px solid var(--accent)", outlineOffset: -6, fontSize: kanji.length > 1 ? size * 0.3 : size * 0.4 }}
      aria-label={`Tampon de fortune ${kanji}`}
    >
      {kanji}
    </span>
  );
}
