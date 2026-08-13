# Learn Japan — lecteur de japonais extensif et adaptatif

PWA local-first, hors-ligne, mobile-first, à usage personnel. Lecture d'histoires générées au bon
niveau, furigana et **gloss littéral déterministes** (kuromoji), révision espacée **FSRS**, et un
**mode voiture** audio. Voir [`SPEC.md`](SPEC.md), [`ROADMAP.md`](ROADMAP.md), [`DESIGN.md`](DESIGN.md).

## État

**Phase 0 — fondations & déploiement** ✅
- PWA (Vite + React + TS + vite-plugin-pwa), thème *Sumi & Washi* sombre/adaptatif.
- Furigana déterministes + gloss littéral interlinéaire.
- SRS (FSRS) + schéma IndexedDB. Worker Cloudflare (`/generate` Together AI, synchrone).
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
la main et n'est pas régénéré. Un gloss FR ne doit désigner **qu'un seul** mot (les exercices
peuvent partir du sens pour demander le mot) : ajouter une entrée dont le sens existe déjà fait
échouer `lib/inventory.test.ts`, qui attend un couple sens ↔ mot unique.
Voir [`SPEC.md`](SPEC.md) §3.1 pour le modèle curriculum à deux couches.

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

Génération **synchrone** via **Together AI** (API compatible OpenAI). Une seule clé à poser :

```bash
cd worker
npx wrangler secret put TOGETHER_API_KEY    # clé Together AI (texte + images)
```

Le déploiement du Worker est ensuite **automatique** (workflow `deploy-worker.yml`).
Aucune clé n'est exposée au client : seul le Worker détient `TOGETHER_API_KEY`.
Modèle par défaut : `Qwen/Qwen2.5-72B-Instruct-Turbo` (excellent en japonais), repli Llama 3.3 70B ;
images via `FLUX.1-schnell-Free`. Gemini reste utilisable en **repli** via `MODEL_CHAIN` (voir
`wrangler.toml`). Option : placer **Cloudflare Access** devant le Worker puis `REQUIRE_ACCESS="true"`.

### Cache R2 + pré-génération en lot (économiser les « tokens »)

Tout ce que le Worker génère (textes **et** audio Cloud TTS) est **mis en cache sur
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
surchargeable via `WORKER_URL=https://…`. Le même batch se lance **depuis GitHub** sans
rien installer : workflow manuel **Pregenerate lesson content** (onglet Actions —
options niveau / limite / cours seuls / refresh).

### Mettre à jour les leçons (changement de curriculum)

1. **Merger** le changement de `curriculum.json` (mêmes ids de leçons = progression
   locale conservée).
2. **Lancer** le workflow *Pregenerate lesson content* avec **refresh** coché : les clés
   R2 des cours/histoires de leçon sont par id (`gen/lesson/<id>.json`) — sans refresh,
   l'ancien contenu serait resservi.
3. Sur l'appareil, rien à faire : chaque cours généré porte une **empreinte des objectifs**
   de sa leçon ; si le curriculum a changé, l'app régénère le cours à l'ouverture (avec
   `refresh` côté Worker), en gardant l'ancien tant que la régénération n'a pas abouti.
   Les histoires déjà générées restent lisibles telles quelles.

## Tout automatisé depuis GitHub — réglages uniques

Deux workflows tournent à chaque push : `deploy.yml` (PWA → Pages) et
`deploy-worker.yml` (Worker → Cloudflare). À configurer **une fois** :

| Où | Quoi | Valeur |
|---|---|---|
| Settings → Pages | Source | **GitHub Actions** |
| Settings → Secrets and variables → Actions → **Secrets** | `CLOUDFLARE_API_TOKEN` | token Cloudflare (perm. *Edit Cloudflare Workers*) |
| idem → **Secrets** | `CLOUDFLARE_ACCOUNT_ID` | *(optionnel, si le token couvre plusieurs comptes)* |
| idem → **Variables** | `VITE_WORKER_URL` | `https://learn-japan-gen.<sous-domaine>.workers.dev` |
| idem → **Variables** | `VITE_VAPID_PUBLIC_KEY` | *(optionnel — rappel quotidien, voir ci-dessous)* |

Le secret Together (`wrangler secret put TOGETHER_API_KEY`) reste posé directement sur le
Worker, hors GitHub. Une fois ces réglages faits, **tout se teste depuis l'URL Pages**,
génération réelle incluse — plus aucun dev local requis.

### Rappel quotidien (Web Push) — optionnel

Sans configuration, les rappels restent **locaux** : badge d'icône, notification à
l'ouverture de l'app, et periodic background sync sur Chrome/Edge installé. Aucun de ces
mécanismes ne peut sonner **à une heure choisie app fermée**, et aucun n'existe sur iOS.

Le Web Push comble ce trou. Le Worker envoie un push **sans charge utile** à l'heure dite : il
ne transporte rien, il réveille le service worker, qui rédige la notification sur l'appareil
depuis IndexedDB. Le serveur ne stocke qu'un endpoint opaque, l'heure et le fuseau — jamais
une carte, jamais un mot. Voir `worker/src/push.ts` et `app/src/sw.ts`.

Générer la paire de clés VAPID (aucune dépendance à installer) :

```bash
node -e 'const c=require("crypto").webcrypto;(async()=>{
const k=await c.subtle.generateKey({name:"ECDSA",namedCurve:"P-256"},true,["sign","verify"]);
console.log("VAPID_PUBLIC_KEY ",Buffer.from(await c.subtle.exportKey("raw",k.publicKey)).toString("base64url"));
console.log("VAPID_PRIVATE_KEY",(await c.subtle.exportKey("jwk",k.privateKey)).d)})()'
```

Puis, **une fois** :

| Où | Quoi |
|---|---|
| Worker | `wrangler secret put VAPID_PUBLIC_KEY` (la clé publique) |
| Worker | `wrangler secret put VAPID_PRIVATE_KEY` (la clé privée — ne quitte jamais le Worker) |
| Worker | `wrangler secret put VAPID_SUBJECT` → `mailto:toi@exemple.fr` (Apple l'exige) |
| GitHub → **Variables** | `VITE_VAPID_PUBLIC_KEY` = la **même clé publique** |

Le bucket `learn-japan-progress` (déjà créé pour la sync) porte aussi les abonnements, sous le
préfixe `push/` — rien de plus à provisionner. Le cron horaire est déclaré dans
`wrangler.toml` (`[triggers]`) : chaque abonnement porte son heure locale, la passe ne notifie
que ceux dont c'est l'heure et dont la journée n'est pas déjà bouclée.

Vérifier : `curl https://<worker>/` renvoie `"push": true` quand tout est en place.

⚠️ `"push": true` ne dit RIEN du cron — il ne regarde que les secrets et le bucket. Il faut
vérifier le trigger **séparément** (dashboard Cloudflare → le Worker → *Settings* →
*Triggers* → *Cron Triggers*, ou `npx wrangler triggers deploy` depuis `worker/`) : sans lui,
la passe horaire n'a jamais lieu et aucun rappel programmé ne part, alors que tout le reste a
l'air en ordre. C'est un piège vécu — le token CI peut très bien uploader le script et se voir
refuser l'appel à `/schedules`, `wrangler deploy` échouant *après* un « Uploaded » rassurant.

En **dev local**, mettre les trois clés dans `worker/.dev.vars` (ignoré par git), puis :

```bash
npx wrangler dev                                    # dans worker/
curl "http://localhost:8787/cdn-cgi/handler/scheduled"   # déclenche la passe sans attendre l'heure
```

À savoir : `[secrets] required` dans `wrangler.toml` est une **liste blanche pour le dev
local** — `wrangler dev` n'injecte de `.dev.vars` que les clés qui y sont nommées. En
production elle ne filtre rien (un `wrangler secret put` est toujours injecté), et un nom
listé mais absent ne produit qu'un avertissement au démarrage.

**Sur iPhone/iPad, l'app doit être ajoutée à l'écran d'accueil** (iOS 16.4+) : c'est la seule
façon dont iOS autorise les notifications web. Les réglages de l'app le rappellent sur place.
