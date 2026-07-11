// Chargeurs des données de référence.
// - Gloss littéral : JMdict-FR complet, servi en asset statique gzippé (public/jmdict-fr.json.gz,
//   produit par `npm run data:jmdict`), chargé à la demande, décompressé, puis mis en cache
//   (IndexedDB). Hors bundle JS, offline après le premier chargement.

import { deleteDictCache, getDictCache, putDictCache } from "./db";
import { kanaGlossOverlay } from "./inventory";
import type { ContentDict } from "./gloss";

// --- Dictionnaire de contenu (forme → gloss français) pour le gloss littéral ---------
// v2 : clés kana réattribuées au mot le plus fréquent (un « premier arrivé gagne » naïf
// donnait いる → « abattre, tirer », ない → « décédé, mort »). Changer l'ID invalide le
// cache IndexedDB des clients et déclenche la re-dérivation des sens stockés.
const DICT_ID = "jmdict-fr-v2";
const LEGACY_DICT_IDS = ["jmdict-fr"];

function assetUrl(): string {
  const base =
    typeof import.meta !== "undefined" && import.meta.env?.BASE_URL
      ? import.meta.env.BASE_URL
      : "/";
  return `${base}jmdict-fr.json.gz`;
}

async function fetchAndDecompress(url: string): Promise<ContentDict> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`JMdict-FR introuvable (${res.status})`);
  const buf = new Uint8Array(await res.arrayBuffer());
  // Selon l'hébergeur, l'asset .gz peut arriver en octets gzip bruts ou DÉJÀ décompressé
  // (si le serveur a posé `Content-Encoding: gzip`, le navigateur l'a déballé tout seul).
  // On ne décompresse que si l'en-tête gzip (magic 0x1f 0x8b) est présent.
  const isGzip = buf.length > 2 && buf[0] === 0x1f && buf[1] === 0x8b;
  const text = isGzip
    ? await new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream("gzip"))).text()
    : new TextDecoder().decode(buf);
  return JSON.parse(text) as ContentDict;
}

let dictPromise: Promise<ContentDict> | null = null;
let loaded: ContentDict = {};

/**
 * Vue synchrone du dictionnaire déjà chargé (vide tant que `loadContentDict` n'a pas résolu).
 * Sûr pour les usages synchrones (panneau mot) : le lecteur charge le dico via `analyze()`
 * avant toute interaction.
 */
export function contentDictSnapshot(): ContentDict {
  return loaded;
}

/**
 * Superpose les glosses curés de l'inventaire aux clés kana du JMdict : pour une
 * forme kana ambiguë (いる, ない…), le mot du curriculum doit gagner sur l'homophone
 * choisi par le dictionnaire. Appliqué à chaque chargement (le cache stocke la map brute).
 */
function withInventoryOverlay(map: ContentDict): ContentDict {
  return { ...map, ...kanaGlossOverlay() };
}

/**
 * Charge (une seule fois) le dictionnaire de contenu : cache IndexedDB d'abord, sinon
 * asset statique gzippé → décompression → parse → mise en cache. Si tout échoue, renvoie
 * le seul overlay inventaire (les autres mots retombent sur leur forme de base, jamais d'erreur).
 */
export function loadContentDict(): Promise<ContentDict> {
  if (!dictPromise) {
    dictPromise = (async () => {
      try {
        const cached = await getDictCache(DICT_ID);
        if (cached) return (loaded = withInventoryOverlay(cached));
        const map = await fetchAndDecompress(assetUrl());
        await putDictCache(DICT_ID, map);
        for (const id of LEGACY_DICT_IDS) await deleteDictCache(id);
        loaded = withInventoryOverlay(map);
        // Première ouverture avec cette version du dico : les items de révision créés
        // avec l'ancienne version portent des sens figés potentiellement faux → re-dérive.
        void import("./vocab")
          .then((m) => m.refreshStoredMeanings(loaded))
          .catch((e) => console.warn("[dict] re-dérivation des sens échouée :", e));
        return loaded;
      } catch (e) {
        console.warn("[dict] chargement JMdict-FR échoué :", e);
        return (loaded = withInventoryOverlay({}));
      }
    })();
  }
  return dictPromise;
}

