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
npm run data:jmdict    # JMdict (fr) -> data/full/jmdict-fr.json (gloss littéral, gros fichier local)
npm run curriculum:check  # vérifie la cohérence du curriculum (couverture, prérequis, références)
```

L'**inventaire** (`app/src/data/inventory/`) est le référentiel committé : `kanji.json` et
`vocab.json` sont (re)générés par `data:inventory` ; les sens **français** sont curés dans les
overlays `kanji-fr.json` / `vocab-fr.json` (repli sur l'anglais sinon) ; `grammar.json` est curé à
la main et n'est pas régénéré. Voir [`SPEC.md`](SPEC.md) §3.1 pour le modèle curriculum à deux couches.

> ⚠️ **Listes JLPT non officielles.** Depuis 2010, la Japan Foundation ne publie plus de
> référentiel kanji/vocabulaire/grammaire. L'inventaire s'appuie sur des datasets ouverts (MIT) qui
> reconstruisent ces listes d'après le consensus des manuels (Genki, Minna no Nihongo) et les listes
> communautaires (Tanos / Jonathan Waller) : sources de
> [kanji](https://github.com/davidluzgouveia/kanji-data) et de
> [vocabulaire](https://github.com/jamsinclair/open-anki-jlpt-decks).

## Worker (génération protégée, gratuite)

Génération **synchrone** : pas de KV ni de R2 à provisionner. La seule chose à poser
sur le Worker est la clé Gemini :

```bash
cd worker
npx wrangler secret put GEMINI_API_KEY      # clé Google AI Studio (free tier)
```

Le déploiement du Worker est ensuite **automatique** (workflow `deploy-worker.yml`).
Aucune clé n'est exposée au client : seul le Worker détient `GEMINI_API_KEY`.
Option : placer **Cloudflare Access** devant le Worker puis `REQUIRE_ACCESS="true"`.

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
