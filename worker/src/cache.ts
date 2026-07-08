// Cache R2 de TOUT ce que le Worker génère (texte du fournisseur, audio Cloud TTS).
//
// But : économiser le quota (« tokens ») des API amont. Une génération est une fonction
// PURE de sa requête normalisée — même requête ⇒ même contenu. On stocke donc le résultat
// dans R2 sous une clé = empreinte SHA-256 de la requête, et tout appel identique ultérieur
// est servi depuis R2 SANS rappeler Together / Cloud TTS. La pré-génération en lot
// (scripts/pregenerate.ts) remplit ce cache d'avance → l'app lit du déjà-fait.
//
// Le binding R2 est OPTIONNEL : sans bucket configuré, le Worker fonctionne comme avant
// (génération à la volée, sans cache) — utile en dev/test et tant que R2 n'est pas posé.

/** Empreinte hex SHA-256 (Web Crypto, dispo dans le Worker et en Node 22). */
export async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Clé R2 d'une génération de texte : préfixe lisible (`gen/<kind>/`) + empreinte du
 * prompt déjà composé et normalisé. Le prompt étant déterministe pour une requête donnée
 * (voir prompts.ts), deux requêtes équivalentes partagent la même clé → même cache.
 */
export async function genCacheKey(kind: string, prompt: string): Promise<string> {
  return `gen/${kind}/${await sha256Hex(prompt)}.json`;
}

/**
 * Clé R2 structurée et listable pour le cours d'une leçon.
 * Format : `gen/lesson/<lessonId>.json`, ou `gen/lesson/<lessonId>-r<rev>.json` quand la
 * leçon a été révisée (rev > 1 dans curriculum.json) — un cours généré pour d'anciens
 * objectifs ne doit jamais être resservi après un changement de contenu.
 */
export function lessonCacheKey(lessonId: string, rev = 1): string {
  return rev > 1 ? `gen/lesson/${lessonId}-r${rev}.json` : `gen/lesson/${lessonId}.json`;
}

/**
 * Clé R2 structurée et listable pour une histoire de leçon (variante).
 * Format : `gen/lesson-story/<lessonId>/<variant>.json`
 */
export function lessonStoryCacheKey(lessonId: string, variant: number): string {
  return `gen/lesson-story/${lessonId}/${variant}.json`;
}

export interface GeneratedIndex {
  [lessonId: string]: { cours: boolean; coursRev?: number; stories: number[] };
}

/**
 * Liste tout le contenu pré-généré dans R2 sous les préfixes `gen/lesson/` et
 * `gen/lesson-story/`. Renvoie un index par leçon. No-op (objet vide) si le bucket
 * n'est pas configuré.
 */
export async function listGenerated(bucket: R2Bucket | undefined): Promise<GeneratedIndex> {
  if (!bucket) return {};
  const index: GeneratedIndex = {};

  const populate = async (prefix: string, onKey: (lessonId: string, rest: string) => void) => {
    let cursor: string | undefined;
    do {
      const result: R2Objects = await bucket.list({ prefix, cursor, limit: 1000 });
      for (const obj of result.objects) {
        const after = obj.key.slice(prefix.length);
        const [lessonId, ...rest] = after.split("/");
        if (lessonId) onKey(lessonId, rest.join("/"));
      }
      cursor = result.truncated ? result.cursor : undefined;
    } while (cursor);
  };

  await populate("gen/lesson/", (lessonId, rest) => {
    if (rest) return; // unexpected subpath
    let id = lessonId.endsWith(".json") ? lessonId.slice(0, -5) : lessonId;
    if (!id) return;
    // Suffixe de révision (`<id>-r<rev>`, voir lessonCacheKey) : on expose la révision la
    // plus récente disponible, le client compare avec le rev attendu du curriculum.
    let rev = 1;
    const m = /^(.*)-r(\d+)$/.exec(id);
    if (m) {
      id = m[1];
      rev = parseInt(m[2], 10);
    }
    if (!index[id]) index[id] = { cours: false, stories: [] };
    index[id].cours = true;
    index[id].coursRev = Math.max(index[id].coursRev ?? 1, rev);
  });

  await populate("gen/lesson-story/", (lessonId, rest) => {
    const variantStr = rest.replace(".json", "");
    const variant = parseInt(variantStr, 10);
    if (!Number.isFinite(variant) || variant < 1) return;
    if (!index[lessonId]) index[lessonId] = { cours: false, stories: [] };
    if (!index[lessonId].stories.includes(variant)) index[lessonId].stories.push(variant);
  });

  return index;
}

/**
 * Clé R2 d'une synthèse vocale : empreinte des paramètres EFFECTIFS (texte/segments + voix
 * + débit + langue résolus). Deux requêtes qui aboutissent au même audio partagent la clé.
 */
export async function ttsCacheKey(parts: {
  ssml?: string;
  text?: string;
  voice: string;
  rate: number;
  languageCode: string;
}): Promise<string> {
  const norm = JSON.stringify({
    s: parts.ssml ?? "",
    t: parts.text ?? "",
    v: parts.voice,
    r: parts.rate,
    l: parts.languageCode,
  });
  return `tts/${await sha256Hex(norm)}.json`;
}

/** Lit une valeur JSON du cache R2, ou null (absence / binding non configuré / JSON cassé). */
export async function cacheGet<T>(bucket: R2Bucket | undefined, key: string): Promise<T | null> {
  if (!bucket) return null;
  const obj = await bucket.get(key);
  if (!obj) return null;
  return (await obj.json().catch(() => null)) as T | null;
}

/** Écrit une valeur JSON dans le cache R2 (no-op si binding absent). */
export async function cachePut(bucket: R2Bucket | undefined, key: string, value: unknown): Promise<void> {
  if (!bucket) return;
  await bucket.put(key, JSON.stringify(value), {
    httpMetadata: { contentType: "application/json; charset=utf-8" },
  });
}
