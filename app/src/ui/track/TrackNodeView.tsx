import type { CSSProperties } from "react";
import type { TrackNode } from "../../lib/track";
import { cityGlyph, EXTRA_WORDS, sealAngle, STEP_WORDS, type NodeWord } from "./words";

interface Props {
  node: TrackNode;
  width: number;
  /** Ligne sous le nom (durée d'une étape à venir…). */
  meta?: string;
  onTap: (node: TrackNode) => void;
}

function wordOf(node: TrackNode): NodeWord | undefined {
  if (node.kind === "step") return STEP_WORDS[node.step];
  if (node.kind === "extra") return EXTRA_WORDS[node.extra];
  return undefined;
}

/** Libellé lisible par un lecteur d'écran (« Étape 80, Grammaire, à faire »). */
function ariaLabel(node: TrackNode): string {
  if (node.kind === "city") {
    const state = node.passed ? "passée" : node.next ? "prochaine ville" : "à venir";
    const what = node.city.index === 0 ? "Départ" : node.city.size === "terminus" ? "Terminus" : `Ville ${node.city.index}`;
    return `${what}, ${node.city.romaji}, ${state}`;
  }
  const w = wordOf(node)!;
  const state = node.state === "done" ? "faite" : node.state === "cur" ? "à faire" : "à venir";
  return node.kind === "step" ? `Étape ${node.number}, ${w.fr}, ${state}` : `${w.fr}, ${state}`;
}

/**
 * Un arrêt de la voie et son libellé (SPEC §5c.2, DESIGN.md « La voie de l'accueil ») :
 * étapes en sceaux (tamponnée, à faire, à venir), villes en anneaux indigo, le mot japonais
 * avec sa lecture en kana dessous, puis le numéro et le nom.
 */
export function TrackNodeView({ node, width, meta, onTap }: Props) {
  const size = 2 * node.r;
  const box: CSSProperties = { left: node.x - node.r, top: node.y - node.r, width: size, height: size };
  const dim = node.kind !== "city" && node.dim ? 0.45 : 1;
  const square = node.kind === "step" && node.step === "exam";
  const radius = square ? "var(--radius-md)" : "50%";

  let face: React.ReactNode;
  if (node.kind === "city") {
    const ring = node.city.size === "village" ? 1 : node.city.size === "terminus" ? 3 : 2;
    face = (
      <span
        className="flex h-full w-full items-center justify-center rounded-full font-jp text-accent-2"
        style={{
          border: `${node.passed ? 3 : 2}px ${node.passed ? "solid" : "dashed"} var(--accent-2)`,
          background: node.passed ? "var(--surface)" : "var(--bg)",
          outline: ring >= 3 ? "2px solid var(--accent-2)" : undefined,
          outlineOffset: 3,
          fontSize: node.r * 0.62,
        }}
      >
        {ring >= 2 && node.passed ? (
          <span className="flex items-center justify-center rounded-full border border-accent-2" style={{ width: size - 16, height: size - 16 }}>
            {cityGlyph(node.city)}
          </span>
        ) : (
          cityGlyph(node.city)
        )}
      </span>
    );
  } else {
    const w = wordOf(node)!;
    const n = node.kind === "step" ? node.number : node.y;
    if (node.state === "done") {
      face = (
        <span
          className="flex h-full w-full items-center justify-center bg-accent"
          style={{ borderRadius: radius, transform: `rotate(${sealAngle(n)}deg)` }}
        >
          <span
            className="flex items-center justify-center border border-on-accent font-jp text-on-accent"
            style={{ width: size - 10, height: size - 10, borderRadius: square ? "3px" : "50%", fontSize: node.r * 0.72 }}
          >
            {w.icon}
          </span>
        </span>
      );
    } else if (node.state === "cur") {
      face = (
        <>
          <span
            aria-hidden="true"
            className="absolute rounded-full border border-accent/40"
            style={{ inset: -9, borderRadius: square ? "8px" : "50%" }}
          />
          <span
            className="flex h-full w-full items-center justify-center border-2 border-dashed border-accent bg-bg font-jp text-accent"
            style={{ borderRadius: radius, fontSize: node.r * 0.74 }}
          >
            {w.icon}
          </span>
        </>
      );
    } else {
      face = (
        <span
          className="flex h-full w-full items-center justify-center border border-dashed border-hairline-strong bg-bg font-jp text-muted"
          style={{ borderRadius: radius, fontSize: node.r * 0.72 }}
        >
          {w.icon}
        </span>
      );
    }
  }

  const label = node.kind === "city"
    ? {
        word: node.city.kanji,
        kana: node.city.kana,
        line:
          node.city.index === 0
            ? `Départ · ${node.city.romaji}`
            : node.city.size === "terminus"
              ? `Terminus · ${node.city.romaji}`
              : `Ville ${node.city.index} · ${node.city.romaji}`,
      }
    : (() => {
        const w = wordOf(node)!;
        return { word: w.word, kana: w.kana, line: node.kind === "step" ? `${node.number} · ${w.fr}` : w.fr };
      })();
  const labelPos: CSSProperties =
    node.side === "right"
      ? { left: node.x + node.r + 10, top: node.y - 26 }
      : { right: width - (node.x - node.r - 10), top: node.y - 26, alignItems: "flex-end", textAlign: "right" };
  const showLabel = !(node.kind !== "city" && node.state === "cur");

  return (
    <>
      <button
        type="button"
        aria-label={ariaLabel(node)}
        className="absolute cursor-pointer p-0"
        // Fond plein sous le sceau : un nœud atténué ne laisse pas voir les rails au travers.
        style={{ ...box, background: "var(--bg)", border: 0, borderRadius: node.kind === "city" ? "50%" : radius }}
        onClick={() => onTap(node)}
      >
        <span className="relative block h-full w-full" style={{ opacity: dim }}>
          {face}
        </span>
      </button>
      {showLabel && (
        <span aria-hidden="true" className="pointer-events-none absolute flex flex-col gap-0.5" style={{ ...labelPos, opacity: dim, maxWidth: 150 }}>
          <ruby className="track-ruby font-jp text-base text-text">
            {label.word}
            {label.kana && <rt>{label.kana}</rt>}
          </ruby>
          <span className="text-xs text-muted">
            {label.line}
            {meta ? ` · ${meta}` : ""}
          </span>
        </span>
      )}
    </>
  );
}
