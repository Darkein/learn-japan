# Spécification fonctionnelle — Application d'apprentissage du japonais (révisée)

> Document de référence. Décrit le **quoi** et le **pourquoi** (métier et pédagogie). Les choix
> techniques structurants déjà tranchés sont notés explicitement ; le reste du **comment** est
> laissé à l'implémentation. Cette version remplace la spec initiale et y intègre : catalogue
> navigable, génération ciblée, tags/thèmes, mode voiture promu, traduction littérale, et une
> architecture d'hébergement gratuite avec clés protégées (vérifiée techniquement).

## 1. Vision

Un **lecteur de japonais extensif et adaptatif**, à usage personnel, **mobile d'abord**, centré sur
des sessions de lecture plaisante d'environ 30 minutes. La lecture est l'activité centrale ; la
révision espacée travaille en arrière-plan plutôt que de dicter chaque écran.

Premier et seul utilisateur visé : le concepteur lui-même. Conséquence : pas de multi-utilisateurs,
pas de comptes applicatifs, pas de synchro cloud au départ. **Les données d'apprentissage sont
locales** (sur l'appareil).

Principe directeur en cas de conflit : **la qualité narrative prime, le SRS s'adapte autour.**

Deux usages se nourrissent l'un l'autre : **lire une histoire le soir**, la **réécouter en
conduisant le lendemain**.

## 2. Modèle d'apprentissage

### 2.1 Trois pistes SRS distinctes
Suivies séparément, chacune avec sa propre logique de répétition espacée :
- **Vocabulaire** (le mot dans son usage — unité principale de mémorisation)
- **Kanji** (lecture + sens, indépendamment des mots qui les contiennent)
- **Grammaire** (règles et conjugaisons)

Justification : un même kanji a plusieurs lectures selon le mot (生 → *sei*, *nama*, *i*, *u*…). Ce
qu'on mémorise vraiment, c'est le mot en contexte. Mais on veut aussi savoir si un kanji isolé est
reconnu, et la grammaire suit une logique différente. Un mot connu peut « débloquer » partiellement
ses kanji.

### 2.2 Trois compétences par élément (vocabulaire)
S'activent **progressivement**, dans cet ordre :
1. **Reconnaissance écrite** (voir 猫 → comprendre « chat »)
2. **Reconnaissance orale** (entendre *neko* → comprendre)
3. **Production active** (dire « chat » → produire *neko*) — activée en dernier.

L'état SRS est suivi **par compétence**.

### 2.3 Algorithme SRS
**FSRS** (lib `ts-fsrs`), pas SM-2 : meilleure rétention pour moins de révisions. Chaque élément a
une date de prochaine révision qui s'éloigne après une bonne réponse, se rapproche après une erreur.
Les résultats des quiz alimentent directement le SRS.

### 2.4 Progression et calibrage
- Progression **partant de zéro**.
- Marquage manuel d'un élément comme **« connu »** (ne plus le réviser).
- **Test de calibrage initial** : mini-quiz survolant quelques kanji/règles par niveau JLPT.
- **Calibrage par import** (plus rapide que le quiz) : listes JLPT, export **Anki**, **WaniKani**
  (API avec ton propre token). Pré-remplit l'acquis.

## 3. Leçons (juste-à-temps)

Avant qu'un **nouvel élément** (kanji ou point de grammaire) n'apparaisse pour la première fois dans
une histoire, une **mini-leçon** le présente :
- Kanji : sens, lecture(s), **composition** (§6), mnémonique (§7).
- Grammaire : règle + exemples.

L'apprentissage se fait **juste avant l'exposition en contexte**. Pas de cours formel séparé ; léger,
au service de la lecture.

## 4. Génération des histoires

- Histoires au **niveau adapté**, dans un **genre choisi** (policier, tranche de vie, fantastique…)
  ou via **consigne libre** (« une histoire dans un izakaya »).
- Mode aléatoire : introduisent **2–3 mots cibles** ; le reste de la révision vient du vocabulaire
  qui **réapparaît naturellement**.
- Le LLM (Gemini) génère librement le **texte japonais**, la **traduction**, les **explications
  grammaticales**, les **mnémoniques**. Éléments jugés par l'utilisateur (risque acceptable).

### 4.1 Génération ciblée (sélection)
L'utilisateur peut demander une histoire qui **met l'accent sur des éléments choisis** : kanji,
points de grammaire, ou **tags/thèmes** (« une histoire avec les animaux que je révise »). La
sélection est passée comme **contraintes au prompt LLM**. Affichage **« pourquoi cette histoire »**
(items ciblés) pour fermer la boucle de confiance. Boutons **re-roll** (regénérer) et réglages
**longueur / difficulté**.
- Génération **adaptative** (pilotée par tout l'état SRS) : se fait de préférence côté CLI/Actions
  (accès direct à l'état).
- Génération **ciblée** (thème/kanji/règles) : marche partout, n'a pas besoin de tout l'état SRS.

### 4.2 Traduction : littérale d'abord, fluide ensuite

Deux couches de traduction, et **la couche littérale est prioritaire** (demande explicite) :

1. **Gloss interlinéaire littéral (déterministe, PAS LLM)** — morpheme par morpheme, pour *voir la
   mécanique* de la phrase. Exemple :

   ```
   暑い      です        ね
   être-chaud  c'est(poli)  [accord/n'est-ce-pas]
   ```
   Source : kuromoji segmente en morphèmes (base + nature grammaticale) ; les **mots de contenu**
   sont glosés via **JMdict**, les **particules / auxiliaires / copules** (は, が, を, です, た, ね,
   て, から…) via une **table de gloss fixe** maintenue à la main. C'est de la grammaire → réponse
   déterministe, cohérent avec la philosophie « pas de LLM quand il y a une bonne réponse ».
2. **Traduction française fluide (LLM, secondaire)** — pour vérifier le sens global, affichée en
   complément. Tolère l'erreur (jugée par l'utilisateur).

L'utilisateur choisit la couche affichée (littérale par défaut, fluide au tap).

### ⚠️ 4.3 Exception critique — furigana et lectures
Les **furigana et lectures NE doivent PAS être générés par le LLM.** Sur les lectures ambiguës
(生, 人, 日 en composé, noms propres…), le LLM enseigne une lecture fausse indétectable — le pire bug
pédagogique.
→ Furigana via **analyse morphologique déterministe (kuromoji / Kuroshiro, JS pur, tourne dans le
navigateur)**. Dictionnaire **épinglé (UniDic)** pour la reproductibilité.
→ **Nuance honnête** : kuromoji est *bien* plus fiable qu'un LLM mais **pas infaillible** (compteurs,
nombres, 行った, noms propres). Prévoir une **correction manuelle** (override mémorisé) et un **dico
de noms propres** (JMnedict + entrées manuelles).

## 5. Structure d'une session (~30 min)
1. **Échauffement de révision** (~5 min) — éléments SRS les plus urgents, quiz rapides.
2. **Lecture d'une nouvelle histoire** (~15 min) — audio, furigana au tap, gloss littéral.
3. **Quiz de compréhension / lecture** (~10 min) — nourrit le SRS.

**Relecture** proposée **en option** (jamais forcée) si score faible ou histoire dense. L'audio d'une
histoire déjà lue sert d'exercice d'écoute.

### Types de quiz
- Compréhension (QCM ou réponse libre)
- Lecture de kanji (« comment se lit 食べる ? »)
- Grammaire (« pourquoi が et pas は ? », compléter la particule)
- Reconstruction (remettre une phrase mélangée dans l'ordre)
- Écoute (audio joué, comprendre sans le texte)

## 6. Composition des kanji
Dans le panneau d'un kanji : **décomposition en composants/radicaux** avec leur sens, et **ordre des
traits**. Exemple : 明 = 日 (soleil) + 月 (lune) → « lumineux ».
Données issues de **bases libres** (pas du LLM) : **KanjiVG** (tracés/ordre des traits), **KRADFILE**
(radicaux), **KanjiDic** (lectures + sens).

## 7. Mnémotechniques
Générées par le **LLM** (créatif, subjectif, pas de « bonne réponse » → pas de risque d'erreur),
**regénérables** et **éditables**.
- **Mnémonique de sens** (à partir des composants) : 休 = 人 + 木 → « une personne adossée à un arbre
  se repose ».
- **Mnémonique de lecture** (association sonore FR) : 山 (*yama*) → « au sommet, j'ai crié *Yamaha !* ».
Le mnémonique retenu est **réaffiché à chaque révision**. Un mnémonique forgé soi-même se retient mieux.

## 8. Catalogue / révision à la demande *(nouveau)*
Un écran **bibliothèque** parcourable de tout ce que l'utilisateur connaît ou apprend :
- **Listes** vocab / kanji / grammaire, avec leur **statut** (inconnu / à réviser / connu) et leur
  prochaine échéance SRS.
- **Filtres** : statut, niveau JLPT, **tag/thème**, piste, « marqués à revoir ».
- **Recherche**.
- **Action** : lancer une **session de révision ciblée** depuis une sélection, ou **alimenter une
  génération d'histoire** ciblée (§4.1).
C'est le complément de la carte de progression (qui, elle, reste un indicateur de motivation chiffré).

## 9. Tags / thèmes *(nouveau)*
Système de **tags sémantiques** (espace/position, animaux, nourriture, météo, temps…) attachés aux
kanji / vocab / grammaire.
- Sources : **niveau JLPT** (gratuit) ; **tagging assisté LLM** (subjectif → sans risque) ; **édition
  manuelle** (ajout/retrait/création de tags).
- Usages : **révision thématique** (§8) et **génération thématique** (§4.1).

## 10. Interface (mobile d'abord)
- **Furigana au tap** : pas affichés en permanence ; l'utilisateur essaie de lire, puis tape pour
  vérifier.
- **Tap sur un mot** → panneau : lecture, sens, **gloss grammatical**, bouton audio, composition (si
  kanji), mnémonique.
- **Gloss littéral** affichable sous la phrase (toggle) ; traduction fluide au tap.
- **Mots à réviser signalés discrètement** : trois états visuels (inconnu / à réviser / connu-neutre),
  soulignement léger ou teinte douce — jamais du fluo. Geste pour tout neutraliser le temps d'une
  lecture immersive.
- **Carte de progression** vocab/kanji/grammaire — indicateur de motivation principal.

## 11. Mode voiture — *première classe* (audio seul)
**Mode mains-libres / yeux-libres** pour les trajets (~30 min). Promu d'« extra » à **mode central
de consolidation passive**.
- **100 % audio**, lecture continue type podcast, **hors-ligne**, **reprise où on s'est arrêté**.
- **Pas de scoring au volant** (la reco vocale en conduisant est peu fiable et dangereuse). **Seule
  interaction** : un **bouton du volant mappé sur « à revoir »** → marque l'item pour le quiz du soir.
- Trois formats audio :
  - **Écoute bilingue** d'histoires déjà lues (japonais → traduction → suite) — consolidation.
  - **Rappel actif type Pimsleur** : français → silence → japonais — **format central** (travaille la
    production orale en sécurité).
  - **Révision SRS audio** des mots du jour : sens français → silence → mot japonais + exemple.
- Pilotage par **contrôles média standard via MediaSession** (play/pause/suivant, Bluetooth/volant).
- **Pistes pré-générées à la maison** avant le trajet (file de contenu).
- Réalité actée : **CarPlay/Android Auto natifs hors de portée** d'un projet perso → on passe par
  **Bluetooth + boutons média**, ce qui suffit.

## 12. Audio & TTS
- **Google Cloud TTS** (voix japonaises Neural2/WaveNet ; compte GCP déjà actif → pas de friction ;
  quota mensuel gratuit ; export de fichiers pour les packs voiture).
- Granularité : audio **par phrase** (histoires) et **par segment** (voiture : phrase JP / FR /
  prompt Pimsleur).
- **Écouter juste un mot** :
  1. mot présent dans une phrase déjà générée → **timepointing SSML `<mark>`** : on connaît
     l'horodatage de chaque mot, on **seek dans l'audio de la phrase** (même voix, offline, 0 appel) ;
  2. mot arbitraire en ligne → petit appel Cloud TTS **mis en cache** ;
  3. repli hors-ligne / zéro quota → **Web Speech API** du navigateur.

## 13. Architecture (hébergement gratuit, clés protégées, génération automatisée)

> Verdict de faisabilité : un site **100 % statique ne peut pas** faire d'appel LLM paramétré avec
> une clé protégée. Il faut un détenteur de clés hors-client. La solution retenue reste **gratuite et
> sans serveur à maintenir** : un **Cloudflare Worker** serverless.

```
PWA statique (GitHub Pages)          Cloudflare Worker (gratuit)        GitHub Actions (gratuit)
- lecteur / catalogue / quiz / voiture  - auth (Cloudflare Access)        - génération EN LOT (nuit/cron)
- furigana kuromoji EN LOCAL (browser)  - détient clés Gemini + GCP TTS   - prépare session + packs voiture
- gloss littéral (déterministe)         - /generate : Gemini + Cloud TTS  - publie packs (Releases / R2)
- SRS dans IndexedDB                     - audio -> R2 ; statut -> KV       - build + deploy Pages
- compose des requêtes ; poll /status    - peut déclencher Actions
```

- **Frontend** : **PWA** installable (service worker + IndexedDB offline), hébergée sur **GitHub
  Pages**, **déployée automatiquement** par GitHub Actions à chaque push. **Repo public** → Pages +
  Actions gratuits/illimités.
- **Protection des clés** : **aucun secret dans le client public**. Le Worker détient les clés Google
  (et un éventuel token GitHub) côté serveur ; il est protégé par **Cloudflare Access** (login email,
  gratuit ≤ 50 users → toi seul l'appelles) ou, à défaut, passphrase + **rate-limit**. Le **quota
  gratuit Gemini** (~1 500 req/jour) est le filet ultime (le free tier s'arrête, ne facture pas).
- **Génération interactive ciblée** : PWA → Worker (Gemini + Cloud TTS) → audio sur **R2**, statut
  dans **KV**. La PWA **poll `GET /status/:id`** → `en_file` / `génération` / `prêt` / `erreur`.
  **Entièrement automatisé** : l'utilisateur compose la requête, rien d'autre.
- **Génération en lot** (session du lendemain, longs packs voiture) : **GitHub Actions planifié**
  la nuit (Node, pas de limite CPU). Publie en **Release assets / R2**, **jamais dans git** (l'audio
  gonflerait l'historique ; Git LFS gratuit ~1 Go est trop petit).
- **Furigana & gloss littéral** : **déterministes, dans le navigateur** (kuromoji + JMdict + table de
  particules) → aucune clé, fonctionnent offline.
- **CLI locale** (`npm run generate -- --theme … --kanji …`) conservée pour le dev et la prépa en lot
  (clé dans un `.env` local).
- **Boucle fermée** : état SRS (IndexedDB) → génération → texte annoté (furigana + gloss + trad +
  grammaire) → quiz + audio → résultats → MAJ SRS.

### Pré-génération hors-ligne
File de contenu pré-généré (histoires + pistes audio voiture) préparée **en WiFi**, stockée
localement (Cache API / IndexedDB), **lue hors-ligne** ensuite — essentiel pour métro/voiture.

## 14. Vie privée & sauvegarde
- **Repo public** → **aucune donnée perso dans git** (ni SRS, ni historique de lecture).
- État SRS dans **IndexedDB** ; **export/backup** (fichier, chiffrable) — indispensable : sans
  sauvegarde, un appareil perdu = repartir de zéro.
- Acter le **caveat Gemini free tier** : les prompts peuvent servir à l'entraînement Google
  (acceptable pour du contenu d'apprentissage non sensible ; choix conscient).

## 15. Sources de données libres (récapitulatif)

| Donnée | Source | Pourquoi pas le LLM |
|---|---|---|
| Furigana / lectures en contexte | kuromoji / Kuroshiro (UniDic) | Erreurs sur lectures ambiguës |
| Gloss littéral (morphèmes) | kuromoji + JMdict + table particules | Grammaire = réponse déterministe |
| Composition / radicaux | KRADFILE | Composants exacts |
| Tracés / ordre des traits | KanjiVG | Précision graphique |
| Lectures + sens des kanji | KanjiDic | Référence fiable |
| Noms propres | JMnedict + dico manuel | Lectures hautement ambiguës |
| Histoires, trad fluide, explications | LLM (Gemini) | Jugées par l'utilisateur |
| Mnémotechniques, tags | LLM (Gemini) | Subjectif, sans « bonne réponse » |

## 16. Risque principal
La **justesse des lectures/furigana** — traitée par l'outil déterministe + correction manuelle +
dico de noms propres. Seul point où une erreur silencieuse pourrait enseigner du faux.
