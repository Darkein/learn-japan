// Chargeurs des données de référence.
// - Gloss littéral : JMdict-FR complet, servi en asset statique gzippé (public/jmdict-fr.json.gz,
//   produit par `npm run data:jmdict`), chargé à la demande, décompressé, puis mis en cache
//   (IndexedDB). Hors bundle JS, offline après le premier chargement.

import { deleteDictCache, getDictCache, getMeta, putDictCache, putMeta } from "./db";
import { kanaGlossOverlay } from "./inventory";
import type { ContentDict } from "./gloss";

// --- Dictionnaire de contenu (forme → gloss français) pour le gloss littéral ---------
// v2 : clés kana réattribuées au mot le plus fréquent (un « premier arrivé gagne » naïf
// donnait いる → « abattre, tirer », ない → « décédé, mort »). Changer l'ID invalide le
// cache IndexedDB des clients et déclenche la re-dérivation des sens stockés.
// v3 : `meaningFor` privilégie désormais l'inventaire curé (indexé par graphie+lecture) sur
// le JMdict indexé par graphie seule, pour désambiguïser les homographes (本|ほん « livre »
// et non « origine »). Le bump re-dérive les sens déjà figés avec l'ancienne priorité.
const DICT_ID = "jmdict-fr-v3";
const LEGACY_DICT_IDS = ["jmdict-fr", "jmdict-fr-v2"];

/**
 * Révision des SENS dérivables — dictionnaire ET overlay curé de l'inventaire réunis.
 * `meaningFor` fige le sens sur l'item au moment où il est créé : corriger un gloss dans
 * `vocab-fr.json` ne changeait rien pour un mot déjà en base, l'apprenant continuait de
 * réviser l'ancien. Le cache du JMdict ne le disait pas non plus, puisqu'il n'a pas bougé.
 * Bumper la partie `gloss` redéclenche donc la re-dérivation une seule fois, sans forcer
 * le retéléchargement de l'asset (plusieurs Mo).
 * gloss-v1 : un sens FR ne désigne plus qu'un mot (« oui » valait はい ET ええ) et les
 * qualificatifs trop étroits sont resserrés (あたたかい n'est pas réservé au climat).
 */
const MEANINGS_REV = `${DICT_ID}+gloss-v1`;
const MEANINGS_REV_KEY = "meanings.rev";

/**
 * Re-dérive les sens figés des items stockés quand `MEANINGS_REV` a changé depuis le
 * dernier passage — au plus une fois par révision. Best-effort : un échec ne doit jamais
 * empêcher le lecteur de s'ouvrir, la révision n'est alors pas marquée et sera retentée.
 */
async function refreshMeaningsIfStale(dict: ContentDict): Promise<void> {
  try {
    if ((await getMeta<string>(MEANINGS_REV_KEY)) === MEANINGS_REV) return;
    const { refreshStoredMeanings } = await import("./vocab");
    await refreshStoredMeanings(dict);
    await putMeta(MEANINGS_REV_KEY, MEANINGS_REV);
  } catch (e) {
    console.warn("[dict] re-dérivation des sens échouée :", e);
  }
}

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
 * Le dictionnaire est-il chargé ? Un appelant qui DÉDUIT quelque chose d'un sens absent
 * (voir isTrackedWord, lib/vocab.ts) doit distinguer « mot sans gloss » de « dico pas
 * encore là » — sans quoi un démarrage à froid ferait passer tout le texte pour du néant.
 */
export function hasContentDict(): boolean {
  return Object.keys(loaded).length > 0;
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
        if (cached) {
          loaded = withInventoryOverlay(cached);
          // Le cache du dico est à jour, mais les glosses curés ont pu bouger depuis.
          void refreshMeaningsIfStale(loaded);
          return loaded;
        }
        const map = await fetchAndDecompress(assetUrl());
        await putDictCache(DICT_ID, map);
        for (const id of LEGACY_DICT_IDS) await deleteDictCache(id);
        loaded = withInventoryOverlay(map);
        // Première ouverture avec cette version du dico : les items de révision créés
        // avec l'ancienne version portent des sens figés potentiellement faux → re-dérive.
        void refreshMeaningsIfStale(loaded);
        return loaded;
      } catch (e) {
        console.warn("[dict] chargement JMdict-FR échoué :", e);
        return (loaded = withInventoryOverlay({}));
      }
    })();
  }
  return dictPromise;
}

