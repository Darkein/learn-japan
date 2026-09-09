// Ordre des traits d'un kanji : les tracés SVG, dans l'ordre d'écriture.
//
// Corpus : app/public/kanji-strokes-n{5..1}.json.gz, extraits de KanjiVG par
// scripts/build-kanji-strokes.ts. Assets statiques gzippés servis tels quels (même patron
// que jmdict-fr.json.gz, cf. lib/data.ts) : hors bundle, chargés à la demande, mis en cache
// par le service worker (route CacheFirst dans sw.ts) → hors-ligne après un premier affichage.
//
// Découpés par niveau JLPT parce que les 2211 kanji pèsent ≈ 545 Ko : ouvrir la fiche de 日
// télécharge les 13 Ko du N5, pas les 333 Ko du N1. Une promesse par niveau, mémoïsée.

import { kanjiDetail } from "./inventory";

/** Grille de KanjiVG : tous les tracés vivent dans un carré de 109 unités. */
export const STROKES_VIEWBOX = 109;

type StrokeMap = Record<string, string[]>;

const byLevel = new Map<number, Promise<StrokeMap>>();

function assetUrl(level: number): string {
  const base =
    typeof import.meta !== "undefined" && import.meta.env?.BASE_URL
      ? import.meta.env.BASE_URL
      : "/";
  return `${base}kanji-strokes-n${level}.json.gz`;
}

async function fetchLevel(level: number): Promise<StrokeMap> {
  const res = await fetch(assetUrl(level));
  if (!res.ok) throw new Error(`Tracés N${level} introuvables (${res.status})`);
  const buf = new Uint8Array(await res.arrayBuffer());
  // Selon l'hébergeur, l'asset .gz arrive en octets gzip bruts ou DÉJÀ décompressé (si le
  // serveur a posé `Content-Encoding: gzip`, le navigateur l'a déballé tout seul). Même
  // précaution que lib/data.ts : on ne décompresse que si le magic gzip est là.
  const isGzip = buf.length > 2 && buf[0] === 0x1f && buf[1] === 0x8b;
  const text = isGzip
    ? await new Response(
        new Blob([buf]).stream().pipeThrough(new DecompressionStream("gzip")),
      ).text()
    : new TextDecoder().decode(buf);
  return JSON.parse(text) as StrokeMap;
}

/**
 * Tracés d'un kanji, dans l'ordre d'écriture — tableau vide s'il n'est pas dans l'inventaire
 * ou si l'asset de son niveau n'est pas joignable (la fiche reste utilisable sans).
 */
export async function kanjiStrokes(ch: string): Promise<string[]> {
  const level = kanjiDetail(ch)?.level;
  if (level == null) return [];
  let pending = byLevel.get(level);
  if (!pending) {
    pending = fetchLevel(level);
    byLevel.set(level, pending);
  }
  try {
    return (await pending)[ch] ?? [];
  } catch (e) {
    // Un échec réseau ne doit pas figer le niveau sur une promesse rejetée : la prochaine
    // fiche retentera (l'utilisateur a pu retrouver du réseau entre-temps).
    byLevel.delete(level);
    console.warn("[strokes] chargement échoué :", e);
    return [];
  }
}
