// Accès partagé à KanjiVG — la base de tracés qui sert DEUX corpus :
//  - la composition d'un kanji en parties (scripts/build-kanji-parts.ts) ;
//  - l'ordre des traits (scripts/build-kanji-strokes.ts).
//
// Source : release ÉPINGLÉE du dépôt KanjiVG (CC BY-SA 3.0, cf. data/NOTICE.md). On épingle
// une version plutôt que de suivre `master` pour la même raison qu'ailleurs dans ce repo
// (UniDic, jmdict-pri) : une régénération doit être reproductible, et une base de tracés
// bouge lentement.
//
// L'archive fait 3,6 Mo : les deux scripts la partagent via un cache local sous data/full/
// (gitignoré, comme les autres datasets complets). Passer --refresh pour la retélécharger.

import { gunzipSync } from "node:zlib";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Version épinglée — changer les DEUX (le tag et le nom de fichier) ensemble. */
export const KANJIVG_RELEASE = "r20240807";
const KANJIVG_FILE = "kanjivg-20240807.xml.gz";
const KANJIVG_URL = `https://github.com/KanjiVG/kanjivg/releases/download/${KANJIVG_RELEASE}/${KANJIVG_FILE}`;
const CACHE = join(ROOT, "data", "full", KANJIVG_FILE);

/** XML KanjiVG complet (≈ 13 Mo décompressés), depuis le cache local ou le réseau. */
export async function loadKanjiVgXml(refresh = false): Promise<string> {
  if (!refresh && existsSync(CACHE)) return gunzipSync(readFileSync(CACHE)).toString("utf8");
  mkdirSync(dirname(CACHE), { recursive: true });
  console.log(`↓ ${KANJIVG_URL}`);
  const res = await fetch(KANJIVG_URL);
  if (!res.ok) throw new Error(`KanjiVG ${KANJIVG_RELEASE} introuvable (HTTP ${res.status})`);
  const gz = Buffer.from(await res.arrayBuffer());
  writeFileSync(CACHE, gz);
  console.log(`  ${KANJIVG_FILE} : ${(gz.byteLength / 1024 / 1024).toFixed(1)} Mo → data/full/`);
  return gunzipSync(gz).toString("utf8");
}

/** Un nœud `<g>` de l'arbre d'un kanji. */
export interface VgNode {
  /** `kvg:element` — le caractère que ce groupe dessine (absent : groupe anonyme). */
  element?: string;
  /** `kvg:original` — forme de base quand `element` est une variante (亻 → 人). */
  original?: string;
  /** `kvg:radical` — système de classement qui voit ce groupe comme LE radical. */
  radical?: string;
  /** `kvg:phon` — ce groupe donne la lecture (composant phonétique). */
  phon?: string;
  /**
   * `kvg:part` — ce groupe n'est qu'un MORCEAU d'un composant dont les traits ne se
   * suivent pas. Une enceinte en est le cas type : dans 国, KanjiVG écrit 囗 en deux
   * groupes (le coin, puis le trait de fermeture tracé en dernier), qui désignent UN seul
   * composant. Sans ce champ, la composition afficherait « 囗 + 玉 + 囗 ».
   */
  part?: string;
  /** Traits (`<path>`) contenus, ce nœud et ses descendants compris. */
  strokes: number;
  children: VgNode[];
}

/** Un kanji de KanjiVG : son arbre de groupes et ses tracés dans l'ordre d'écriture. */
export interface VgKanji {
  ch: string;
  root: VgNode;
  /** Attribut `d` de chaque `<path>`, dans l'ordre du fichier = l'ordre d'écriture. */
  paths: string[];
}

const ATTR = /(kvg:\w+)="([^"]*)"/g;
const KANJI_BLOCK = /<kanji id="kvg:kanji_([0-9a-f]+)[^"]*">([\s\S]*?)<\/kanji>/g;

/**
 * Découpe le XML en un kanji par caractère. Le fichier contient des variantes graphiques
 * (`kvg:kanji_09038-Kaisho` etc.) ; on garde la PREMIÈRE forme rencontrée pour un caractère
 * donné, qui est la forme standard.
 */
export function parseKanjiVg(xml: string): Map<string, VgKanji> {
  const out = new Map<string, VgKanji>();
  for (const m of xml.matchAll(KANJI_BLOCK)) {
    const code = Number.parseInt(m[1], 16);
    const ch = String.fromCodePoint(code);
    if (out.has(ch)) continue;
    out.set(ch, { ch, ...parseBlock(m[2]) });
  }
  return out;
}

/**
 * Reconstruit l'arbre d'un bloc `<kanji>` ligne par ligne. KanjiVG écrit une balise par
 * ligne, ce qui rend un parseur XML complet inutile ici (et le repo n'en embarque pas).
 */
function parseBlock(body: string): { root: VgNode; paths: string[] } {
  const root: VgNode = { strokes: 0, children: [] };
  const stack: VgNode[] = [root];
  const paths: string[] = [];
  for (const raw of body.split("\n")) {
    const line = raw.trim();
    if (line.startsWith("<g ")) {
      const node: VgNode = { strokes: 0, children: [] };
      for (const [, k, v] of line.matchAll(ATTR)) {
        if (k === "kvg:element") node.element = v;
        else if (k === "kvg:original") node.original = v;
        else if (k === "kvg:radical") node.radical = v;
        else if (k === "kvg:phon") node.phon = v;
        else if (k === "kvg:part") node.part = v;
      }
      stack[stack.length - 1].children.push(node);
      if (!line.endsWith("/>")) stack.push(node);
    } else if (line.startsWith("</g>")) {
      if (stack.length > 1) stack.pop();
    } else if (line.startsWith("<path")) {
      const d = /\bd="([^"]+)"/.exec(line)?.[1];
      if (d) paths.push(d);
      for (const node of stack) node.strokes += 1;
    }
  }
  // Le `<g>` racine du bloc porte le kanji entier ; on le remonte pour que `root.children`
  // soit la première décomposition (et non un unique enfant qui est le kanji lui-même).
  const only = root.children.length === 1 ? root.children[0] : root;
  return { root: only, paths };
}
