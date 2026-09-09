// Composition des kanji de l'inventaire → app/src/data/inventory/kanji-parts.json
// (fichier FRÈRE de kanji.json, comme les corpus de mnémos : ce script n'écrit que lui).
//
// Source : KanjiVG (CC BY-SA 3.0, cf. data/NOTICE.md), release épinglée dans scripts/kanjivg.ts.
// KanjiVG donne un ARBRE de groupes annotés — d'où le choix de cette base plutôt que KRADFILE,
// dont la liste plate mêle les sous-parties (新 y donne 斤 辛 并 木 立 亠) et remplace certains
// composants par un caractère « représentant » (亻 y devient 化).
//
// Ce qu'on extrait, pour chaque kanji : ses PARTIES de premier niveau, celle qui est le
// radical, et celle qui donne la lecture (composant phonétique).
//
//   npm run data:parts              # tous les kanji de l'inventaire
//   npm run data:parts -- --refresh # retélécharge l'asset KanjiVG (sinon cache data/full/)

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadKanjiVgXml, parseKanjiVg, type VgNode } from "./kanjivg";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const INV = join(ROOT, "app", "src", "data", "inventory");
const OUT = join(INV, "kanji-parts.json");

/** Un caractère Han unique — écarte les placeholders non-Unicode de KanjiVG (`CDP-8CB8`). */
const SINGLE_HAN = /^[\p{Script=Han}⺀-⻿㇀-㇯]$/u;

interface KanjiInvEntry {
  id: string;
  strokes?: number;
}

/** Une partie, telle qu'écrite dans le JSON (champs courts : le fichier est embarqué). */
interface PartOut {
  /** Glyphe de la partie, tel qu'il apparaît dans le tracé (亻, 目, 吾). */
  c: string;
  /** Forme de base quand `c` est une variante (亻 → 人) : porte le sens. */
  base?: string;
  /** Cette partie est LE radical du kanji. */
  rad?: 1;
  /** Cette partie donne la lecture (composant phonétique). */
  phon?: 1;
}

interface EntryOut {
  p: PartOut[];
  /** Le kanji est lui-même un radical : aucune de ses parties n'est marquée. */
  self?: 1;
}

/**
 * Parties de premier niveau, où tout groupe ANONYME est remplacé par ses propres enfants —
 * une seule mise à plat. Sans elle, 新 ne montrerait que 斤 : KanjiVG y range 立 et 木 sous
 * un groupe 亲 laissé sans `kvg:element`.
 */
function firstLevelParts(root: VgNode): VgNode[] {
  const out: VgNode[] = [];
  for (const child of root.children) {
    if (named(child) || child.children.length === 0) out.push(child);
    else out.push(...child.children);
  }
  return mergeSplitParts(out);
}

/**
 * Recolle les MORCEAUX d'un même composant (`kvg:part`) : une enceinte se trace en deux
 * temps — dans 国, KanjiVG écrit 囗 au début puis son trait de fermeture à la fin, en deux
 * groupes. On veut « 囗 + 玉 », pas « 囗 + 玉 + 囗 ». Les composants réellement répétés
 * (品 = 口 trois fois, 林 = 木 deux fois) ne portent PAS `kvg:part` et restent distincts.
 */
function mergeSplitParts(parts: VgNode[]): VgNode[] {
  const out: VgNode[] = [];
  const byElement = new Map<string, VgNode>();
  for (const part of parts) {
    const key = `${part.element ?? ""}|${part.original ?? ""}`;
    const merged = part.part ? byElement.get(key) : undefined;
    if (merged) {
      // Les traits du morceau rejoignent le composant déjà retenu : l'invariant de
      // couverture (somme des traits = traits du kanji) continue de tenir.
      merged.strokes += part.strokes;
      merged.radical ??= part.radical;
      merged.phon ??= part.phon;
      continue;
    }
    const copy: VgNode = { ...part };
    out.push(copy);
    if (part.part) byElement.set(key, copy);
  }
  return out;
}

function named(n: VgNode): boolean {
  const e = n.original ?? n.element;
  return !!e && SINGLE_HAN.test(e);
}

/**
 * Les systèmes de classement se contredisent : 聞 a 門 pour radical chez Nelson et 耳 dans
 * le classement traditionnel (Kangxi). On n'en montre QU'UN — `general` (le plus courant)
 * et, à défaut, `tradit`. Sinon la fiche annoncerait deux radicaux pour un même kanji.
 */
function radicalIndex(parts: VgNode[]): number {
  const general = parts.findIndex((p) => p.radical === "general");
  return general >= 0 ? general : parts.findIndex((p) => p.radical === "tradit");
}

async function main(): Promise<void> {
  const inventory = JSON.parse(readFileSync(join(INV, "kanji.json"), "utf8")) as KanjiInvEntry[];
  const refresh = process.argv.includes("--refresh");

  const xml = await loadKanjiVgXml(refresh);
  const vg = parseKanjiVg(xml);
  console.log(`KanjiVG : ${vg.size} caractères ; inventaire : ${inventory.length} kanji`);

  const out: Record<string, EntryOut> = {};
  let missing = 0;
  let strokeGap = 0;
  const rejected = { incomplete: 0, anonymous: 0, tooFew: 0 };

  for (const k of inventory) {
    const entry = vg.get(k.id);
    if (!entry) {
      missing += 1;
      continue;
    }
    if (k.strokes != null && entry.root.strokes !== k.strokes) {
      strokeGap += 1;
      console.warn(
        `⚠ ${k.id} : ${entry.root.strokes} traits dans KanjiVG contre ${k.strokes} dans kanji.json`,
      );
    }

    const parts = firstLevelParts(entry.root);
    // Invariant d'intégrité : une composition n'est publiée que si elle est COMPLÈTE. La
    // somme des traits des parties doit égaler celle du kanji (rien de perdu, rien compté
    // deux fois), et chaque partie doit être nommée. C'est ce qui écarte 電, dont le premier
    // niveau donnerait « 雨 + 日 » en oubliant le 乚 — mieux vaut ne rien montrer.
    const covered = parts.reduce((n, p) => n + p.strokes, 0);
    if (covered !== entry.root.strokes) {
      rejected.incomplete += 1;
      continue;
    }
    if (!parts.every(named)) {
      rejected.anonymous += 1;
      continue;
    }
    if (parts.length < 2) {
      rejected.tooFew += 1;
      continue;
    }

    const rad = radicalIndex(parts);
    const p: PartOut[] = parts.map((part, i) => {
      const element = part.element ?? part.original!;
      const item: PartOut = { c: element };
      if (part.original && part.original !== element) item.base = part.original;
      if (i === rad) item.rad = 1;
      if (part.phon) item.phon = 1;
      return item;
    });
    out[k.id] = entry.root.radical ? { p, self: 1 } : { p };
  }

  const parts = Object.values(out);
  const components = new Set(parts.flatMap((e) => e.p.map((x) => x.base ?? x.c)));
  writeFileSync(OUT, `${JSON.stringify(out, null, 0)}\n`, "utf8");

  console.log(`✓ ${OUT}`);
  console.log(`  ${parts.length} kanji décomposés (${components.size} composants distincts)`);
  console.log(
    `  écartés : ${rejected.incomplete} composition incomplète, ${rejected.anonymous} partie anonyme, ${rejected.tooFew} moins de deux parties`,
  );
  console.log(
    `  ${parts.filter((e) => e.self).length} kanji sont eux-mêmes des radicaux ; ` +
      `${parts.filter((e) => e.p.some((x) => x.phon)).length} portent un composant phonétique`,
  );
  if (missing) console.warn(`⚠ ${missing} kanji de l'inventaire absents de KanjiVG`);
  if (strokeGap) console.warn(`⚠ ${strokeGap} écart(s) de compte de traits (voir ci-dessus)`);
}

main().catch((e) => {
  console.error("[parts] échec :", e);
  process.exit(1);
});
