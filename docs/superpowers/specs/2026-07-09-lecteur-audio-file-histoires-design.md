# Lecteur audio unifié : histoires dans la file d'attente + sync tokenizer

Date : 2026-07-09

## Problème

Deux systèmes audio coexistent :

- **Lecteur persistant** (`ui/usePodcastPlayer.tsx` + `lib/segmentPlayer.ts` + `ui/PodcastPlayer.tsx`) : barre fixe en bas, survit à la navigation, contrôles transport + seek, **réservé aux leçons**, **pas de surlignage token**.
- **Lecteur inline du lecteur** (`useArticlePlayer` dans `lib/tts.ts`, consommé par `ui/Reader.tsx`) : **surlignage token** via timepoints TTS, mais **aucun contrôle transport** (pas de retour au début / navigation), **meurt à la navigation**, et le bouton « Écouter l'article » bascule sur « Chargement… » à chaque phrase.

Objectif : l'histoire se joue dans **le lecteur persistant unique**, synchronisée au tokenizer (surlignage), avec transport, une **file d'attente éditable**, et reprise du surlignage/position au retour sur l'histoire.

## Décisions (validées)

1. **Un lecteur unifié + file d'attente** : le lecteur persistant devient une file de « sources » (histoires ET leçons).
2. **Bouton « Écouter l'article »** : clic principal = *lecture immédiate* (remplace la piste courante). Menu déroulant (split button) → « Ajouter à la file d'attente » = *append*.
3. **File d'attente prioritaire** : à la fin d'une piste, s'il reste des éléments en file, on les joue ; le mode de lecture régit ce qui se passe quand la file est épuisée (voir §Modes).
4. **File éditable complète** : suppression + réordonnancement par **glisser-déposer**, dans la barre.
5. **Bouton mode de lecture** (cycle au clic, façon Spotify), défaut **Lecture auto** :
   - **Lecture auto** : file épuisée → on ajoute une suite selon la *dernière* piste : leçon → leçon suivante du curriculum ; histoire → histoire suivante de la bibliothèque. Rien à ajouter → stop.
   - **Répétition** : file épuisée → on reboucle au début de la file.
   - **Jouer une fois** : file épuisée → stop.
6. **Sélection « histoire suivante »** (mode auto) : `allStories()` est trié du plus récent au plus ancien ; on prend l'élément suivant après l'histoire courante (`index + 1`) ; absent → stop.

## Architecture

### 1. Modèle de données — `lib/podcastScript.ts`

`PodcastSegment` gagne deux champs optionnels (rétrocompatibles) :

```ts
export interface PodcastSegment {
  // …existant…
  /** Surfaces des tokens de la phrase (histoire) : active la synthèse avec timepoints. */
  tokens?: string[];
  /** Index GLOBAL du 1er token de la phrase (pour le surlignage). */
  baseTokenIndex?: number;
}
```

- `tokens` **présent** → chemin cloud via `synthesizeSentence(tokens, baseTokenIndex)` (renvoie les timepoints par token) → alimente le surlignage.
- `tokens` **absent** → comportement actuel intact (`synthesizeText`), aucune régression pour les leçons.

### 2. Constructeur histoire → segments — `lib/storyPodcast.ts` (nouveau, petit)

```ts
buildStorySegments(tokens: AnnotatedToken[]): PodcastSegment[]
```

- Réutilise `splitSentences` (`lib/tts.ts`) : une phrase → un `PodcastSegment`.
- Chaque segment : `chapter:"histoire"`, `lang:"ja"`, `text` = phrase, `tokens` = surfaces, `baseTokenIndex` = index global, `label` = aperçu court de la phrase, `id` stable dérivé de l'index.

### 3. Moteur — `lib/segmentPlayer.ts`

- Nouveau callback `onToken(globalIndex: number | null)` dans `SegmentPlayerCallbacks`.
- Chemin **cloud** : si `seg.tokens`, appeler `synthesizeSentence(seg.tokens, seg.baseTokenIndex)` ; sur `ontimeupdate`, dériver le token courant depuis `marks` (même logique que l'actuel `useArticlePlayer`) → `cb.onToken(i)`. Sinon inchangé (`synthesizeText`, `onToken(null)` au démarrage du segment).
- Chemin **repli Web Speech** : `onboundary` → mapping approximatif du token (porté depuis `useArticlePlayer`) → `cb.onToken`.
- Au démarrage d'un segment sans tokens : `onToken(null)` (efface tout surlignage résiduel).

### 4. État / file — `ui/usePodcastPlayer.tsx`

Modèle de file :

```ts
type PlayMode = "auto" | "repeat" | "once";
type QueueItem =
  | { kind: "lesson"; lessonId: string; title: string }
  | { kind: "story"; storyId: string; title: string };
```

- État : `queue: QueueItem[]` (inclut la piste courante à `currentQueueIndex`), `currentQueueIndex`, `mode`, `currentTokenIndex`, `activeStoryId`.
- API ajoutée : `playStory(story)`, `enqueueStory(story)`, `reorderQueue(from, to)`, `removeFromQueue(index)`, `cycleMode()`. `startLesson` conservé (devient : réinitialise la file avec `[{kind:"lesson"}]` puis joue).
- **Chargement d'un item** : `loadItem(item, opts)` remplace `loadLesson` en généralisant :
  - `kind:"lesson"` → logique actuelle (`getPodcast`/`generatePodcastPack`).
  - `kind:"story"` → `getStory(id)` → `analyze(text)` → `buildStorySegments` → `player.setSegments`.
- **Fin de piste** (`onEnded` du moteur) :
  1. `currentQueueIndex + 1 < queue.length` → charger l'item suivant de la file.
  2. Sinon selon `mode` :
     - `auto` → calculer une suite (leçon suivante curriculum / histoire suivante `allStories`), l'`enqueue` puis la jouer ; rien → stop.
     - `repeat` → recharger `queue[0]`.
     - `once` → stop.
- **`currentTokenIndex`** : mis à jour par `onToken`. `activeStoryId` = `storyId` de l'item courant si `kind:"story"`, sinon `null`.
- **Reprise (reload)** : `RESUME_KEY` généralisé :

  ```ts
  { queue: QueueItem[]; index: number; mode: PlayMode }
  ```

  Au montage : reconstruire la file, charger `queue[index]` sans autoplay. Pour une histoire, `loadItem` ré-analyse le texte → le surlignage repart correctement une fois la lecture reprise (l'index de segment → `baseTokenIndex`).

### 5. Lecteur — `ui/Reader.tsx`

- Supprimer l'usage de `useArticlePlayer`. Lire l'état depuis `usePodcastPlayer`.
- **Surlignage** : `active = podcast.activeStoryId === incoming.id && i === podcast.currentTokenIndex`. Survit à la navigation et au reload sans code supplémentaire dans Reader.
- **Bouton** :
  - Si `activeStoryId === incoming.id` → reflète `playing` (Pause / reprise) via `toggle`.
  - Sinon → « Écouter l'article » appelle `playStory({ storyId: incoming.id, title, tokens })`.
  - **Split button** : chevron → menu « Ajouter à la file d'attente » = `enqueueStory(...)`.
- L'histoire doit être enregistrée (`incoming.id` défini) pour être mise en file (reprise par id). Si `incoming.id` absent (lecteur libre non sauvegardé), le bouton fait une lecture immédiate sans persistance de file — dégradation acceptable.
- **Corrige le flicker « Chargement… »** : le bouton ne bascule plus par phrase ; le fetch par segment est absorbé par la barre (barre de progression), pas par le bouton.

### 6. Barre — `ui/PodcastPlayer.tsx`

- File **éditable** dépliable : liste des `QueueItem` (pas seulement les segments d'une piste), item courant surligné, glisser-déposer pour réordonner, bouton × pour retirer.
- **Bouton mode** (cycle auto → repeat → once) avec icône/texte distinct.
- Transport / seek / retour au début : déjà présents → répond au besoin « naviguer / revenir au début ».
- Les segments d'histoire portent des `label` = aperçu de phrase ; la tracklist par segment existante reste valable pour la piste courante.

## Conséquences / nettoyage

- `useArticlePlayer` (`lib/tts.ts`) devient orphelin (seul appelant = Reader). **À supprimer** avec la portion correspondante de `lib/tts.test.ts`. `speakWord` / `speakSentence` / `splitSentences` **restent** (utilisés par les exercices et le nouveau constructeur).
- Fichiers touchés : `lib/podcastScript.ts`, `lib/segmentPlayer.ts`, `lib/storyPodcast.ts` (nouveau), `ui/usePodcastPlayer.tsx`, `ui/Reader.tsx`, `ui/PodcastPlayer.tsx`, + tests. Changement transversal → implémentation par tranches verticales.

## Critères de succès (vérifiables)

1. Sur une histoire, « Écouter l'article » lance la lecture dans la barre persistante ; le token courant est surligné en synchro.
2. Le bouton n'affiche plus « Chargement… » à chaque phrase.
3. On peut mettre en pause, revenir au début, naviguer entre phrases/pistes depuis la barre.
4. Le menu du bouton ajoute l'histoire à la file sans interrompre la lecture courante.
5. La file est éditable : réordonnancement par glisser-déposer, suppression.
6. Le bouton mode cycle Lecture auto / Répétition / Jouer une fois et se comporte comme spécifié en fin de file.
7. En quittant puis revenant sur l'histoire en cours de lecture, le surlignage reste synchronisé.
8. Après rechargement de page, la file et la position sont restaurées (reprise sans autoplay).
9. Les leçons existantes continuent de fonctionner (pas de régression : chaîne auto en mode « Lecture auto »).
