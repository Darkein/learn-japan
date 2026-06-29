# Learn Japan — lecteur de japonais extensif et adaptatif

PWA local-first, hors-ligne, mobile-first, à usage personnel. Lecture d'histoires générées au bon
niveau, furigana et **gloss littéral déterministes** (kuromoji), révision espacée **FSRS**, et un
**mode voiture** audio. Voir [`SPEC.md`](SPEC.md), [`ROADMAP.md`](ROADMAP.md), [`DESIGN.md`](DESIGN.md).

## État

**Phase 0 — fondations & déploiement** ✅
- PWA (Vite + React + TS + vite-plugin-pwa), thème *Sumi & Washi* sombre/adaptatif.
- Furigana déterministes + gloss littéral interlinéaire.
- SRS (FSRS) + schéma IndexedDB. Worker Cloudflare (`/generate` Gemini, synchrone).
- Déploiement auto : PWA → GitHub Pages, Worker → Cloudflare (GitHub Actions).

**Phase 1 — boucle de lecture** (en cours)
- ✅ Génération ciblée (thème / kanji / grammaire / JLPT) via le Worker → texte annoté.
- ✅ Panneau mot (tap) → SRS : connu / à revoir / oublié, persistance + soulignement par statut.
- ✅ Quiz de lecture déterministe (lecture de kanji + particule) → pistes kanji & grammaire.
- ✅ Histoires persistées + « pourquoi cette histoire » (onglet **Histoires**).
- ✅ Échauffement SRS des éléments dus (onglet **Réviser**).
- ⏳ À venir : compréhension QCM (LLM), mode voiture (TTS), catalogue/tags (Phase 2).

## Développement

```bash
npm install            # installe les workspaces (app + worker)
npm run dev            # lance la PWA (copie d'abord le dico kuromoji dans app/public/dict)
npm test               # tests unitaires (furigana / gloss / SRS / kana)
npm run build          # build de production -> app/dist
```

### Données de référence (réseau requis)

```bash
npm run data:inventory # kanji-data + open-anki-jlpt-decks -> app/src/data/inventory/{kanji,vocab}.json
npm run data:jmdict    # JMdict-FR (jmdict-simplified) -> app/src/../public/jmdict-fr.json.gz (asset committé, ~0.4 Mo)
npm run curriculum:check  # vérifie la cohérence du curriculum (couverture, prérequis, références)
```

L'**inventaire** (`app/src/data/inventory/`) est le référentiel committé : `kanji.json` et
`vocab.json` sont (re)générés par `data:inventory` ; les sens **français** sont curés dans les
overlays `kanji-fr.json` / `vocab-fr.json` (repli sur l'anglais sinon) ; `grammar.json` est curé à
la main et n'est pas régénéré. Voir [`SPEC.md`](SPEC.md) §3.1 pour le modèle curriculum à deux couches.

Le **gloss littéral** du lecteur s'appuie sur **JMdict-FR complet** (`data:jmdict` → asset gzippé
`app/public/jmdict-fr.json.gz`, servi hors-bundle comme le dico kuromoji) : chargé à la demande,
décompressé puis mis en cache (IndexedDB) → offline après le premier usage.

> ⚠️ **Listes JLPT non officielles.** Depuis 2010, la Japan Foundation ne publie plus de
> référentiel kanji/vocabulaire/grammaire. L'inventaire s'appuie sur des datasets ouverts (MIT) qui
> reconstruisent ces listes d'après le consensus des manuels (Genki, Minna no Nihongo) et les listes
> communautaires (Tanos / Jonathan Waller) : sources de
> [kanji](https://github.com/davidluzgouveia/kanji-data) et de
> [vocabulaire](https://github.com/jamsinclair/open-anki-jlpt-decks).

## Worker (génération protégée, gratuite)

Génération **synchrone**. La seule clé indispensable à poser sur le Worker est Gemini :

```bash
cd worker
npx wrangler secret put GEMINI_API_KEY      # clé Google AI Studio (free tier)
```

Le déploiement du Worker est ensuite **automatique** (workflow `deploy-worker.yml`).
Aucune clé n'est exposée au client : seul le Worker détient `GEMINI_API_KEY`.
Option : placer **Cloudflare Access** devant le Worker puis `REQUIRE_ACCESS="true"`.

### Cache R2 + pré-génération en lot (économiser les « tokens »)

Tout ce que le Worker génère (textes Gemini **et** audio Cloud TTS) est **mis en cache sur
R2** sous une clé déterministe : un appel identique ultérieur est servi depuis R2 **sans
rappeler** l'API amont → on économise le quota. Deux buckets, déclarés dans `wrangler.toml` :
`learn-japan-content` (`GEN_CACHE`, textes) et `learn-japan-audio` (`TTS_CACHE`, audio).
Les créer une fois si besoin :

```bash
npx wrangler r2 bucket create learn-japan-content
npx wrangler r2 bucket create learn-japan-audio
```

> Le token `CLOUDFLARE_API_TOKEN` du déploiement doit alors couvrir **Workers R2 Storage**
> (en plus d'*Edit Cloudflare Workers*) pour que `wrangler deploy` accepte les bindings.
> Les bindings sont **optionnels** : sans bucket, le Worker génère à la volée, sans cache.

Pour **remplir** ce cache d'avance (l'app sert alors du déjà-fait), un batch parcourt tout
le curriculum et génère cours + histoire + traduction + QCM de chaque leçon :

```bash
npm run content:batch                  # tout le curriculum (idempotent : un 2ᵉ passage est gratuit)
npm run content:batch -- --level 5     # un seul niveau
npm run content:batch -- --limit 3     # essai rapide (3 leçons)
npm run content:batch -- --refresh     # ignore le cache et régénère
```

Le batch ne parle qu'au Worker (aucune clé en local). Cible par défaut l'URL déployée ;
surchargeable via `WORKER_URL=https://…`.

## Tout automatisé depuis GitHub — réglages uniques

Deux workflows tournent à chaque push : `deploy.yml` (PWA → Pages) et
`deploy-worker.yml` (Worker → Cloudflare). À configurer **une fois** :

| Où | Quoi | Valeur |
|---|---|---|
| Settings → Pages | Source | **GitHub Actions** |
| Settings → Secrets and variables → Actions → **Secrets** | `CLOUDFLARE_API_TOKEN` | token Cloudflare (perm. *Edit Cloudflare Workers*) |
| idem → **Secrets** | `CLOUDFLARE_ACCOUNT_ID` | *(optionnel, si le token couvre plusieurs comptes)* |
| idem → **Variables** | `VITE_WORKER_URL` | `https://learn-japan-gen.<sous-domaine>.workers.dev` |

Le secret Gemini (`wrangler secret put GEMINI_API_KEY`) reste posé directement sur le
Worker, hors GitHub. Une fois ces réglages faits, **tout se teste depuis l'URL Pages**,
génération réelle incluse — plus aucun dev local requis.
