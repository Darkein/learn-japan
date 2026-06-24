# Learn Japan — lecteur de japonais extensif et adaptatif

PWA local-first, hors-ligne, mobile-first, à usage personnel. Lecture d'histoires générées au bon
niveau, furigana et **gloss littéral déterministes** (kuromoji), révision espacée **FSRS**, et un
**mode voiture** audio. Voir [`SPEC.md`](SPEC.md), [`ROADMAP.md`](ROADMAP.md), [`DESIGN.md`](DESIGN.md).

## État : Phase 0 (fondations & déploiement)

- ✅ Squelette PWA (Vite + React + TS + vite-plugin-pwa), thème *Sumi & Washi* sombre/adaptatif.
- ✅ Furigana déterministes + gloss littéral interlinéaire (POC dans l'onglet **Lecteur**).
- ✅ SRS (FSRS) + schéma IndexedDB.
- ✅ Worker Cloudflare (squelette : `/generate` Gemini + `/status/:id`).
- ✅ Déploiement auto vers GitHub Pages.

## Développement

```bash
npm install            # installe les workspaces (app + worker)
npm run dev            # lance la PWA (copie d'abord le dico kuromoji dans app/public/dict)
npm test               # tests unitaires (furigana / gloss / SRS / kana)
npm run build          # build de production -> app/dist
```

### Données de référence (optionnel, réseau requis)

```bash
npm run data:kanji     # KanjiDic2 -> data/full/kanji.json
npm run data:jmdict    # JMdict (fr) -> data/full/jmdict-fr.json
```

Un sous-ensemble committé (`app/src/data/*.json`) suffit au POC ; les jeux complets sont produits
par ces scripts et restent locaux (gitignorés).

## Worker (génération protégée, gratuite)

```bash
cd worker
npx wrangler kv namespace create STATUS     # -> renseigner l'id dans wrangler.toml
npx wrangler r2 bucket create learn-japan-audio
npx wrangler secret put GEMINI_API_KEY      # clé Google AI Studio (free tier)
npx wrangler deploy
```

Placer **Cloudflare Access** (login email, gratuit) devant le Worker, puis `REQUIRE_ACCESS="true"`.
Aucune clé n'est exposée au client : seul le Worker détient `GEMINI_API_KEY`.

## À activer côté comptes

- **GitHub Pages** : Settings → Pages → Source = **GitHub Actions**.
- **Cloudflare** : KV + R2 + Worker + Access (voir ci-dessus).
