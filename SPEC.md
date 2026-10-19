# Spécification fonctionnelle — Application d'apprentissage du japonais (révisée)

> Document de référence. Décrit le **quoi** et le **pourquoi** (métier et pédagogie). Les choix
> techniques structurants déjà tranchés sont notés explicitement ; le reste du **comment** est
> laissé à l'implémentation. Cette version remplace la spec initiale et y intègre : catalogue
> navigable, génération ciblée, tags/thèmes, mode voiture promu, traduction littérale, et une
> architecture d'hébergement gratuite avec clés protégées (vérifiée techniquement).

## 1. Vision

Un **lecteur de japonais extensif et adaptatif**, à usage personnel, **mobile d'abord**, organisé
en un **parcours** de leçons aux étapes prévisibles (§5) : cours, vocabulaire, grammaire, révision,
histoire, production, contrôle — puis la leçon suivante. La séance n'a pas de fin imposée : on
travaille quand on veut, aussi longtemps qu'on veut. La lecture reste une étape de chaque leçon et
une activité libre à tout moment ; la révision espacée travaille **dans** le parcours, sans jamais
le bloquer.

Premier et seul utilisateur visé : le concepteur lui-même. Conséquence : pas de multi-utilisateurs,
pas de comptes applicatifs, pas de synchro cloud au départ. **Les données d'apprentissage sont
locales** (sur l'appareil).

Principes directeurs :
- **On avance en faisant.** Ce qui fait passer à l'étape suivante, c'est le travail fait, jamais
  l'écoulement du temps ni la charge de révision. Une leçon prend un nombre d'étapes connu
  d'avance.
- **La mémoire se consolide dans le parcours.** Les révisions sont des étapes du parcours, visibles
  et prévues ; elles peuvent ralentir l'arrivée du neuf, jamais la geler.
- **Pour le contenu généré, la qualité narrative prime** : les histoires s'écrivent pour être lues,
  pas pour cocher des mots.

Deux usages se nourrissent l'un l'autre : **lire une histoire le soir**, la **réécouter en
conduisant le lendemain**.

## 2. Modèle d'apprentissage

### 2.1 Deux pistes SRS distinctes
Suivies séparément, chacune avec sa propre logique de répétition espacée :
- **Vocabulaire** (le mot dans son usage — unité principale de mémorisation)
- **Grammaire** (règles et conjugaisons)

Justification : apprendre les mots expose naturellement leurs kanji en contexte. La grammaire suit
une logique différente. Les kanji restent visibles dans le **Catalogue** en référence (sens, lectures,
niveau JLPT) mais ne sont pas une cible SRS à part entière.

**Noms exclus du vocabulaire** : un nom de personne, de lieu ou d'organisation n'est pas une cible
d'apprentissage — le JMdict ne les indexe pas, une carte « 田中 → ? » est donc une question sans
réponse. Ils restent lus, prononcés et découpés en kanji dans le lecteur, simplement jamais suivis.
Deux filtres, parce qu'un nom se présente de deux façons :

1. **Étiqueté** `固有名詞` par le tokenizer (田中, 日本橋, 朝日新聞) → écarté d'office.
   **Exception** : les entrées du référentiel JLPT (日本, アメリカ, ヨーロッパ…), que le tokenizer
   étiquette pareil mais qui sont du vocabulaire à part entière ; hors contexte il étiquette
   d'ailleurs ainsi quantité de mots courants (池, 森, 毎日…), et l'inventaire curé tranche toujours.
2. **Rien à réviser** — le cas des noms que le LLM invente pour ses personnages (クロ le chat, タロウ
   le voisin) : IPADIC les classe en `名詞/一般`, l'étiquette ne les trahit pas. Ce qui les trahit,
   c'est qu'ils n'ont ni sens (JMdict et référentiel muets) ni graphie distincte de leur lecture :
   une carte n'aurait ni question ni réponse. Même critère que la testabilité d'un item, appliqué
   **avant** création plutôt qu'avant révision — sinon ces mots fantômes s'invitent dans les
   distracteurs de QCM, le rappel du soir et les compteurs.

Un mot peut donc être **lisible et glosé sans être suivi** : le lecteur et le SRS ne cherchent pas
la même chose.

**Ce qui entre en rotation — les objectifs de leçon, et rien d'autre.** Lire une histoire
matérialise en base tous ses mots de contenu (lecteur, gloss, distracteurs de QCM, exercices du
texte), mais **sans carte SRS**. Seuls les **objectifs des leçons commencées** sont promus
automatiquement en révision, dans l'ordre curé du curriculum : une histoire de leçon charrie des
dizaines de mots hors objectifs, et les promouvoir noyait les mots-cibles sous du vocabulaire jamais
choisi. Un mot **incident** entre en planification quand l'utilisateur le décide **depuis le
texte** — tap sur le mot dans le Lecteur (connu / à revoir / oublié), bouton de suggestion de la
fiche kanji — et ces gestes créent la carte eux-mêmes.

**Les exercices d'une histoire ne créent plus de carte pour un mot incident.** Ils notent les
objectifs de leçon qui ont déjà une carte ; un mot incident y est travaillé **sans écriture SRS**.
Constat qui a motivé la règle : 89 histoires lues avaient mis en rotation des mots jamais choisis
(宝物, « objet précieux », 20 révisions à 40 % de réussite) qui encombraient les révisions et
tiraient la rétention mesurée vers le bas. Une passe unique sort de la rotation le vocabulaire
incident déjà promu (même règle que `purgeIncidentalCards`) ; les rares ajouts manuels se
réajoutent d'un tap.

### 2.2 Un mot, une carte — cinq formes d'exercice

**Un mot de vocabulaire porte UNE carte FSRS** (`VocabItem.card`), donc **une échéance** et
**un passage** par cycle. Ce qui varie, c'est la **forme** de l'exercice, **tirée à chaque
passage** parmi cinq (`lib/vocabDrills.ts`) :

| Forme | Ce qu'elle travaille |
|---|---|
| `written` | le **triangle** kanji ↔ furigana ↔ traduction (§2.2b) |
| `listen-word` | on entend, on écrit le mot (dans sa phrase quand elle le dit) |
| `listen-meaning` | on entend la phrase, on choisit le sens du mot |
| `dictation` | on entend la phrase, on la reconstruit par tuiles |
| `production` | on complète la phrase en japonais à partir du français |

Le mot portait auparavant **trois cartes** planifiées séparément (écrit / écoute /
production) : le même mot revenait jusqu'à trois fois par cycle, occupant trois places de
session pendant que d'autres attendaient leur tour — d'où l'impression de « toujours revoir
les mêmes mots ». Il fallait en plus tout un appareillage pour contenir les dégâts (amorces
plafonnées, espacement forcé des cartes sœurs, compétence écartée quand son mot passait
déjà) ; une seule carte le rend inutile. Une base ancienne est **fusionnée en une passe**
(`mergeSkillCards`) : la carte de l'écrit survit — la seule que tout mot porte, la plus
fournie en historique.

**Les compétences restent une progression**, mais comme **conditions de tirage** et non plus
comme planifications : une forme n'est tirée que si le mot a atteint son **niveau** dans le
parcours (ci-dessous) — ce critère remplace l'ancien, qui ouvrait l'écoute à l'état `Review` et
la production à l'intervalle de déblocage de 4 jours —, et les formes qui exigent une phrase
d'exemple ou du son s'effacent quand la matière ou le son manquent. L'**écrit** est toujours
recevable — c'est le filet du tirage — et **pondéré** (`WRITTEN_WEIGHT`) : seule forme
constructible pour n'importe quel mot, et seule à faire avancer la série qui ouvre la saisie.
Enfin, la forme du passage précédent (`lastDrill`) est **reléguée en dernier**, sans jamais
disparaître : une forme n'est pas toujours constructible, il faut un repli.

**Les formes suivent le parcours.** Le parcours range ces formes en trois **niveaux** de
difficulté (§5.3) — reconnaître (`written` en QCM), rappeler (`written` en saisie,
`listen-meaning`, `listen-word`), produire (`dictation`, `production`) — et chaque élément
mémorise le **plus haut niveau atteint** dans sa leçon. En révision, la forme tirée ne dépasse
jamais ce niveau : un mot vu seulement en reconnaissance n'est pas servi en production. Un échec
sur une forme qu'on n'a jamais travaillée comptait comme un oubli — FSRS suppose pourtant un
test de difficulté constante, et la rétention mesurée en était faussée. Une fois la leçon
terminée, tous les niveaux sont ouverts.

La note replanifie **la carte du mot**, quelle que soit la forme servie : une réussite à
l'oreille éloigne le mot, un échec en production le ramène. `ReviewLog.skill` garde trace de
la compétence travaillée — c'est de là que viennent les statistiques et les défis omikuji,
plus d'aucune planification.

### 2.2b Le triangle de révision (reconnaissance écrite)
Un mot porte trois **faces** : **kanji** (sa graphie), **furigana** (sa lecture en kana) et
**traduction** (son sens FR). La révision écrite part de l'une et en demande une autre — **six
directions**, tirées au hasard, celle du passage précédent exclue (`lib/vocabFaces.ts`).
C'est la forme `written` du tirage ci-dessus : une fois l'écrit tiré, la direction se tire à
son tour.

Une face n'existe que si elle apporte quelque chose : pas de face kanji pour un mot en kana (elle
ferait doublon avec la lecture), pas de face française pour un mot sans sens connu. Un mot à deux
faces se révise donc dans deux directions.

Le tirage **privilégie la face kanji** (`KANJI_WEIGHT`) : une direction qui montre ou demande la
graphie passe devant une direction purement kana (lecture ↔ traduction) — c'est la graphie qui
coûte à apprendre, la transcription en kana d'un mot qu'on sait lire n'apprend plus rien. C'est une
pondération, pas une exclusion : les directions kana restent tirables, et sont les seules d'un mot
sans face kanji.

Le **mode d'entrée** suit la face demandée et la maîtrise :

| Face demandée | Mode |
|---|---|
| furigana | **QCM** tant que le mot n'est pas su, **saisie** ensuite |
| kanji | **QCM** toujours — le champ convertit romaji → kana, on ne peut pas y taper de kanji |
| traduction | **QCM** toujours — les synonymes rendraient la saisie injuste |

Le seuil est un **compteur de réussites consécutives** (`VocabItem.streak`, seuil `TYPE_STREAK = 2`),
pas un intervalle : lisible et affichable. Un échec ou un « Difficile » le remet à zéro, et un
**élément difficile** (leech) repasse au QCM même au-dessus du seuil.

Un élément est **difficile** à partir de `leechLapses` échecs **courants** — un compteur qui
**repart à zéro** dès `leechRecoveryStreak` réussites d'affilée, et non un total de vie. Le statut
se gagne et se perd : un mot su par cœur ne reste pas marqué difficile pour trois coquilles
d'il y a six mois, et un mot réellement instable rechute avant d'avoir bouclé sa série.

Les distracteurs d'un QCM sont tirés sur **la même face que la réponse** (des graphies contre une
graphie, des sens contre un sens), puis rangés du plus au moins **confondable** — car une option
qu'on élimine sans lire n'est pas une option :

1. **même okurigana** — le critère qui décide. « ふる → 降る / 夏休み / 少し / 対策 » se cochait sans
   lire un seul kanji, puisque seule la bonne réponse finit par る. L'okurigana est écrit des deux
   côtés de la carte, on l'aligne donc dans les deux sens : demander la **graphie**, c'est exiger
   des options finissant par le même kana ; demander la **lecture**, c'est exiger des lectures
   finissant par l'okurigana affiché. Sur une graphie sans okurigana (対策), la contrainte s'inverse ;
2. **même niveau JLPT** — un mot trop éloigné du niveau s'élimine tout seul ;
3. **longueur comparable** — une option deux fois plus longue que les autres se repère de loin.

C'est un **rangement, pas un filtre** : quand le vivier est pauvre, les rangs du bas complètent.
Sans trois distracteurs plausibles, une cible « furigana » bascule en saisie plutôt que de servir
un QCM devinable.

Un QCM de grammaire montre la **forme seule** du point interrogé (`grammarForm`) : le référentiel
nomme ses entrées avec leur traduction (« ある (exister, inanimé) »), et cette glose EST la réponse
quand on demande le rôle du point. Les **homonymes** sont alors exclus des leurres — le référentiel
porte trois に, deux で, deux と : servir la règle d'un homonyme donnerait un QCM à deux réponses
vraies dont une seule compte.

### 2.3 Algorithme SRS
**FSRS** (lib `ts-fsrs`), pas SM-2 : meilleure rétention pour moins de révisions. Chaque élément a
une date de prochaine révision qui s'éloigne après une bonne réponse, se rapproche après une erreur.
Les résultats des quiz alimentent directement le SRS.

**Cible de rétention fixe : 90 %** (défaut FSRS). L'auto-réglage qui relevait la cible quand on se
trompait est **supprimé** : il aggravait ce qu'il devait corriger. Cas réel : rétention mesurée
76 %, cible montée au plafond de 97 % — des intervalles environ quatre fois plus courts, donc plus
de cartes dues, donc plus de retard, sans que la rétention remonte. Les erreurs venaient en partie
des formes d'exercice (§2.2), pas de l'espacement. La rétention mesurée reste affichée dans les
Statistiques, à titre d'information.

### 2.4 Progression et calibrage
- Progression **partant de zéro**.
- Marquage manuel d'un élément comme **« connu »** (ne plus le réviser).
  Dans le parcours, un élément de leçon déclaré connu passe directement au niveau 3 (§5.8).
- **Test de calibrage initial** : mini-quiz survolant quelques règles de grammaire par niveau JLPT.
- **Calibrage par import** (plus rapide que le quiz) : listes JLPT, export **Anki**, **WaniKani**
  (API avec ton propre token). Pré-remplit l'acquis.

## 3. Leçons (juste-à-temps)

Avant qu'un **nouveau point de grammaire** n'apparaisse pour la première fois dans une histoire, une
**mini-leçon** le présente : règle + exemples.

L'apprentissage se fait **juste avant l'exposition en contexte**. Pas de cours formel séparé ; léger,
au service de la lecture.

**Commencer une leçon est un geste d'ÉTUDE**, jamais un effet de bord : ouvrir son cours, lire
une de ses histoires, l'écouter en podcast, « commencer quand même ». **Préparer la matière
n'est pas l'étudier** — générer ou télécharger le contenu d'une leçon ne la commence pas, ne
met pas ses éléments en rotation SRS et n'en fait pas la leçon courante du flux. Dans le parcours
(§5), commencer une leçon, c'est ouvrir sa première étape ; ses éléments reçoivent leur carte à
leur première rencontre en exercice (étapes Vocabulaire et Grammaire), tous en même temps.

### 3.1 Curriculum — porte d'entrée du débutant

Pour un utilisateur qui démarre de zéro, le « juste-à-temps » seul ne suffit pas : il faut un fil
conducteur. Un **curriculum** (liste ordonnée de leçons N5 → N1, statique dans le repo) sert de page
d'accueil par défaut (onglet **Apprendre**). Chaque entrée du curriculum décrit ses **objectifs**
(vocab / kanji / grammaire, par référence à l'inventaire).

**Le cours et l'histoire sont deux choses distinctes** (ne pas les fusionner) :

- **Le cours** (pédagogie, propre à la leçon) combine deux couches : une **leçon FR rédigée**
  **générée à la demande** (mise en cache local) qui constitue le corps pédagogique — une vraie
  leçon développée (intuition, exemples travaillés JP / lecture / traduction, nuances de registre,
  pièges fréquents) ; et, en dessous, le **détail structuré assemblé depuis l'inventaire** — pour
  chaque point de grammaire : règle + exemple ; pour chaque kanji : sens + lectures ; liste de
  vocab. La structure vient toujours de l'inventaire : une leçon non générée n'est donc jamais
  vide, seule la leçon rédigée manque. Celle-ci enseigne et démontre — elle ne redresse pas la
  liste brute du vocabulaire (déjà affichée à côté).
  Ce **détail structuré est servi partout où la leçon se lit** : sa page ET le bloc « Leçon » du
  flux d'étude. Le flux n'affichait que la leçon rédigée — on y découvrait les mots dans les
  exercices sans les avoir jamais vus posés.
  **Longueur adaptative** : la consigne de génération borne la longueur selon la position dans le
  parcours (les leçons 1–5 restent volontairement courtes et rassurantes pour un débutant absolu)
  et selon le nombre de points de grammaire enseignés — jamais de « mur de texte » en ouverture.
  Chaque leçon porte un **`rev`** (révision de contenu) : quand ses objectifs changent, le rev
  est incrémenté et les cadrages générés pour l'ancienne version (cache local + R2) sont ignorés
  et régénérés.
- **Les histoires** (matière à lire) sont des **`StoryRecord` rattachés par `lessonId`** : une leçon
  en a **0..N**, **générées depuis l'app** (à la demande / re-roll). Elles passent par le **même
  pipeline que toute histoire** (lecteur, furigana, SRS) et sont visibles dans l'onglet
  **Histoires**. Ce sont aussi le **porteur naturel de l'audio** (mode voiture / podcast, §11–12 :
  TTS par phrase, format Pimsleur).

États d'une leçon : **prête** (leçon généré), **à générer** (objectifs seuls), **terminée** (**contrôle réussi**, §5b — c'est l'admission qui déverrouille la leçon suivante).

Une histoire générée depuis une leçon **conserve son `lessonId`** (rattachement bidirectionnel
catalogue ↔ histoire). Le mode « génération libre / texte collé » reste accessible mais relégué en
**mode avancé** dans le Lecteur, hors du chemin du débutant.

#### Modèle à deux couches (référentiel + curriculum)

Pour garantir **complétude** et **montée en difficulté cohérente** sans que l'utilisateur (qui
apprend le japonais) ait à valider quoi que ce soit, le curriculum repose sur deux couches :

1. **Référentiel / inventaire** (`app/src/data/inventory/`) — le « quoi », complet et sourcé :
   `kanji.json`, `vocab.json` (datasets ouverts, cf. README) et `grammar.json` (curé). Chaque item
   a un **id stable** et un **niveau JLPT**. Les sens **français** sont curés dans des overlays
   (`kanji-fr.json`, `vocab-fr.json`), avec repli sur l'anglais. **Un gloss FR ne désigne qu'un
   seul mot** : un exercice peut partir du sens et demander le mot, sans phrase pour trancher —
   « oui » qui vaudrait はい *et* ええ serait une question sans réponse. Les glosses portent donc
   leur propre désambiguïsation (registre, nature, graphie, domaine : « oui (poli) » / « oui
   (familier) ») ; l'unicité est vérifiée par les tests (`lib/inventory.test.ts`).
2. **Curriculum** (`curriculum.json`, v3) — le « dans quel ordre » : **niveau → unité → leçon**.
   Chaque leçon **référence** l'inventaire via `introduces: { vocab, grammar }` (listes
   d'ids) au lieu de redéclarer le contenu → source unique de vérité, zéro doublon.

**Cohérence vérifiée mécaniquement** par `npm run curriculum:check` (et en CI) : couverture
(chaque point de grammaire N5 introduit par exactement une leçon, **chaque mot de `vocab.json`
introduit par au moins une leçon** — les réapparitions suivantes sont des rappels volontaires),
intégrité des références, respect des **prérequis** de grammaire (un prérequis précède ce qui en
dépend), et garde-fou de **densité** (nombre de mots nouveaux par leçon plafonné).

**Progression N5** : les **titres des leçons annoncent ce qu'elles enseignent** (grammaire ou thème
de vocabulaire), la charge grammaticale monte en douceur (≤ 2 points par leçon en début de parcours,
です dès la 5e leçon, la forme て après la famille ます), les verbes de mouvement précèdent les
particules de direction, et des **leçons de vocabulaire thématiques** (transports, maison, corps,
couleurs…) s'intercalent entre les leçons de grammaire pour couvrir tout l'inventaire N5.

**Vocabulaire hors-niveau.** Une histoire peut contenir des mots d'un niveau supérieur : ils
restent **lisibles** (furigana + gloss déterministes) sans être imposés comme cibles SRS.

## 4. Génération des histoires

- Histoires au **niveau adapté**, dans un **genre choisi** (policier, tranche de vie, fantastique…)
  ou via **consigne libre** (« une histoire dans un izakaya »).
- Mode aléatoire : introduisent **2–3 mots cibles** ; le reste de la révision vient du vocabulaire
  qui **réapparaît naturellement**.
- Le LLM (Gemini) génère librement le **texte japonais**, la **traduction**, les **explications
  grammaticales**, les **mnémoniques**. Éléments jugés par l'utilisateur (risque acceptable).

### 4.1 Génération ciblée (sélection)
L'utilisateur peut demander une histoire qui **met l'accent sur des éléments choisis** : points de
grammaire ou **tags/thèmes** (« une histoire avec les animaux que je révise »). La sélection est
passée comme **contraintes au prompt LLM**. Affichage **« pourquoi cette histoire »** (items ciblés)
pour fermer la boucle de confiance. Boutons **re-roll** (regénérer) et réglages **longueur / difficulté**.
- Génération **adaptative** (pilotée par tout l'état SRS) : se fait de préférence côté CLI/Actions
  (accès direct à l'état).
- Génération **ciblée** (thème/règles) : marche partout, n'a pas besoin de tout l'état SRS.

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

## 5. Le parcours — des étapes prévisibles, une séance sans fin

**Constat qui a motivé le parcours.** Le flux précédent choisissait l'activité suivante d'après une
liste de priorités, et la progression d'une leçon à l'autre dépendait de la **stabilité FSRS** de
ses éléments (60 % avec un intervalle ≥ 4 jours pour ouvrir le contrôle). Ces éléments n'entraient
en révision qu'au compte-gouttes, par un débit de nouveautés freiné dès que le retard montait. Cas
réel : objectif de 10 cartes par jour, rétention mesurée de 76 %, cible de rétention montée à
97 % — le frein coupait toute nouveauté, et la leçon 12 est restée **plusieurs jours à 0 %** malgré
un travail quotidien. L'utilisateur ne savait ni ce qui venait ensuite, ni combien il en restait,
ni pourquoi rien n'avançait.

Le parcours remplace ce modèle : **chaque leçon est une suite fixe d'étapes**, toujours la même,
qu'on enchaîne dans l'ordre. On sait à tout moment où on en est (« étape 3 sur 7 ») et ce qui vient
ensuite.

### 5.1 Une séance sans fin

- **Le flux ne se termine pas de lui-même.** Après chaque étape, il y en a toujours une suivante :
  l'étape suivante de la leçon, ou la première de la leçon d'après. Il n'y a plus de « Terminer
  pour aujourd'hui » imposé, ni de plafond de blocs de renforcement.
- **Chaque fin d'étape est un point de sortie** (le checkpoint actuel) : on s'arrête quand on veut,
  et on reprend exactement là où on s'était arrêté, au début de l'étape interrompue.
- **L'objectif du jour devient un repère**, compté en **étapes** (défaut : 3, soit environ
  15 minutes). Il nourrit la série de jours, les rappels et l'omikuji ; une fois atteint, on le
  signale et le parcours continue.
- **Le contenu se prépare à l'avance.** Dès qu'une leçon est commencée, la génération du contenu
  de la suivante (cours, première histoire) part en arrière-plan : enchaîner deux leçons dans la
  soirée ne doit jamais faire attendre.

### 5.2 Les étapes d'une leçon

| # | Étape | Contenu | Exercices | Durée (leçon de 8 mots, 2 points) |
|---|---|---|---|---|
| 1 | **Cours** | le cours de la leçon (§3.1) | — | ~4 min |
| 2 | **Vocabulaire** | niveaux 1 et 2 des mots de la leçon | 2 par mot | ~5 min |
| 3 | **Grammaire** | niveaux 1 et 2 des points de la leçon | 4 par point | ~3 min 30 |
| 4 | **Révision** | cartes dues, rappels des leçons précédentes (§5.4) | 10, fixe | ~3 min |
| 5 | **Histoire** | lecture d'une histoire de la leçon, puis ses exercices | lecture + 6 à 10 | ~7 min |
| 6 | **Produire** | niveau 3 des mots et des points de la leçon | 1 par mot, 2 par point | ~5 min |
| 7 | **Contrôle** (関所) | l'épreuve notée (§5b) | ~15 questions | ~8 min |

- **Durée cible : environ 35 minutes** pour une leçon de 10 éléments, de moins de 30 minutes
  (leçon 1 : 4 mots, 2 points) à près de 40 minutes (leçon 9 : 14 mots). Les durées par
  exercice sont celles observées dans l'app (15 à 20 s en moyenne, lecture comprise) et seront
  recalées par la mesure (§5.7).
- **Les étapes 2, 3 et 6 se dimensionnent d'après la leçon** ; les autres sont fixes. Une leçon
  sans grammaire saute l'étape 3, et l'étape 6 n'y porte que sur les mots.
- **L'ordre est fixe et les étapes ne se sautent pas** : c'est ce qui rend le parcours prévisible.
  Une étape terminée peut toujours être refaite, sans effet sur la répétition espacée (§5.5).
  La page d'une leçon donne en plus un accès libre à son cours, à ses histoires et à
  l'entraînement.
- **Une jauge par étapes.** La carte de leçon affiche les étapes faites (« 3 / 7 ») au lieu de la
  part d'éléments stabilisés. La **maîtrise** (intervalle ≥ 21 jours) reste affichée à part, comme
  objectif à long terme.

### 5.3 Trois réussites par élément

Chaque élément nouveau (mot ou point de grammaire) est **réussi trois fois** pendant sa leçon, à
**trois niveaux de difficulté croissante** : les deux premiers dans l'étape Vocabulaire (ou
Grammaire), séparés par les autres éléments de la leçon, le troisième à l'étape Produire, après la
révision et l'histoire. Environ trois
rappels réussis à la première rencontre suffisent ; au-delà le gain est faible et il vaut mieux
revoir l'élément plus tard, ce qui est le rôle de la révision espacée (§5.4). Les espacer, même de
quelques minutes, retient mieux que trois réussites d'affilée. Le contrôle fait office de
quatrième rappel.

| Niveau | Vocabulaire | Grammaire (2 exercices par niveau) | Étape |
|---|---|---|---|
| 1 · **Reconnaître** | triangle en QCM | règle en QCM, emploi en QCM | 2 et 3 |
| 2 · **Rappeler** | triangle en saisie, sens à l'écoute, mot à l'écoute | construction par tuiles, correction | 2 et 3 |
| 3 · **Produire** | dictée, production en contexte | dictée d'une phrase du point, thème court | 6 |

- Dans une étape, **tous les exercices de niveau 1 passent avant ceux de niveau 2**, dans un ordre
  mélangé : chaque mot est revu après quelques autres, jamais deux fois de suite.
- **La grammaire s'appuie sur les générateurs du contrôle** (`lib/exam.ts` : règle, emploi,
  correction), utilisés ici en mode corrigé au fil de l'eau. Chaque point de grammaire n'a
  aujourd'hui qu'une phrase d'exemple dans l'inventaire : les niveaux 2 et 3 puisent en plus dans
  le corpus d'exemples (`examples.json`), puis dans des phrases générées par le Worker. C'est le
  principal chantier de contenu du parcours.
- Le niveau atteint par chaque élément est **mémorisé** : c'est lui qui borne les formes servies en
  révision (§2.2).

### 5.4 Réviser dans le temps

Deux mécanismes complémentaires. Une séance pouvant durer aussi longtemps qu'on veut, la révision
ne peut pas dépendre de la seule date : si l'on fait trois leçons dans la soirée, un rappel
« à J+1 » n'a pas lieu avant le lendemain.

**1. L'étape Révision, alimentée par FSRS.** La planification FSRS est conservée ; au lieu de
freiner le neuf, elle remplit les étapes Révision.
- Une étape Révision sert **10 cartes**. Les **3 premières places** vont aux rappels portés par
  le parcours (ci-dessous) ; les autres aux cartes dues, toutes leçons confondues, les plus
  urgentes d'abord.
- **S'il n'y a pas assez de cartes dues**, elle complète avec les éléments **les plus fragiles**
  (plus faible récupérabilité FSRS). FSRS traite une révision anticipée : elle est notée
  normalement, et fait moins progresser la stabilité qu'une révision à l'échéance.
- **Révision insérée.** Quand plus de 20 cartes sont dues (plus de deux étapes de retard), le
  parcours insère une étape Révision avant la prochaine étape de contenu nouveau (2, 3, 5 ou 6),
  et l'affiche comme telle (« Révision · 34 cartes en attente »). **Au plus une insertion par étape
  de contenu** : un gros retard ralentit le neuf de moitié au pire, il ne le gèle jamais.

**2. Les rappels portés par les leçons suivantes.** Comme les unités d'un parcours de type
Duolingo font revenir les mots des précédentes, la leçon N rappelle les éléments de la leçon N−1
(au niveau 2) et de la leçon N−3 (au niveau 3) dans les places réservées de son étape Révision.
Les mots reviennent ainsi au rythme où l'on avance, quel que soit le calendrier. Les histoires
continuent de mêler du vocabulaire des leçons précédentes (§4).

**Station de repos, toutes les 5 leçons.** Une étape de révision plus longue (20 exercices, niveaux
2 et 3) porte sur les éléments des cinq dernières leçons, les plus fragiles d'abord. Elle fait
partie du parcours, entre le contrôle d'une leçon et le cours de la suivante, et n'a pas de note.
Le rythme fixe (et non la fin d'unité) vient de l'inégalité des unités : de 2 à 6 leçons, soit
d'environ 1 h 30 à plus de 4 heures de parcours.

### 5.5 Erreurs et validation d'une étape

- **La première réponse compte.** Une erreur est notée « à revoir » en FSRS, comme aujourd'hui :
  le mot repasse en réapprentissage et revient vite en révision. On peut donc **perdre** de la
  maîtrise, pas seulement en gagner. Réussir un mot trente secondes après l'avoir raté relève de
  la mémoire immédiate : ça ne prouve pas qu'on le saura dans une semaine.
- **Pas de pénalité de parcours.** Pas de cœurs, pas d'étape « ratée » : les exercices ratés sont
  **rejoués à la fin de l'étape** jusqu'à être réussis, et l'étape est validée quand tous ses
  exercices l'ont été. Ces relances servent à apprendre et n'écrivent rien dans le SRS.
- **Plus de seconde chance.** La règle qui rendait à un raté réussi en relance l'état de sa carte
  d'avant l'erreur est **supprimée** : appliquée à un parcours qui rejoue tous ses ratés, elle
  aurait fait de la maîtrise une mesure qui ne peut que monter.
- Une étape **refaite** après sa validation est un entraînement : aucune écriture SRS.

### 5.6 Ce que le parcours remplace

- **Le débit de nouveautés et son frein** (`newPerDay`, `sustainableNewPerDay`,
  `effectiveNewPerDay`, le réglage « Nouveaux mots par jour ») : les cartes naissent dans les
  étapes Vocabulaire et Grammaire. La charge que l'ancien plafond protégeait reste du même ordre :
  à 10 minutes par jour, une leçon de 10 éléments tous les 3 à 4 jours, soit environ 3 éléments
  nouveaux par jour ; et la révision insérée (§5.4) ralentit le neuf quand le retard monte.
- **La dose du jour calée sur l'objectif en cartes** (`reviewBlockSize`) et le renforcement
  plafonné (`MAX_REINFORCE_PER_FLOW`) : la révision a ses étapes, de taille fixe.
- **L'ouverture du contrôle à 60 % d'éléments stabilisés** (`SRS.examEligibility`) : le contrôle
  s'ouvre à la fin du parcours de la leçon (§5b).
- **L'auto-réglage de la cible de rétention** (§2.3).

**Reprise d'une base existante.** Les leçons terminées le restent. Pour la leçon en cours,
l'étape 1 est créditée si le cours a été lu (`courseReadAt`), l'étape 5 si une de ses histoires a
été lue, et les étapes 2 et 3 ne servent que les éléments qui n'ont pas encore de carte en état
`Review` (les autres sont crédités des niveaux 1 et 2). L'étape 6 et le contrôle restent à faire.

### 5.7 Mesurer pour calibrer

Le journal de révisions (`ReviewLog`) enregistre l'heure de chaque réponse et la compétence, mais
ni la forme d'exercice ni sa durée. Il enregistre désormais **la forme servie, le niveau et la
durée de réponse** de chaque exercice. Ces mesures recalent les coefficients d'exercices par
élément (§5.2) et la durée annoncée de chaque étape, affichée avant de la commencer
(« Vocabulaire · 16 exercices · ~5 min »).

### 5.8 Ce que le parcours change dans le reste de l'app

Le parcours touche tout ce qui comptait en **cartes par jour** ou reposait sur la stabilité FSRS.
Inventaire complet, pour qu'aucun écran ni réglage ne garde un sens qu'il n'a plus.

**Réglages** (`lib/settings.ts`, `ui/SettingsSections.tsx`)

| Réglage | Devenir |
|---|---|
| Objectif quotidien (cartes) | **Change de sens** : « Objectif quotidien (étapes) », de 1 à 10, défaut 3. L'ancienne valeur en cartes n'a pas d'équivalent : elle est remplacée par le défaut à la migration. |
| Nouveaux mots par jour | **Supprimé**, avec son explication (plafond, `NEW_ITEM_LOAD`). Les mots arrivent par les étapes. |
| Romaji → kana dans les révisions | Conservé, renommé « dans les exercices » : il s'applique à toutes les étapes. |
| Sans le son (et la pause « Je ne peux pas écouter ») | Conservé, étendu au parcours : les formes d'écoute des niveaux 2 et 3 passent à leur équivalent écrit (niveau 3 : production seule, sans dictée). La lecture de l'histoire n'est pas concernée. |
| Furigana, gloss, masquage des mots connus, sons de retour, vitesse audio, taille du texte, thème, stockage | Inchangés. |
| Rappels (activation, heure) | Conservés ; leur contenu change (ci-dessous). |

**Accueil** (`ui/Home.tsx`)
- La carte « Aujourd'hui » compte les **étapes du jour** sur l'objectif (et non plus les révisions),
  et la série de jours.
- La carte du flux devient la carte du **parcours** : leçon en cours, étape suivante, jauge des
  étapes, durée annoncée (« Étape 3 / 7 · Grammaire · ~3 min »). Son libellé « Renforcement »
  disparaît.
- « Nouvelle leçon débloquée », « Relecture-miroir » et « À lire pour toi » restent, comme
  activités hors parcours.
- *Remplacé par §5c* : l'accueil devient la voie du voyage. Les cartes ci-dessus quittent
  l'accueil (§5c.1).

**Flux** (`lib/flow.ts`, `ui/FlowSession.tsx`, `ui/FlowCheckpoint.tsx`)
- Le checkpoint garde « Continuer avec : … » ; « Terminer pour aujourd'hui » devient un simple
  « Arrêter ici » toujours disponible, jamais l'unique bouton.
- L'aperçu (`previewFlow`) annonce les prochaines étapes du parcours au lieu de « 34 révisions,
  puis une lecture ».
- Les activités `review`, `reinforce` et `done` disparaissent ; le cours, l'histoire et le contrôle
  deviennent des étapes ; la relecture-miroir reste proposée entre deux étapes, au plus une fois par
  séance.

**Leçons** (`ui/LessonCard.tsx`, `ui/CourseDetail.tsx`)
- La jauge d'ouverture (part d'éléments stabilisés, repère à 60 %) devient la **jauge des étapes**.
- Le message d'une leçon verrouillée renvoie au **contrôle** de la précédente, plus à un
  pourcentage de stabilité. « Commencer quand même » reste.
- L'entrée du contrôle n'affiche plus « s'ouvre à 60 % d'éléments stabilisés », mais l'avancée
  du parcours (« 4 étapes sur 6 faites »), avec la possibilité de le tenter avant.
- « S'entraîner sur la leçon » reste un entraînement neutre.
- **Commencer une leçon hors du parcours** : lire son cours depuis sa page crédite l'étape 1, lire
  une de ses histoires crédite l'étape 5 (même règle que la reprise des bases, §5.6). Le podcast
  et « Commencer quand même » rendent la leçon courante sans créditer d'étape.

**Fin de séance et ratés** (`ui/SessionSummary.tsx`, `ui/ReviewSession.tsx`)
- Dans une étape, les ratés sont rejoués **automatiquement** à la fin (§5.5) : les boutons
  « Rejouer les ratés » et « Recommencer » ne restent que pour les entraînements et les exercices
  du Lecteur.
- Le bilan d'étape montre les réussites, les ratés rejoués, et ce qui suit dans le parcours.

**Statistiques** (`ui/Stats.tsx`)
- La ligne « Réglage auto — cible de rétention · nouveautés : N/j » est **supprimée** (cible fixe,
  plus de débit). La rétention mesurée reste.
- « Charge des 7 prochains jours » reste : le retard s'y exprime en **étapes Révision** (10 cartes
  chacune) plutôt qu'en jours d'objectif.
- « Activité » ajoute les étapes faites et les leçons terminées ; « par jour actif » donne les
  minutes et les étapes plutôt que les révisions.
- Maturité des cartes, temps d'étude, précision la plus faible et bulletin des contrôles sont
  inchangés.

**Rappels, badge et série** (`lib/reminders.ts`, `lib/reminderText.ts`, `lib/dueCount.ts`,
`sw.ts`, `lib/stats.ts`)
- La journée est faite (`dayIsDone`) quand l'objectif d'**étapes** est atteint, plus quand
  l'objectif de cartes l'est.
- Le texte du rappel annonce l'**étape suivante** (« Étape 4 de « Les gens autour de moi » :
  Révision ») parmi ses accroches. Le nombre de cartes dues n'y sert plus de repli.
- Le **badge d'icône** affiche les étapes qui restent pour l'objectif du jour, plus le nombre de
  cartes dues (rien quand l'objectif est atteint).
- **Série de jours** (`reviewStreak`) : un jour compte si l'objectif d'étapes est atteint. Les
  jours d'avant la migration gardent leur règle d'alors (révisions ≥ objectif en cartes) : la
  série n'est pas remise à zéro.

**Omikuji** (`lib/omikuji.ts`)
- « Atteins ton objectif du jour (N révisions) » et « Dépasse-le de 10 révisions » deviennent
  « Atteins ton objectif du jour (N étapes) » et « Fais 2 étapes de plus ».
- Les défis de production et d'écoute ne sont proposés que si des éléments ont atteint le niveau
  correspondant (§5.3).
- Défis de lecture et de précision, fortunes : inchangés. Le bonus de station devient un
  **tampon de fortune** (§5c.5).

**Tōkaidō** (`lib/tokaido.ts`)
- La position compte les étapes : span × (0,6 × (leçons terminées + étapes faites de la leçon en
  cours ÷ 7) + 0,4 × maîtrise). Le voyageur avance à chaque étape, plus seulement à chaque leçon.
  La monotonie (on ne recule jamais) et le bonus du contrôle restent.
- *Remplacé par §5c.4* : la position est le nombre d'étapes faites dans le niveau, les villes
  sont fixées par étape, et les bonus du contrôle et de l'omikuji ne font plus avancer le train.

**Catalogue, Lecteur, fiches** (§6, §8)
- La « session de révision ciblée » du Catalogue devient un **entraînement** (aucune écriture
  SRS), comme toute pratique hors parcours.
- « Je connais » (Lecteur) : un élément de leçon déclaré connu est crédité des niveaux 1 et 2 ; il
  ne passe qu'au niveau 3 de sa leçon (Produire), qui vérifie la déclaration.
- L'ajout explicite d'un mot à la révision (tap « à revoir », fiche kanji) crée toujours sa
  carte : le mot revient dans les étapes Révision.
- Les éléments « difficiles » (leeches) et leur remise à zéro sont inchangés ; l'étape Révision les
  sert en priorité parmi les éléments fragiles.

**Données et synchro** (`lib/db.ts`, `lib/sync.ts`)
- Nouvelle version du schéma IndexedDB : étapes faites par leçon (`LessonProgressRecord`), niveau
  atteint par élément (vocabulaire et grammaire), étapes par jour (`SrsDailyRecord`), forme,
  niveau et durée par réponse (`ReviewLog`).
- Le snapshot de synchro porte ces champs ; un snapshot d'avant la migration s'importe et passe
  par la reprise (§5.6). La réinitialisation de la progression les efface aussi.

**Code retiré** : `lib/tuning.ts` (cible et débit ; la mesure de rétention reste dans
`lib/stats.ts`), `effectiveNewPerDay`, `sustainableNewPerDay`, `NEW_ITEM_LOAD`,
`reviewBlockSize`, `MAX_REINFORCE_PER_FLOW`, `secondChance` et `snapshotBeforeGrade`,
`SRS.newPerDay`, `SRS.sessionCap`, `SRS.unlockIntervalDays`, `SRS.examEligibility`,
`unlockProgress` et `isUnlockReady`, ainsi que l'ouverture du rattrapage par éléments repassés
(`retakeReady`). Leurs tests partent avec eux, remplacés par ceux du parcours.

### Types de quiz
- **Triangle** kanji ↔ furigana ↔ traduction (§2.2b) — le format de base du vocabulaire écrit
- Grammaire (« que signifie てもいい ? », parmi des règles voisines du curriculum)
- Reconstruction (remettre une phrase mélangée dans l'ordre) — un ordre faux est une erreur de
  **syntaxe** : les mots de la phrase valent « Difficile », jamais un échec, sans quoi le lexique
  le plus fréquent serait rétrogradé (et marqué difficile) par des phrases ratées sur la structure
- Écoute (audio joué, comprendre sans le texte)

**Un seul assembleur** (`buildSession`, `lib/reviewSession.ts`) sert toutes les entrées — étapes
du parcours, entraînement libre d'une leçon, exercices d'une histoire. Seule la **source** des
éléments change (`scope`), jamais le format.

**Entraînement ≠ parcours.** Seules les étapes du parcours (première réponse de chaque exercice)
et le premier passage des exercices d'une histoire notent les cartes. L'entraînement libre sur
une leçon (`scope: "all"`) ou une sélection du Catalogue, une étape refaite et toute relance d'un deck déjà joué (ratés rejoués,
« Recommencer » du Lecteur) n'écrivent **rien** dans le SRS — ni la carte, ni le journal, ni le
compteur du jour.

L'ordre des exercices est **mélangé** à l'intérieur d'un niveau : le tri par échéance sert à
choisir les cartes qui tiennent dans une étape Révision, pas à décider de leur ordre de passage.

## 5b. Contrôle de fin de leçon — le 関所 *(nouveau)*

Passer à la leçon suivante se **mérite à une épreuve**, pas à l'accumulation d'intervalles
FSRS. Le contrôle reprend la métaphore de la route : les **関所 (sekisho)**, postes de barrière
du Tōkaidō — Hakone, Arai, Fukushima —, où l'on ne passait qu'après contrôle.

**Ce n'est PAS une session de révision de plus.** Quatre différences dures avec `buildSession` :

1. **Aucune correction pendant l'épreuve** — on répond à tout, puis on rend la copie.
2. **Aucune note rendue en séance** — la révision, elle, enchaîne d'un bouton « Continuer »
   qui note la réussite d'office ; ici on ne sait rien avant la copie corrigée.
3. **Béquilles coupées** — la saisie remplace le QCM partout où c'est possible, pas de
   furigana, pas de traduction à la demande, écoutes comptées (2 en dictée), pas
   d'échappatoire « Afficher le texte ». Une seule glose subsiste, et c'est l'exercice de
   **lecture** qui la porte (voir le tableau ci-dessous) : elle NOMME le mot à lire au lieu
   de l'affaiblir.
4. **Un barème, une note /20, une mention, une copie corrigée** (ta réponse / la réponse
   attendue / les points, exercice par exercice).

**Le sujet ne sort QUE de la leçon** (son vocabulaire, ses points de grammaire) : les
histoires n'y entrent pas — on vérifie ce qui a été *enseigné*, pas ce qui a été *lu*.

La copie tient sur 20 points, et **la moitié porte sur la leçon elle-même** (règle, emploi,
correction, cours) — l'autre sur la restitution :

| # | Exercice | Ce qu'il vérifie | Barème |
|---|---|---|---|
| 1 | **Dictée** | phrase jouée, reconstruction par tuiles, 2 écoutes | 3 |
| 2 | **Lecture** | graphie en kanji → lecture en kana, **en saisie**, le mot nommé par son sens | 3 × 1 |
| 3 | **Version** (JA → FR) | QCM de sens, distracteurs de même niveau JLPT | 2 × 1 |
| 4 | **Thème** (FR → JA) | production en saisie, sans options | 2 × 1 |
| 5 | **Règle** | « quel est le rôle de を ? » — la **forme seule**, parmi des règles voisines | 1 × 2 |
| 6 | **Emploi** | la particule enseignée retirée d'une phrase (« 本＿読む ») | 1 × 2 |
| 7 | **Correction** | quatre phrases, **une seule correcte** — la faute à voir | 1 × 2 |
| 8 | **Le cours** | QCM FR : ce que la forme marque, quand elle tombe, le piège | 2 × 1 |
| 9 | **Compréhension** | texte **inédit** écrit pour l'épreuve + QCM en français | 2 × 1 |

Les exercices 1 à 7 sont **déterministes** (inventaire + cartes SRS) ; seuls les deux
derniers passent par le Worker (`kind: "exam-lesson-qcm"` et `"exam-text"`). Une section sans
matière — hors-ligne, écoute en pause, leçon sans grammaire — est **retirée du sujet et du
barème** : la note reste ramenée sur 20, jamais une section comptée fausse.

**Deux questions qu'un sujet ne doit jamais poser** (`lib/examQuality.ts`), parce qu'elles
mesurent autre chose que ce qu'elles prétendent :
- la **réponse dans l'énoncé**. Le cas d'école est le nom d'un point de grammaire, glosé en
  français au référentiel : « ある (exister, inanimé) : quel est son rôle ? » avec « Existence
  d'objets inanimés » à cocher. La cause est traitée à la racine — l'énoncé ne montre que la
  **forme** (`grammarForm`) —, et un filet attrape le reste, y compris ce que produit le Worker ;
- **deux fois la même question**. La section « Règle » demande le rôle de を, et le QCM de cours
  le redemande trois questions plus loin sous d'autres mots. Les questions françaises du sujet
  sont donc comparées entre elles — sur leur énoncé ET sur leur bonne réponse, réduits en
  radicaux, deux formulations d'une même chose se reconnaissant — et la reformulation tombe. Le
  filtre passe **avant** le plafond d'une section : trois questions dont deux se répètent en
  rendent une, pas deux. Une section vidée est retirée du barème comme une section sans matière.

L'exercice de **lecture** nomme le mot qu'il fait lire (« Écris la lecture de « mer » en kana »
sous 海) pour la raison symétrique : 海 posé seul demande d'abord QUEL MOT ce kanji écrit, et la
faute comptée est alors une faute de vocabulaire — répondre いけ, c'est avoir lu 池. Le sens est
déjà interrogé pour lui-même en version et en thème, et un mot ne passe qu'une fois dans le
sujet : le nommer ici ne donne la réponse d'aucune autre question.

**Deux garde-fous pédagogiques**, parce qu'un contrôle ne doit jamais enseigner un faux :
- les fautes de l'exercice 7 sont **fabriquées et indiscutables** (deux particules échangées,
  une particule doublée, le groupe verbal déplacé). La *suppression* d'une particule est
  volontairement exclue : l'ellipse de は ou を est courante en japonais réel ;
- l'exercice 6 donne toujours la **traduction française** et exclut des leurres toute
  particule qui **commute** avec la réponse (は accepte が, も, を dans la même phrase) —
  sans quoi la question aurait deux bonnes réponses.

**Variété.** La matière d'une leçon est mince (la première n'a que quatre mots et deux
phrases d'exemple), d'où deux règles dures : **un mot ne passe qu'une fois** dans tout le
sujet — les exercices se les répartissent en tourniquet plutôt qu'un seul les prenant tous —
et **une phrase ne sert qu'à un exercice** (dictée, emploi, correction). Quand la leçon est
épuisée, le sujet complète avec les mots des **leçons précédentes** (un contrôle interroge
aussi l'acquis) ; s'il n'y en a pas, il rend moins de questions plutôt que les mêmes deux
fois.

**Tirage déterministe** : le sujet est seedé par `(leçon, n° de tentative)` — rouvrir une
épreuve interrompue redonne le même sujet, un rattrapage en donne un autre, les tests
rejouent une tentative à l'identique.

**Une seule clé** (le parcours, §5, remplace l'ancienne double clé) :
- **Ouverture** — le contrôle est la **septième étape** du parcours de la leçon : il s'ouvre quand
  les six premières sont faites. La leçon a alors été enseignée (cours), travaillée aux trois
  niveaux (vocabulaire, grammaire, production) et lue (histoire). L'ancien droit de se présenter,
  60 % des éléments stabilisés en FSRS (`SRS.examEligibility`), est **supprimé** : il faisait
  dépendre l'épreuve du temps écoulé et de la charge de révision, pas du travail fait. Depuis la
  page de la leçon, on peut tenter le contrôle avant la fin du parcours : c'est un choix assumé,
  jamais une proposition du flux.
- **Déblocage** — l'**admission** (≥ `EXAM.passMark`, 12/20) ouvre la leçon suivante et
  marque la leçon terminée. Une leçon déjà commencée (« Commencer quand même ») ne se
  referme jamais.

**Notation** : réponse juste = tous les points ; **coquille = la moitié** (cf. `lib/typo.ts`) ;
blanc ou faux = 0. Chaque réponse est ensuite replanifiée en FSRS (`good` / `hard` / `again`) —
une épreuve ratée n'est pas du travail perdu, c'est la révision du lendemain.

**Rattrapage** : après un échec, le parcours insère une étape **Révision ciblée** sur les éléments
ratés (niveaux 2 et 3), puis rouvre le contrôle avec un **nouveau tirage** — pas de minuterie,
pas d'acharnement sur le même sujet.
Chaque copie est conservée (store `exams`, synchronisée) et relisible depuis la leçon ;
franchir la barrière fait gagner du chemin sur la route en cours.

**Repasser un contrôle réussi** est toujours possible — pour la note, jamais pour le droit de
passer : **seule la meilleure note compte**, et une copie ratée derrière une admission ne
referme jamais la leçon suivante.

**Où la note se lit** :
- sur la **carte de leçon** — badge `16/20`, et sous la jauge « contrôle 16/20 — Très bien » ;
  une fois la barrière franchie, la jauge des étapes (§5.2) cède la place à la **maîtrise**
  (objectif long terme, intervalle ≥ 21 j) ;
- dans les **Statistiques**, un **bulletin** : une ligne par leçon présentée (meilleure note,
  mention, nombre de tentatives) et la **moyenne générale**, chaque leçon comptant pour une.

## 5c. L'accueil : la voie du voyage *(nouveau)*

Le parcours (§5) devient **l'information principale de l'accueil** : une voie ferrée qui serpente
sur toute la page, sans fin, des étapes déjà faites jusqu'aux leçons à venir. Les étapes en sont les
arrêts, les villes du voyage (Tōkaidō, puis les routes suivantes) sont posées sur les rails, et un
petit train montre où l'on en est. La voie fusionne trois éléments qui se répétaient : la bande du
Tōkaidō, la carte « Parcours » et la liste des leçons.

Maquettes de référence (canevas « Redesign de l'accueil ») : **L** pour la structure, **P2** pour
la voie et le train, **Q** (catalogue du décor), **R** (agencement réel) et **S** (changement de
niveau). Les maquettes fixent le style général ; elles ne valident pas chaque élément de décor.

### 5c.1 Ce que montre l'accueil

- **En-tête** : la route et la ville atteinte (« 東海道 4/54 »), le nombre de tampons récoltés
  (« 印 4 »), la série de jours, l'anneau des étapes du jour (« 2/3 ») et les réglages. Toucher la
  route ou les tampons ouvre le Voyage (§5c.5) ; toucher la série ou l'anneau ouvre les
  Statistiques.
- **Bandeau de leçon**, collé en haut de l'écran : la leçon visible à l'écran (« Leçon 12 · étapes 78
  à 84 », son titre) et un bouton pour relire son cours. Il change quand une autre leçon passe
  au centre de l'écran.
- **La bande de ciel** (§5c.6b), sous le bandeau : le ciel, ses repères et le décor qui défile.
- **La voie** (§5c.2), qui occupe tout le reste de l'écran. L'accueil tient dans l'écran : la
  page ne défile pas, la voie défile dans sa propre zone, du bas de la fenêtre du ciel au bas de
  l'écran (barre d'onglets, lecteur). Les en-têtes, le bandeau et la fenêtre restent en place.
- **Ce qui quitte l'accueil** :
  - la bande du Tōkaidō : la voie la remplace, et le Voyage garde la vue d'ensemble ;
  - la carte « Parcours » : la bulle de l'étape à faire la remplace (§5c.2) ;
  - la liste des leçons et « Voir tout le parcours » : elles sont dans l'onglet Catalogue ;
  - « Nouvelle leçon débloquée » : la leçon suivante apparaît d'elle-même sur la voie ;
  - « À lire pour toi » : passe en tête de l'onglet Histoires ;
  - « Relecture-miroir » : reste proposée par le flux entre deux étapes (§5.8), sans carte ;
  - la carte de l'omikuji : la bandelette s'ouvre toujours d'office au premier lancement du
    jour, et se rouvre depuis le Voyage ;
  - le lien « Statistiques » : remplacé par l'en-tête.

### 5c.2 La voie

**Les nœuds, dans l'ordre du voyage**

| Nœud | Numéro | Icône | Libellé (mot, lecture, nom) |
|---|---|---|---|
| Cours | oui | 講 | 講義 こうぎ · Cours |
| Vocabulaire | oui | 語 | 語彙 ごい · Vocabulaire |
| Grammaire | oui | 文 | 文法 ぶんぽう · Grammaire |
| Révision | oui | 復 | 復習 ふくしゅう · Révision |
| Histoire | oui | 話 | 話 はなし · Histoire |
| Produire | oui | 書 | 書く かく · Produire |
| Contrôle | oui | 関 (carré) | 関所 せきしょ · Contrôle |
| Révision insérée (§5.4) | non | 復 | 復習 ふくしゅう · Révision insérée · 34 cartes |
| Révision ciblée (après un contrôle échoué) | non | 復 | 復習 ふくしゅう · Révision ciblée |
| Station de repos (§5.4) | non | 休 | 休憩 きゅうけい · Station de repos |
| Ville du voyage | non | selon sa taille (§5c.4) | nom en kanji, lecture, « Ville 5 · Totsuka » |
| Séparateur de leçon | — | — | « Leçon 13 », cadenas tant qu'elle est fermée |
| Fin de route, correspondance | — | — | §5c.7 |

- **Numérotation globale.** Le numéro d'une étape est son rang dans tout le curriculum, dans
  l'ordre des leçons : la première étape de la leçon 1 est la n° 1, et la numérotation continue
  d'un niveau à l'autre. Une étape absente d'une leçon (une leçon sans grammaire) n'est pas
  comptée. Le numéro se calcule à partir du curriculum : il ne dépend pas de ce que l'on a fait.
  Les nœuds non numérotés (révisions insérées, station de repos) ne décalent pas les numéros.
- **Libellés** : le mot japonais, sa **lecture en kana dessous** (pour pouvoir le dire sans
  connaître le kanji), puis le numéro et le nom français, et la durée pour les étapes à venir
  (« 81 · Révision · ~4 min »). Les villes aussi ont leur lecture.
- **États des étapes**, dessinés comme des sceaux :
  - **faite** : sceau vermillon plein, filet intérieur, légèrement de biais (angle stable par
    numéro, entre −8° et +8°) ;
  - **à faire** : cercle en pointillés vermillon, plus grand, avec un halo ;
  - **à venir** : cercle en pointillés d'encre.

  Les nœuds d'une leçon pas encore ouverte sont atténués (opacité 45 %).
- **La bulle de l'étape à faire**, accrochée à son nœud, du côté libre :
  - le numéro et le mot avec sa lecture et son nom ;
  - le contenu (points de grammaire, nombre de mots) ;
  - les exercices et la durée annoncée (§5.7) ;
  - le bouton **Commencer**, qui lance le flux sur cette activité ;
  - « Réviser seulement · N cartes dues » quand des cartes sont dues.
- **Le tracé** : des virages lissés, en zigzag, calculés de façon déterministe à partir du rang
  du nœud, avec un espacement vertical propre à chaque type de nœud. L'amplitude dépend du
  paysage du tronçon : lacets serrés aux cols, grandes courbes en plaine. Les illustrations
  uniques réservent leur place et la voie les contourne (§5c.6).
- **Le rendu des rails** (maquette P2) :
  - un ballast de 18 px avec son gravier ;
  - des traverses qui passent sous deux rails fins, écartés de 5 px ;
  - les rails en vermillon derrière le train, en encre devant ;
  - dessiné en SVG, uniquement avec des tokens.
- **Le défilement** :
  - l'accueil s'ouvre centré sur l'étape à faire ;
  - les leçons se chargent par blocs au fil du défilement : vers le haut les leçons faites,
    vers le bas les leçons à venir, jusqu'à la fin du curriculum ;
  - seules les leçons proches de l'écran sont rendues ;
  - un bouton flottant « Revenir à l'étape 80 » apparaît quand l'étape à faire sort de l'écran.
- **Toucher un nœud** :
  - une étape faite propose de la refaire en entraînement (§5.5) ou d'ouvrir sa leçon ;
  - une étape à venir dit ce qu'elle demande et quand elle viendra (« après l'étape 81 ») ;
  - une ville ouvre sa fiche (note, tampon) ;
  - un séparateur ouvre la page de sa leçon.

### 5c.3 Le train

- **L'aspect.** Un petit train vu du dessus (36 × 11 px), posé sur les rails, orienté le long de
  la voie. Il est arrêté juste avant l'étape à faire, comme à quai.
- **La couleur** est celle de la route (`trainColor`, `data/routes.ts`) : vermillon pour le
  Tōkaidō, indigo pour le Kōshū Kaidō, puis vert, or et violet.
- **Le mouvement.** Quand on revient sur l'accueil après une étape terminée, le train roule de son
  ancien arrêt au nouveau (environ 1,6 s, départ et arrivée en douceur). Les rails passent en
  vermillon derrière lui. S'il dépasse une ville, elle passe à « passée » et son tampon se pose
  (§5c.5).
- **Plusieurs étapes d'un coup** donnent un seul trajet, plafonné à 3 s.
- **L'arrêt vu en dernier** est mémorisé : c'est le point de départ du trajet suivant.
- Sous `prefers-reduced-motion`, le train se pose directement à son arrêt.

### 5c.4 Les villes et l'avancée sur la route

- **Une route par niveau**, comme aujourd'hui (`data/routes.ts`) : Tōkaidō pour N5, Kōshū
  Kaidō pour N4, Nakasendō pour N3, Oku no Hosomichi pour N2, Shikoku henro pour N1.
- **Les villes sont fixées par étape.**
  - Un niveau compte T étapes ; sa route compte S tronçons (sa dernière ville porte l'index S).
  - La ville k (de 1 à S) est atteinte à la fin de l'étape `round(k × T / S)` du niveau, et
    jamais avant la première étape.
  - La dernière ville est atteinte à la fin du contrôle final du niveau.
  - Sur la voie, la ville se dessine juste après cette étape. Si plusieurs villes tombent sur la
    même étape, elles se suivent.
  - Pour le Tōkaidō, 469 étapes pour 54 tronçons font une ville toutes les 8 à 9 étapes, soit
    à peu près toutes les 1,2 leçon.
- **La position sur la route est le nombre d'étapes faites dans le niveau.** Ce qui change dans
  `lib/tokaido.ts` :
  - **fin de la formule** 0,6 × leçons + 0,4 × maîtrise : la maîtrise reste affichée ailleurs ;
  - **fin du bonus du contrôle** (`EXAM.tokaidoBonus`) : le contrôle est déjà une étape ;
  - **fin du bonus de l'omikuji** sur la position : un défi accompli donne à la place un
    **tampon de fortune** (§5c.5) ;
  - **la monotonie est acquise par construction** : `maxReached` n'est plus lu.
- **Reprise d'une base existante.** Les arrivées déjà fêtées (`lastCelebrated`) restent acquises
  et leurs tampons sont gardés. Si l'ancienne formule plaçait le train plus loin, la ville reste
  marquée comme visitée et n'est pas fêtée une seconde fois.
- **Taille des villes**, donnée par les données de la route (§5c.6) :

  | Taille | Nœud | Repère |
  |---|---|---|
  | **village** | 44 px, simple anneau indigo, 村 | sans décor dédié obligatoire |
  | **ville** (relais, 宿場町) | 56 px, double anneau indigo, 宿 | au moins un repère réel |
  | **grande ville** (ville-château, grande cité) | 64 px, double anneau, son kanji propre (城, 京…) | une illustration propre |
  | **départ et terminus** | 64 px, triple anneau, 橋 (Nihonbashi), 京 (Kyōto)… | une illustration propre |

  Une ville passée a un anneau plein ; la prochaine, un anneau en pointillés.
- **Le Voyage** (`ui/Voyage.tsx`) devient exact. « Encore ~2 leçons jusqu'à Totsuka » devient
  « encore 6 étapes jusqu'à Totsuka ».

### 5c.5 Les tampons

- **Le tampon de ville.** Chaque ville atteinte donne son tampon de gare (駅スタンプ) :
  - un carré vermillon à double filet, avec un motif et le nom ;
  - le motif vient du repère principal de la ville (château, mont, vague, pont, temple, lac,
    rizière, pins) ;
  - les grandes villes et les lieux uniques ont un tampon dessiné pour eux.
- **Sur la voie**, le tampon est posé à côté de sa ville, du côté libre, légèrement de biais.
- **L'arrivée en gare** (`ui/StationArrival.tsx`) :
  - la fiche montre le tampon qui se pose (révélé à l'encre, sans animation sous
    `prefers-reduced-motion`), puis la note de la ville ;
  - quand plusieurs villes sont franchies d'un coup, une seule fiche s'ouvre : elle montre la
    dernière ville et cite les autres.
- **Le carnet** est dans le Voyage :
  - la grille des tampons de chaque route, ceux à venir en pointillés ;
  - toucher un tampon ouvre la fiche de sa ville ;
  - les tampons de fortune de l'omikuji (大吉, 吉…) ont leur page.
- **Le tampon de fortune.** Le défi de l'omikuji accompli donne le tampon de la fortune du jour,
  au lieu d'une fraction de station. La bandelette annonce « Défi accompli : le tampon 吉 rejoint
  ton carnet ».
- **Le compteur 印 de l'en-tête** compte les tampons de ville, toutes routes confondues.

### 5c.6 Le décor

**Principe.** Tout élément du décor existe vraiment sur la route, à l'endroit où il est dessiné :
la géographie réelle, les monuments et les estampes d'Hiroshige servent de source. Un repère dont
la source n'est pas sûre n'est pas mis. Le décor est à l'encre ; trois choses seulement ont une
couleur :
- l'eau, en indigo ;
- le vermillon : torii, soleil, érables, bavoirs des jizō, lanternes allumées ;
- la neige, en blanc.

**Le catalogue des éléments** (maquette Q). Chaque élément a son dessin, dans un jeu de sprites
commun aux cinq routes :

| Famille | Éléments |
|---|---|
| Relief et eau | montagnes et col, rivière, gué à porteurs, pont de bois, lac, mer et vagues, rizières, champs de thé, cascade |
| Arbres | allée de pins, allée de cèdres, bambouseraie, verger, vigne |
| Saisons | cerisiers, hortensias, érables rouges, neige, averse, lucioles |
| La route | borne-lieue (一里塚), poteau indicateur, jizō, lanterne de pierre, maison de thé, ville-étape, poste de contrôle, bac |
| Lieux sacrés et villes | torii, sanctuaire, temple, pagode, château, bateaux de pêche, entrepôts, moulin à eau, toits de grande ville |
| Le ciel | soleil, aube et crépuscule, lune, étoiles, brume, vol d'oies, hirondelles, grue |

**Les illustrations uniques.** Un lieu remarquable a son propre dessin, plus grand (jusqu'à toute
la largeur), qui réserve sa place sur la voie :

| Route | Illustrations uniques |
|---|---|
| Tōkaidō | Nihonbashi et Edo (départ), le Fuji (vu de Hara et Yoshiwara, et du col de Satta), Hakone (lac Ashi, torii dans l'eau, poste de contrôle), le gué de l'Ōi, le lac Hamana, la traversée en mer de Miya à Kuwana, Kyōto (Sanjō Ōhashi, pagode) |
| Kōshū Kaidō | Nihonbashi, le pont-singe de Saruhashi, les vignes du bassin de Kai et le Fuji vu de Kai, le lac Suwa |
| Nakasendō | Nihonbashi, le col d'Usui et le volcan Asama, la vallée du Kiso (Tsumago, Magome), le lac Biwa, Kyōto |
| Oku no Hosomichi | Edo (Fukagawa, départ de Bashō), Nikkō, Matsushima, Hiraizumi, Yamadera, Kisakata, Ōgaki |
| Shikoku henro | les tourbillons de Naruto, le cap Muroto, le pont de lianes d'Iya, la pagode de Zentsū-ji, Ōkubo-ji |

Une illustration unique porte le nom de son lieu (kanji · romaji), discret, à son pied et du
côté loin de la voie ; le même nom paraît sur son repère dans la bande de ciel (§5c.6b).

Une illustration unique est peinte par plans opaques, du fond vers l'avant : chaque plan cache
celui qu'il recouvre, sans transparence croisée. Aucun plan ne s'arrête sur un bord droit de sa
place : les monts se perdent dans la brume à leur pied, les lacs ont leurs rives effilées, la
terre s'effile. Seuls les bords de la voie (gauche et droite de l'écran) coupent l'eau d'une
traversée. Les petits éléments du catalogue suivent la même règle : pas de socle rectangulaire, et des
aplats opaques (un bâtiment cache ce qu'il recouvre, sur la voie comme dans le ciel).

**Les données de chaque route** (`data/scenery/<route>.ts`, à côté de `data/<route>.ts`) :
- **pour chaque ville** : sa taille (§5c.4), ses repères réels (élément du catalogue, côté de la
  voie s'il compte, illustration unique éventuelle) et le motif de son tampon ;
- **pour chaque tronçon** (d'une ville à la suivante) : son paysage dominant (côte, plaine et
  rizières, montagne et col, forêt, bord de lac, bord de rivière, ville) et ses traversées (pont,
  gué, bac).

**Les règles d'agencement** (maquette R) :
1. **Ancrage.** Un repère réel est ancré à une ville, ou au tronçon entre deux villes : il apparaît
   dans cette portion de la voie.
2. **Côté.** Il se place du côté opposé aux libellés des étapes. Jamais à moins de 24 px d'un nœud,
   jamais sous un libellé ni sous la bulle. Les boîtes des nœuds, des libellés et de la bulle
   servent de zones interdites.
3. **L'eau croise la voie** :
   - rivière : un pont ;
   - gué : des rails sur pilotis ;
   - mer ou lac traversé en bateau : des rails en pointillés et un bac.
4. **Le relief règle les virages.** Les cols resserrent la voie en lacets, entre deux versants ;
   les plaines l'étirent.
5. **La profondeur.** Ce qui est loin est grand et pâle (le Fuji, les montagnes) ; ce qui est
   près est petit et plus contrasté (jizō, bornes, lanternes).
6. **Le remplissage.** Entre les repères réels, le paysage du tronçon fournit son décor :
   1 à 2 éléments par écran de chaque côté, tirés au sort avec une graine stable (le tronçon) pour
   que le décor ne change pas d'une visite à l'autre.
7. **La distance.** Une borne-lieue revient toutes les 4 étapes.

**Les saisons** suivent le calendrier réel (date locale) :

| Période | Ce qui change |
|---|---|
| 20 mars – 30 avril | cerisiers en fleur, pétales, hirondelles |
| juin | hortensias, averses |
| juillet – août | lucioles la nuit, rizières vertes |
| octobre – novembre | érables rouges, vols d'oies |
| décembre – février | neige sur les cols et les toits, grues au-dessus des rizières |

Deux exceptions viennent des estampes : Kanbara reste toujours sous la neige, et Shōno toujours
sous l'averse.

**Le ciel.** Il occupe la bande de ciel (§5c.6b), séparé de la voie : il rappelle
l'heure qu'il est.
- Son fond prend la teinte de l'heure (jour, aube et crépuscule, nuit), dérivée des tokens.
- Le soleil monte et descend selon l'heure.
- À l'aube et au crépuscule, il est à demi caché derrière une crête.
- La nuit, la lune a sa phase réelle et les étoiles scintillent ; c'est la logique de la bande
  actuelle, reprise telle quelle.
- La brume des estampes apparaît au matin.

**Thèmes.** Clair et sombre partagent les dessins ; seules les couleurs changent, par des tokens de
décor (DESIGN.md).

### 5c.6b La bande de ciel

Maquettes de référence : **D · Panorama qui se replie** et **G · Les repères se lèvent derrière la
crête, décor qui défile** (canevas « Ciel séparé — propositions »). Le ciel ne se mélange plus à
la voie : il a sa bande, opaque, sous le bandeau de leçon, et la voie s'arrête à la fenêtre :
elle défile dans sa propre zone, dessous, et rien d'elle ne passe sous la bande. Tout se mesure
dans cette zone : le bas de la fenêtre, la voie visible (du bas de la fenêtre au bas de la
zone), la place de l'étape à faire et le bouton de retour. La bande ne contient aucun bouton :
la molette y fait défiler la voie.

- **Le repli.** La zone commence par la place du panorama déplié (280 − 120 px), sans voie ; la
  fenêtre dépliée la couvre et se replie au même pas que la voie monte : le bas de la fenêtre
  reste collé au départ de la voie, jusqu'à 120 px.

- **La fenêtre du train.** La bande se regarde par une vitre : un cadre fin aux coins arrondis,
  en retrait de 4 px sous le bandeau et de 8 px sur les côtés et en bas, et dont le rebord jette
  une ombre légère sur le haut de la voie. Le décor qui glisse de côté est le paysage vu du
  train ; la voie, dessous, est la carte. Rien ne déborde du cadre.

- **Le panorama du départ.** Tout en haut de la voie, avant la première étape, le ciel est grand
  (280 px) et porte le nom de la route en kanji et son sous-titre. Au défilement, il se replie
  jusqu'à 120 px, et y reste.
- **Le ciel et le sol.** L'horizon partage la bande : le ciel au-dessus, un sol en dessous, qui
  prend 40 % de la bande (entre 50 et 112 px), opaque, un peu plus sombre vers le bas de la vitre. Les
  plans s'étagent sur ce sol, du plus loin (en haut, contre l'horizon) au plus proche (en bas) :
  l'eau des repères se pose sur le sol, devant les monts, jamais sur eux.
- **Les plans**, du plus loin au plus proche :
  1. le fond du ciel, teinté selon l'heure, avec le soleil, la lune et les étoiles ;
  2. une crête lointaine dressée sur l'horizon, qui défile le plus lentement (0,08 px par px
     défilé) ;
  3. le **plan moyen** qui défile (monts, forêts, temples), aux 6/10 du sol ;
  4. les **repères** des villes, au quart du sol ;
  5. le **plan proche** qui défile (arbres, champs, maisons, bateaux), 10 px au-dessus du bas de
     la vitre — une bande de sol vide et calme sépare ce qui glisse vite de la voie — en
     silhouettes plus marquées. Il s'écarte devant un repère pour ne pas le cacher.
  Les deux plans qui défilent rapetissent quand la bande se replie.
- **Les repères des villes.**
  - Ont un repère : les illustrations uniques, et les villes, grandes villes et terminus. Le
    repère d'une ville est le sprite de son motif, tiré du catalogue ; celui d'une illustration
    unique porte le nom de son lieu (芦ノ湖 · lac Ashi, et non la ville d'Hakone) et sa place
    est celle du dessin sur la voie : il se lève quand le dessin passe sur la voie visible.
  - Chacun a sa taille fixe et **glisse avec le décor**, derrière le plan proche : à 0,35 px par px défilé, entre le plan
    moyen et le plan proche. Il est à sa place, vers le milieu de l'horizon, quand sa ville passe
    au milieu de la voie visible, et reste dans la bande tant que son nom est affiché.
  - Il traverse le ciel comme le reste du décor, sans apparition ni disparition : il entre par un
    côté et sort par l'autre. Son nom (kanji · romaji) paraît en fondu au-dessus de lui tant que
    sa ville est sur la voie visible : la voie s'arrête à la fenêtre, et une ville passée sous la
    bande n'a plus de nom affiché. Sa place étant au milieu, il paraît et s'efface au même écart
    de part et d'autre, avec le même fondu (300 ms).
- **Le décor qui défile.**
  - Deux plans glissent de côté au fil du défilement, dans le même sens que les repères : le plan
    moyen à 0,22 px par px défilé, le plan proche à 0,42 px.
  - Chaque élément a son rang sur une bande sans fin, d'où se tirent sa place, sa taille et sa
    forme : le décor ne change pas d'une visite à l'autre.
  - Il prend le **paysage du tronçon** (§5c.6, données de la route) où l'on est quand il passe
    au milieu : rizières et maisons en plaine, cèdres et monts en montagne, bateaux sur la
    côte, toits et temples en ville…
- **Le soleil, la lune, les étoiles**, la brume du matin, les oiseaux et les pétales gardent leur
  logique (ci-dessus).
- **Le défilement.** La bande se recalcule une fois par image de défilement ; seul le nom des
  repères paraît et s'efface en fondu. L'ouverture, le bandeau de leçon et le bouton de retour
  tiennent compte de la bande : l'étape à faire se place au tiers haut de la voie visible.
- Sous `prefers-reduced-motion`, le nom des repères paraît sans fondu, et les étoiles ne
  scintillent plus.

### 5c.7 Le changement de niveau

- **L'arrivée au terminus.** Le contrôle final du niveau, sa dernière étape, amène le train au
  terminus : 三条大橋 à Kyōto pour le Tōkaidō.
- **Une célébration plein écran** (l'arrivée en gare, en grand) :
  - le grand tampon du terminus ;
  - « Le Tōkaidō est fait. Niveau N5 terminé. » ;
  - les chiffres du voyage : tampons, étapes, leçons, jours depuis le départ.
- **Sur la voie, dans l'ordre** :
  1. un butoir au bout des rails ;
  2. la **carte de fin de route**, qui reste dans le fil : tampon du terminus, 東海道踏破
     (とうかいどう とうは), les chiffres, « Ouvrir mon carnet » ;
  3. le **panneau de correspondance** (乗り換え) : le niveau suivant, sa route et son sous-titre,
     le nombre de villes ;
  4. la **nouvelle voie**, qui part de la ville de départ de la route (Nihonbashi pour les trois
     premières), avec un nouveau train à la couleur de la route.
- **La numérotation continue** : la première étape du N4 suit la dernière du N5.
- **Le bandeau de leçon** suit la route visible.
- **Fin du curriculum.** Si le niveau suivant n'a pas encore de leçons, la voie continue après le
  terminus en pointillés : « La suite du voyage se prépare ». Le flux propose des révisions
  libres (§5.1), affichées comme un nœud Révision non numéroté, toujours disponible.

### 5c.8 Performance et accessibilité

- **Performance.**
  - Tout est en SVG, sans requête réseau.
  - Seules les leçons proches de l'écran sont rendues.
  - La mise en page (nœuds, tracé, décor) est un calcul pur, mémorisé par bloc de leçons.
  - Le train et les rails animés utilisent `offset-path` et `stroke-dasharray`, sans recalcul de
    mise en page.
  - La bande de ciel se recalcule une fois par image de défilement ; ses repères et ses
    paysages sont mémorisés avec la mise en page.
- **Accessibilité.**
  - Chaque nœud est un bouton étiqueté (« Étape 80, grammaire, à faire »).
  - Le décor, les rails, le train et la bande de ciel sont `aria-hidden`.
  - L'ordre de tabulation suit la voie.
  - Les textes gardent leurs contrastes (DESIGN.md §7), et les animations sont coupées sous
    `prefers-reduced-motion`.

### 5c.9 Ce que la voie change ailleurs

- `ui/Home.tsx` est réécrit autour de la voie.
- `ui/TokaidoStrip.tsx` quitte l'accueil ; sa logique du ciel (heure, phase de la lune, étoiles)
  passe dans le décor.
- `ui/LessonPath.tsx` garde sa variante bande pour le checkpoint.
- `lib/tokaido.ts` : position par étapes, villes fixées par étape, tampons (§5c.4, §5c.5).
- `lib/omikuji.ts` et `ui/OmikujiSheet.tsx` : tampon de fortune au lieu du bonus de station ;
  `bonusFr` devient le nom du tampon.
- `lib/exam.ts` : plus de bonus Tōkaidō.
- `ui/Voyage.tsx` : étapes exactes jusqu'à la ville suivante, le carnet de tampons, l'omikuji du
  jour.
- `ui/Stories.tsx` : « À lire pour toi » en tête.
- Les tampons de fortune sont gardés en meta : ils sont synchronisés et effacés par la remise à
  zéro de la progression. Les tampons de ville se déduisent des étapes faites et de
  `lastCelebrated`.

## 6. Catalogue / révision à la demande *(nouveau)*
Un écran **bibliothèque** parcourable de tout ce que l'utilisateur connaît ou apprend :
- **Listes** vocab / grammaire, avec leur **statut** (inconnu / à réviser / connu) et leur
  prochaine échéance SRS.
- **Kanji en référence** : liste consultable (sens, lectures, niveau JLPT) depuis l'inventaire —
  sans statut SRS ni cible d'apprentissage. Base pour un futur rattachement au vocabulaire.
- **Filtres** : statut, niveau JLPT, **tag/thème**, piste, « marqués à revoir », et
  **« difficiles »** — les éléments à échecs répétés (leeches, §5), badgés dans la liste et
  **réinitialisables** depuis la fiche du mot (ou la rangée, en grammaire) : cartes FSRS
  neuves et compteur d'échecs remis à zéro par un jalon dans le log de révisions, qui est
  append-only. C'est là qu'ils se consultent — pas dans les Statistiques.
- **Recherche**.
- **Action** : lancer un **entraînement ciblé** depuis une sélection (sans écriture SRS, §5.8), ou
  **alimenter une génération d'histoire** ciblée (§4.1).
C'est le complément de la carte de progression (qui, elle, reste un indicateur de motivation chiffré).

## 7. Tags / thèmes *(nouveau)*
Système de **tags sémantiques** (espace/position, animaux, nourriture, météo, temps…) attachés aux
kanji / vocab / grammaire.
- Sources : **niveau JLPT** (gratuit) ; **tagging assisté LLM** (subjectif → sans risque) ; **édition
  manuelle** (ajout/retrait/création de tags).
- Usages : **révision thématique** (§8) et **génération thématique** (§4.1).

## 8. Interface (mobile d'abord)
- **Furigana au tap** : pas affichés en permanence ; l'utilisateur essaie de lire, puis tape pour
  vérifier.
- **Tap sur un mot** → panneau : lecture, sens, **gloss grammatical**, bouton audio.
- **Gloss littéral** affichable sous la phrase (toggle) ; traduction fluide au tap.
- **Mots à réviser signalés discrètement** : trois états visuels (inconnu / à réviser / connu-neutre),
  soulignement léger ou teinte douce — jamais du fluo. Geste pour tout neutraliser le temps d'une
  lecture immersive.
- **Carte de progression** vocab/grammaire — indicateur de motivation principal.

## 9. Mode voiture — *première classe* (audio seul)
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

## 10. Audio & TTS
- **Google Cloud TTS** (voix japonaises Neural2/WaveNet ; compte GCP déjà actif → pas de friction ;
  quota mensuel gratuit ; export de fichiers pour les packs voiture).
- Granularité : audio **par phrase** (histoires) et **par segment** (voiture : phrase JP / FR /
  prompt Pimsleur).
- **Écouter juste un mot** :
  1. mot présent dans une phrase déjà générée → **timepointing SSML `<mark>`** : on connaît
     l'horodatage de chaque mot, on **seek dans l'audio de la phrase** (même voix, offline, 0 appel) ;
  2. mot arbitraire en ligne → petit appel Cloud TTS **mis en cache** ;
  3. repli hors-ligne / zéro quota → **Web Speech API** du navigateur.
- **Sons de retour des exercices** (`lib/sfx.ts`) : réponse juste (cloche りん, quinte montante),
  réponse ratée (claquement de bois sourd), série terminée (trois cloches montantes). Trois **MP3
  courts** (~30 Ko pièce) **fabriqués au build** par `npm run data:sfx` (synthèse additive dans
  `scripts/build-sfx.mts`, tirages à graine fixe → fichiers reproductibles), embarqués au bundle et
  précachés par le service worker : hors-ligne, zéro appel réseau à l'usage. Lecture en Web Audio
  (tampon décodé une fois, rejoué sans latence) plutôt qu'un `<audio>`, qui redemande le focus
  média à l'OS à chaque lecture. Réglage « Sons de retour dans les exercices » (activé par
  défaut, coupable depuis les **réglages rapides**) ; la **pause d'écoute** (« Je ne peux pas
  écouter ») et le mode **sans le son** les coupent aussi — le téléphone doit rester muet quand
  l'utilisateur a dit qu'il devait l'être. Les trois sons sont calibrés à **niveau perçu égal**,
  mesuré à travers un modèle de petit haut-parleur (passe-haut 400 Hz) : un claquement grave et
  bref s'entendait 13 dB sous la cloche, donc pas du tout sur un téléphone.

## 11. Architecture (hébergement gratuit, clés protégées, génération automatisée)

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
- **CLI locale** (`npm run generate -- --theme … --grammar …`) conservée pour le dev et la prépa en lot
  (clé dans un `.env` local).
- **Boucle fermée** : état SRS (IndexedDB) → génération → texte annoté (furigana + gloss + trad +
  grammaire) → quiz + audio → résultats → MAJ SRS.

### Pré-génération hors-ligne
File de contenu pré-généré (histoires + pistes audio voiture) préparée **en WiFi**, stockée
localement (Cache API / IndexedDB), **lue hors-ligne** ensuite — essentiel pour métro/voiture.

## 12. Vie privée & sauvegarde
- **Repo public** → **aucune donnée perso dans git** (ni SRS, ni historique de lecture).
- État SRS dans **IndexedDB** ; **export/backup** (fichier, chiffrable) — indispensable : sans
  sauvegarde, un appareil perdu = repartir de zéro.
- Acter le **caveat Gemini free tier** : les prompts peuvent servir à l'entraînement Google
  (acceptable pour du contenu d'apprentissage non sensible ; choix conscient).

## 13. Sources de données libres (récapitulatif)

| Donnée | Source | Pourquoi pas le LLM |
|---|---|---|
| Furigana / lectures en contexte | kuromoji / Kuroshiro (UniDic) | Erreurs sur lectures ambiguës |
| Gloss littéral (morphèmes) | kuromoji + JMdict + table particules | Grammaire = réponse déterministe |
| Composition / radicaux + tracés | KanjiVG | Composants exacts (arbre annoté : radical, composant phonétique) et précision graphique. Préféré à KRADFILE, dont la liste plate mêle les sous-parties |
| Lectures + sens des kanji | KanjiDic | Référence fiable |
| Noms propres | JMnedict + dico manuel | Lectures hautement ambiguës |
| Histoires, trad fluide, explications | LLM (Gemini) | Jugées par l'utilisateur |
| Mnémotechniques, tags | LLM (Gemini) | Subjectif, sans « bonne réponse » |

## 14. Risque principal
La **justesse des lectures/furigana** — traitée par l'outil déterministe + correction manuelle +
dico de noms propres. Seul point où une erreur silencieuse pourrait enseigner du faux.
