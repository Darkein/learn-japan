# Roadmap — Application d'apprentissage du japonais

Plan de construction par phases. Chaque phase est livrable et déployée (la PWA est en ligne dès la
Phase 0). Voir `SPEC.md` pour le détail fonctionnel.

## Stack & décisions actées
- **Tout TypeScript.** PWA front (Vite + service worker + IndexedDB). Génération en Node.
- **Furigana & gloss littéral déterministes dans le navigateur** : kuromoji/Kuroshiro + JMdict +
  table de particules. Dictionnaire **UniDic épinglé**.
- **SRS** : `ts-fsrs`.
- **Hébergement** : **GitHub Pages**, deploy auto via **GitHub Actions**, **repo public**.
- **Clés protégées** : **Cloudflare Worker** (Gemini + Google Cloud TTS), auth **Cloudflare Access** ;
  audio sur **R2**, statut sur **KV**. Aucun secret dans le client.
- **TTS** : **Google Cloud TTS** (compte GCP déjà actif).
- **Cible** : **Android-first**, iOS compatible.

---

## Phase 0 — Fondations & déploiement
**But : une PWA vide mais déployée automatiquement, et les données de référence importées.**
- Squelette PWA (Vite, manifest, service worker, installable).
- **Workflow GitHub Actions** : build + deploy vers GitHub Pages à chaque push.
- Import des bases libres : **KanjiDic, KRADFILE, KanjiVG, JMdict, JMnedict** → format local
  consommable (JSON/SQLite-wasm).
- **Furigana in-browser** : intégration kuromoji (UniDic épinglé), POC sur quelques phrases.
- **Gloss littéral** : table de particules/auxiliaires initiale + mapping JMdict (POC `暑いですね`).
- **SRS** : intégration `ts-fsrs`, schéma **IndexedDB** (3 pistes, compétences).
- **Calibrage** : import JLPT (+ stubs Anki/WaniKani).
- **Worker minimal** : Cloudflare Access + `POST /generate` (Gemini) + `GET /status/:id` + KV.

**Vérif** : la PWA s'installe et se déploie seule ; une phrase test reçoit furigana + gloss littéral
corrects hors-ligne ; le Worker répond derrière Access.

## Phase 1 — Lecteur MVP (boucle fermée)
**But : lire une histoire générée et voir le SRS se mettre à jour.**
- Pipeline génération (mode aléatoire, 2–3 mots cibles) : Gemini (texte + trad fluide + grammaire) →
  tokenisation → **furigana déterministes** → **gloss littéral**.
- Lecteur : **furigana au tap**, **panneau mot** (lecture/sens/gloss/audio/composition/mnémonique),
  **gloss littéral** sous la phrase (toggle), **trad fluide** au tap.
- **Écouter un mot** : timepoints SSML (mot en phrase) + repli Web Speech.
- Quiz minimal (compréhension + lecture kanji) → **MAJ FSRS**.
- Échauffement de révision (items urgents).

**Vérif** : session complète (échauffement → lecture → quiz) ; les bonnes/mauvaises réponses
décalent les échéances SRS.

## Phase 2 — Catalogue + tags + génération ciblée
**But : réviser et générer à la demande, sur ce qu'on choisit.**
- **Catalogue** parcourable/filtrable (statut, JLPT, tag, piste, « à revoir ») + recherche.
- **Tags** : import JLPT + tagging assisté LLM + édition manuelle.
- **Génération ciblée** : sélection (kanji/règles/tags) → contraintes prompt → « pourquoi cette
  histoire » + re-roll + longueur/difficulté.
- **File de requêtes** + **suivi de statut** (poll `/status/:id` : en_file/génération/prêt/erreur).
- Session de révision ciblée depuis une sélection du catalogue.

**Vérif** : « génère une histoire avec les animaux que je révise » → requête → statut → histoire
ciblée lisible ; le catalogue filtre correctement par tag/statut.

## Phase 3 — Mode voiture
**But : 30 min de trajet utiles, mains/yeux libres, hors-ligne.**
- Pipeline **Google Cloud TTS** pré-généré (par phrase + par segment).
- Trois formats : **bilingue**, **Pimsleur** (central), **SRS audio**.
- Player continu + **MediaSession** (play/pause/suivant, Bluetooth/volant) + **reprise**.
- **Bouton « à revoir »** (volant) → `ReviewMark` pour le quiz du soir.
- Pré-génération des pistes à la maison ; stockage **R2 / Cache API** ; lecture **offline**.

**Vérif** : une histoire lue la veille s'écoute en continu hors-ligne, contrôlable au volant ; le
bouton « à revoir » fait remonter l'item dans la révision suivante.

## Phase 4 — Finition & consolidation
**But : confort, fiabilité, motivation.**
- Composition kanji : **ordre des traits KanjiVG** animé.
- **Édition des mnémoniques** ; correction manuelle des furigana (override) ; **dico noms propres**.
- **Carte de progression** (vocab/kanji/grammaire).
- **Test de calibrage** complet + import Anki/WaniKani finalisés.
- **Export/backup** des données (chiffrable).
- **Actions cron** : pré-génération nocturne de la session du lendemain.

**Vérif** : restauration d'une sauvegarde sur un appareil vierge ; pré-génération nocturne prête au
réveil.

---

## Risques & points de vigilance
- **Lectures/furigana** : kuromoji fiable mais non infaillible → override + dico noms propres.
- **Quotas gratuits** : Gemini ~1 500 req/jour, Cloud TTS quota mensuel, Workers 100k req/jour →
  privilégier **pré-génération en lot** et **cache**, éviter les appels à la volée.
- **Vie privée** : repo public → **aucune donnée perso dans git** (SRS en IndexedDB + export privé).
- **iOS** : background audio / PWA plus limités que sur Android → tester tôt le mode voiture sur iOS.
