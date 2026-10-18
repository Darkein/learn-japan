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
- **Curriculum d'accueil** (SPEC §3.1) : onglet « Apprendre » par défaut, liste ordonnée de leçons
  N5 (seed manuel + génération à la demande pour les suivantes). Histoires liées par `lessonId`.
- Pipeline génération (mode aléatoire, 2–3 mots cibles) : Gemini (texte + trad fluide + grammaire) →
  tokenisation → **furigana déterministes** → **gloss littéral aligné mot-à-mot** (colonnes par token).
- Lecteur : **furigana au tap**, **panneau mot** (lecture/sens/gloss/audio/composition/mnémonique),
  **gloss littéral** sous chaque mot (toggle masquer), **trad fluide** au tap, **génération libre
  reléguée en Mode avancé**.
- **Écouter un mot** : timepoints SSML (mot en phrase) + repli Web Speech.
- Quiz minimal (compréhension + lecture kanji) → **MAJ FSRS**.
- Échauffement de révision (items urgents).
- **Contrôle de fin de leçon** (SPEC §5b) : épreuve notée /20 (le 関所), corrigée seulement à
  la remise de la copie ; l'admission débloque la leçon suivante, le rattrapage exige d'avoir
  revu les éléments ratés.

**Vérif** : session complète (échauffement → lecture → quiz) ; les bonnes/mauvaises réponses
décalent les échéances SRS ; un débutant peut suivre le curriculum sans toucher au Mode avancé.

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
- ~~Composition kanji : **ordre des traits KanjiVG** animé~~ — fait, avec la décomposition en
  parties (radical, composant phonétique) sur la fiche kanji.
- **Édition des mnémoniques** ; correction manuelle des furigana (override) ; **dico noms propres**.
- **Carte de progression** (vocab/kanji/grammaire).
- **Test de calibrage** complet + import Anki/WaniKani finalisés.
- **Export/backup** des données (chiffrable).
- **Actions cron** : pré-génération nocturne de la session du lendemain.

**Vérif** : restauration d'une sauvegarde sur un appareil vierge ; pré-génération nocturne prête au
réveil.

## Phase 5 — Le parcours (SPEC §5)
**But : une progression prévisible, des étapes qu'on suit, une séance sans fin.**
- **Modèle et flux** : étapes d'une leçon et leur progression enregistrée, `pickNext` sans fin
  (étape suivante, révision insérée), contrôle en 7e étape (fin de `examEligibility`), jauge par
  étapes, reprise des bases existantes. Fin du débit de nouveautés et de son frein, cible de
  rétention fixe à 90 %, première réponse seule notée (fin de la seconde chance), exercices
  d'histoire sans carte pour les mots incidents. Nouvelle version du schéma et de la synchro.
- **Tout ce qui comptait en cartes** (SPEC §5.8) : réglages (objectif en étapes, « Nouveaux
  mots par jour » retiré), accueil, statistiques, rappels et badge, série de jours, omikuji,
  position sur le Tōkaidō, Catalogue et « Je connais ».
- **Séances d'étape** : assemblage par niveau (reconnaître, rappeler, produire), trois réussites
  par élément, ratés rejoués en fin d'étape, étape Révision (dû, rappels N−1 et N−3, éléments
  fragiles), station de repos toutes les 5 leçons. Mesure de la forme, du niveau et de la durée de
  chaque exercice.
- **Écran du parcours** : les stations de la leçon sur la route, durée annoncée de chaque étape,
  objectif du jour en étapes (série, rappels, omikuji).
- **Matière de grammaire** : phrases d'exemple supplémentaires par point (corpus, puis Worker)
  pour les niveaux 2 et 3.

**Vérif** : une leçon se termine en un nombre d'étapes connu d'avance, sans jamais rester figée ;
avec un gros retard, une révision s'insère avant chaque étape nouvelle, et le parcours continue.

## Phase 6 — L'accueil : la voie du voyage (SPEC §5c)
**But : le parcours comme information principale de l'accueil, sur une voie ferrée sans fin, dans
le décor réel des cinq routes.**
- **Voyage par étapes** : numérotation globale des étapes, villes fixées par étape, position sur
  la route = étapes faites du niveau, fin des bonus du contrôle et de l'omikuji (tampon de
  fortune à la place), tampons de ville, reprise des bases existantes, Voyage exact.
- **Mise en page de la voie** : module pur qui range les nœuds (étapes, villes, révisions
  insérées, station de repos, séparateurs, fin de route), calcule le tracé, les zones
  interdites et les arrêts du train.
- **L'accueil** : en-tête, bandeau de leçon, la voie (rails, sceaux, libellés en kana, numéros),
  bulle de l'étape à faire, train animé, défilement par blocs, retour à l'étape ; les cartes qui
  quittent l'accueil trouvent leur place (Histoires, Catalogue, Voyage).
- **Tampons et changement de niveau** : tampons à côté des villes, arrivée en gare avec pose du
  tampon, carnet dans le Voyage, fin de route, correspondance et nouveau train, fin du curriculum.
- **Le décor** : jeu de sprites, paysages et remplissage, règles d'agencement, ciel selon l'heure,
  saisons du calendrier, tokens de décor.
- **La route réelle** : données des cinq routes (taille des villes, repères réels, paysages,
  traversées, motifs des tampons) et illustrations uniques.
- **L'horizon** : le ciel séparé de la voie par une ligne d'horizon, panorama du départ qui se
  replie, sol en perspective où la voie s'enfonce sans couture, repères des villes qui se
  lèvent dans le ciel.

**Vérif** : l'accueil s'ouvre sur l'étape à faire ; une étape terminée fait rouler le train
jusqu'à la suivante ; une ville franchie pose son tampon ; le contrôle final d'un niveau mène au
terminus puis à la nouvelle route.

---

## Risques & points de vigilance
- **Lectures/furigana** : kuromoji fiable mais non infaillible → override + dico noms propres.
- **Quotas gratuits** : Gemini ~1 500 req/jour, Cloud TTS quota mensuel, Workers 100k req/jour →
  privilégier **pré-génération en lot** et **cache**, éviter les appels à la volée.
- **Vie privée** : repo public → **aucune donnée perso dans git** (SRS en IndexedDB + export privé).
- **iOS** : background audio / PWA plus limités que sur Android → tester tôt le mode voiture sur iOS.
