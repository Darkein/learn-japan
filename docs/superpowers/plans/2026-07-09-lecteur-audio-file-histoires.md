# Lecteur audio unifié — file d'attente + histoires Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Jouer les histoires dans le lecteur audio persistant unique, synchronisées au tokenizer, avec file d'attente éditable (drag & drop), bouton mode de lecture (auto/répétition/une fois) et reprise position + surlignage.

**Architecture:** Le lecteur persistant (`usePodcastPlayer`) devient une file de « QueueItem » (leçon | histoire). Le moteur `segmentPlayer` gagne un callback `onToken` alimenté par les timepoints TTS quand un segment porte des tokens (histoire). Reader lit l'état depuis le contexte au lieu de son hook local `useArticlePlayer`, désormais supprimé. Logique de file/transition extraite en helpers purs testables.

**Tech Stack:** React 18 (contexte + hooks), TypeScript, Vitest, Web Speech API + Cloud TTS (Worker), HTML5 drag & drop natif (aucune dépendance ajoutée).

## Global Constraints

- Aucune régression du mode leçon : une leçon lancée seule en mode « auto » continue de s'enchaîner à la leçon suivante du curriculum.
- Rétrocompatibilité `PodcastSegment` : les champs ajoutés sont optionnels ; segments sans `tokens` = comportement actuel (`synthesizeText`, aucun surlignage).
- Pas de commentaire ajouté au code (règle projet). Style existant conservé.
- Tests : `cd app && npm run test`. Build/typecheck : `cd app && npm run build`.
- `speakWord` / `speakSentence` / `splitSentences` de `lib/tts.ts` RESTENT (exercices + constructeur histoire). Seul `useArticlePlayer` est supprimé.
- Une histoire ouverte dans Reader possède toujours `incoming.id` (ouverte depuis IndexedDB). Vérifier à l'implémentation ; si `incoming.id` absent, le bouton audio est masqué.

---

### Task 1: Champs `tokens` sur PodcastSegment + constructeur `buildStorySegments`

**Files:**
- Modify: `app/src/lib/podcastScript.ts` (interface `PodcastSegment`, ~ligne 15-25)
- Create: `app/src/lib/storyPodcast.ts`
- Test: `app/src/lib/storyPodcast.test.ts`

**Interfaces:**
- Consumes: `splitSentences` (`lib/tts.ts`), `AnnotatedToken` (`lib/furigana.ts`), `PodcastSegment` (`lib/podcastScript.ts`).
- Produces: `buildStorySegments(tokens: AnnotatedToken[]): PodcastSegment[]`. Chaque segment : `chapter:"histoire"`, `lang:"ja"`, `tokens: string[]`, `baseTokenIndex: number`.

- [ ] **Step 1: Ajouter les champs optionnels à `PodcastSegment`**

Dans `app/src/lib/podcastScript.ts`, dans l'interface `PodcastSegment`, après `label?: string;` :

```ts
  /** Surfaces des tokens de la phrase (histoire) : active la synthèse avec timepoints. */
  tokens?: string[];
  /** Index GLOBAL du 1er token de la phrase (surlignage). */
  baseTokenIndex?: number;
```

- [ ] **Step 2: Écrire le test de `buildStorySegments`**

Créer `app/src/lib/storyPodcast.test.ts` :

```ts
import { describe, expect, it } from "vitest";
import type { AnnotatedToken } from "./furigana";
import { buildStorySegments } from "./storyPodcast";

function toks(...surfaces: string[]): AnnotatedToken[] {
  return surfaces.map((surface) => ({ surface }) as AnnotatedToken);
}

describe("buildStorySegments", () => {
  it("crée un segment histoire par phrase avec tokens et index global", () => {
    const segs = buildStorySegments(toks("猫", "は", "寝る", "。", "犬", "も", "寝る", "。"));
    expect(segs).toHaveLength(2);
    expect(segs[0]).toMatchObject({ chapter: "histoire", lang: "ja", baseTokenIndex: 0 });
    expect(segs[0].tokens).toEqual(["猫", "は", "寝る", "。"]);
    expect(segs[0].text).toBe("猫は寝る。");
    expect(segs[1].baseTokenIndex).toBe(4);
    expect(segs[1].id).not.toBe(segs[0].id);
  });

  it("tronque le label des phrases longues", () => {
    const long = "あ".repeat(40);
    const segs = buildStorySegments(toks(long, "。"));
    expect(segs[0].label!.length).toBeLessThanOrEqual(25);
    expect(segs[0].label!.endsWith("…")).toBe(true);
  });
});
```

- [ ] **Step 3: Lancer le test → échec**

Run: `cd app && npx vitest run src/lib/storyPodcast.test.ts`
Expected: FAIL — `buildStorySegments` introuvable.

- [ ] **Step 4: Implémenter `buildStorySegments`**

Créer `app/src/lib/storyPodcast.ts` :

```ts
import type { AnnotatedToken } from "./furigana";
import type { PodcastSegment } from "./podcastScript";
import { splitSentences } from "./tts";

export function buildStorySegments(tokens: AnnotatedToken[]): PodcastSegment[] {
  return splitSentences(tokens).map((s, i) => ({
    id: `story-${i}`,
    chapter: "histoire",
    lang: "ja",
    text: s.text,
    tokens: s.segments,
    baseTokenIndex: s.baseIndex,
    label: s.text.length > 24 ? `${s.text.slice(0, 24)}…` : s.text,
  }));
}
```

- [ ] **Step 5: Lancer le test → succès**

Run: `cd app && npx vitest run src/lib/storyPodcast.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add app/src/lib/podcastScript.ts app/src/lib/storyPodcast.ts app/src/lib/storyPodcast.test.ts
git commit -m "feat(audio): segments histoire avec tokens (base du surlignage dans le lecteur unifié)"
```

---

### Task 2: `segmentPlayer` — callback `onToken` + chemin timepoints

**Files:**
- Modify: `app/src/lib/segmentPlayer.ts`
- Test: `app/src/lib/segmentPlayer.test.ts` (nouveau — helper pur uniquement)

**Interfaces:**
- Consumes: `synthesizeSentence` (`lib/ttsClient.ts`), `synthesizeText`, `PodcastSegment.tokens/baseTokenIndex`.
- Produces: `SegmentPlayerCallbacks.onToken(globalIndex: number | null)`; helper exporté `tokenAtTime(marks, t): number | null`.

- [ ] **Step 1: Écrire le test du helper `tokenAtTime`**

Créer `app/src/lib/segmentPlayer.test.ts` :

```ts
import { describe, expect, it } from "vitest";
import { tokenAtTime } from "./segmentPlayer";

describe("tokenAtTime", () => {
  const marks = [
    { i: 4, t: 0 },
    { i: 5, t: 0.5 },
    { i: 6, t: 1.2 },
  ];
  it("renvoie null avant le premier mark", () => {
    expect(tokenAtTime([{ i: 4, t: 0.3 }], 0.1)).toBeNull();
  });
  it("renvoie l'index du dernier mark franchi", () => {
    expect(tokenAtTime(marks, 0)).toBe(4);
    expect(tokenAtTime(marks, 0.6)).toBe(5);
    expect(tokenAtTime(marks, 5)).toBe(6);
  });
});
```

- [ ] **Step 2: Lancer le test → échec**

Run: `cd app && npx vitest run src/lib/segmentPlayer.test.ts`
Expected: FAIL — `tokenAtTime` introuvable.

- [ ] **Step 3: Ajouter le helper + le callback**

Dans `app/src/lib/segmentPlayer.ts` :

Ajouter en haut (après les imports) le helper exporté :

```ts
export function tokenAtTime(marks: { i: number; t: number }[], t: number): number | null {
  let cur: number | null = null;
  for (const m of marks) if (t >= m.t) cur = m.i;
  return cur;
}
```

Ajouter à l'interface `SegmentPlayerCallbacks` (après `onError`) :

```ts
  /** Token courant surligné (index global) pour un segment histoire, null sinon. */
  onToken: (index: number | null) => void;
```

Mettre à jour l'import ttsClient (ligne 8) :

```ts
import { synthesizeSentence, synthesizeText, TtsUnconfiguredError } from "./ttsClient";
```

- [ ] **Step 4: Chemin cloud — brancher les timepoints**

Dans `playCloud(i, r)` de `segmentPlayer.ts`, remplacer le bloc de synthèse+lecture par la version qui gère `seg.tokens` :

```ts
  async function playCloud(i: number, r: number): Promise<void> {
    const seg = segments[i];
    if (!seg) return;
    let blob: Blob;
    let marks: { i: number; t: number }[] = [];
    try {
      if (seg.tokens) {
        const out = await synthesizeSentence(seg.tokens, seg.baseTokenIndex ?? 0);
        blob = out.audio;
        marks = out.marks;
      } else {
        blob = await synthesizeText(seg.text, seg.lang);
      }
    } catch (e) {
      if (r !== run) return;
      if (e instanceof TtsUnconfiguredError) {
        mode = "speech";
        speakSegment(i, r);
        return;
      }
      cb.onError(String(e instanceof Error ? e.message : e));
      return;
    }
    if (r !== run) return;
    cleanupAudio();
    url = URL.createObjectURL(blob);
    const el = new Audio(url);
    audio = el;
    el.onended = () => afterSegment(i, r);
    el.ontimeupdate = () => {
      if (r !== run) return;
      const d = el.duration;
      if (d && isFinite(d) && d > 0) cb.onProgress(Math.min(1, el.currentTime / d));
      if (marks.length) cb.onToken(tokenAtTime(marks, el.currentTime));
    };
    try {
      await el.play();
    } catch {
      /* lecture coupée / autoplay bloqué — géré par toggle/close côté UI */
    }
  }
```

- [ ] **Step 5: Repli Web Speech — surlignage par `onboundary`**

Dans `speakSegment(i, r)`, après `const u = new SpeechSynthesisUtterance(seg.text);` et avant `u.onend = done;`, ajouter le mapping token si le segment porte des tokens :

```ts
    if (seg.tokens) {
      const offsets: number[] = [];
      let acc = 0;
      for (const t of seg.tokens) {
        offsets.push(acc);
        acc += t.length;
      }
      const base = seg.baseTokenIndex ?? 0;
      u.onboundary = (e) => {
        if (r !== run) return;
        let local = 0;
        for (let k = 0; k < offsets.length; k++) if (e.charIndex >= offsets[k]) local = k;
        cb.onToken(base + local);
      };
    }
```

- [ ] **Step 6: Effacer le surlignage au changement de segment**

Dans `playFrom(i, r)`, juste après `cb.onSegmentStart(i);` ajouter :

```ts
    if (!segments[i]?.tokens) cb.onToken(null);
```

- [ ] **Step 7: Lancer le test + build → succès**

Run: `cd app && npx vitest run src/lib/segmentPlayer.test.ts && npm run build`
Expected: test PASS ; build OK (le nouveau champ obligatoire `onToken` fera échouer le typecheck de `usePodcastPlayer` — c'est attendu, corrigé Task 4 ; si l'ordre d'exécution l'exige, ajouter temporairement `onToken: () => {}` au `createSegmentPlayer` existant, retiré en Task 4).

> Note d'exécution : pour garder le build vert entre tâches, ajouter dès maintenant `onToken: () => patch({})` n'est pas possible (patch pas encore adapté) — préférer exécuter Task 2 et Task 4 dans la même passe de commit, ou stubber `onToken: () => {}` dans `usePodcastPlayer` en Task 2 puis le câbler en Task 4.

- [ ] **Step 8: Commit**

```bash
git add app/src/lib/segmentPlayer.ts app/src/lib/segmentPlayer.test.ts
git commit -m "feat(audio): moteur segments émet le token courant (timepoints cloud + onboundary speech)"
```

---

### Task 3: Helpers purs de file — `lib/playQueue.ts`

**Files:**
- Create: `app/src/lib/playQueue.ts`
- Test: `app/src/lib/playQueue.test.ts`

**Interfaces:**
- Produces:
  - `type PlayMode = "auto" | "repeat" | "once"`
  - `type QueueItem = { kind: "lesson"; lessonId: string; title: string } | { kind: "story"; storyId: string; title: string }`
  - `reorder<T>(arr: T[], from: number, to: number): T[]`
  - `type EndAction = "advance" | "loop" | "append" | "stop"`
  - `endAction(mode: PlayMode, hasNextInQueue: boolean): EndAction`
  - `nextMode(m: PlayMode): PlayMode`

- [ ] **Step 1: Écrire les tests**

Créer `app/src/lib/playQueue.test.ts` :

```ts
import { describe, expect, it } from "vitest";
import { endAction, nextMode, reorder } from "./playQueue";

describe("reorder", () => {
  it("déplace un élément vers l'avant", () => {
    expect(reorder(["a", "b", "c"], 2, 0)).toEqual(["c", "a", "b"]);
  });
  it("déplace un élément vers l'arrière", () => {
    expect(reorder(["a", "b", "c"], 0, 2)).toEqual(["b", "c", "a"]);
  });
});

describe("endAction", () => {
  it("avance tant qu'il reste des éléments en file", () => {
    expect(endAction("once", true)).toBe("advance");
    expect(endAction("auto", true)).toBe("advance");
  });
  it("file épuisée : dépend du mode", () => {
    expect(endAction("auto", false)).toBe("append");
    expect(endAction("repeat", false)).toBe("loop");
    expect(endAction("once", false)).toBe("stop");
  });
});

describe("nextMode", () => {
  it("cycle auto → repeat → once → auto", () => {
    expect(nextMode("auto")).toBe("repeat");
    expect(nextMode("repeat")).toBe("once");
    expect(nextMode("once")).toBe("auto");
  });
});
```

- [ ] **Step 2: Lancer → échec**

Run: `cd app && npx vitest run src/lib/playQueue.test.ts`
Expected: FAIL — module introuvable.

- [ ] **Step 3: Implémenter**

Créer `app/src/lib/playQueue.ts` :

```ts
export type PlayMode = "auto" | "repeat" | "once";

export type QueueItem =
  | { kind: "lesson"; lessonId: string; title: string }
  | { kind: "story"; storyId: string; title: string };

export type EndAction = "advance" | "loop" | "append" | "stop";

export function reorder<T>(arr: T[], from: number, to: number): T[] {
  const copy = arr.slice();
  const [item] = copy.splice(from, 1);
  copy.splice(to, 0, item);
  return copy;
}

export function endAction(mode: PlayMode, hasNextInQueue: boolean): EndAction {
  if (hasNextInQueue) return "advance";
  if (mode === "repeat") return "loop";
  if (mode === "auto") return "append";
  return "stop";
}

export function nextMode(m: PlayMode): PlayMode {
  return m === "auto" ? "repeat" : m === "repeat" ? "once" : "auto";
}
```

- [ ] **Step 4: Lancer → succès**

Run: `cd app && npx vitest run src/lib/playQueue.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/playQueue.ts app/src/lib/playQueue.test.ts
git commit -m "feat(audio): helpers purs de file (reorder, transition de fin, cycle de mode)"
```

---

### Task 4: `usePodcastPlayer` — modèle de file, sources histoire, reprise, surlignage

**Files:**
- Modify: `app/src/ui/usePodcastPlayer.tsx` (réécriture ciblée de l'état + des actions ; conserver la structure refs/patch existante)
- Modify: `app/src/ui/CourseDetail.tsx` (aucun changement d'appel : `startLesson(id)` conservé)

**Interfaces:**
- Consumes: `createSegmentPlayer` (avec `onToken`), `buildStorySegments`, `getStory`, `analyze`, `allStories`, `getCurriculum`, `getPodcast`, `generatePodcastPack`, `markLessonStarted`, `getLesson`, helpers `playQueue.ts`.
- Produces (contexte `PodcastApi`, champs ajoutés) :
  - état : `queue: QueueItem[]`, `mode: PlayMode`, `currentTokenIndex: number | null`, `activeStoryId: string | null`
  - actions : `playStory(item: { storyId: string; title: string }): void`, `enqueueStory(item: { storyId: string; title: string }): void`, `reorderQueue(from: number, to: number): void`, `removeFromQueue(index: number): void`, `cycleMode(): void`
  - conservées : `startLesson`, `toggle`, `next`, `prev`, `jumpTo`, `close`, `currentTokenIndex`

- [ ] **Step 1: Étendre l'état + le type API**

Dans `usePodcastPlayer.tsx`, importer les helpers en tête :

```ts
import { allStories, getPodcast, getStory } from "../lib/db";
import { analyze } from "../lib/analyze";
import { buildStorySegments } from "../lib/storyPodcast";
import { endAction, nextMode, reorder, type PlayMode, type QueueItem } from "../lib/playQueue";
```

(fusionner l'import `db` existant `getPodcast` avec `getStory, allStories`.)

Ajouter à `interface PodcastState` :

```ts
  queue: QueueItem[];
  mode: PlayMode;
  currentTokenIndex: number | null;
  activeStoryId: string | null;
```

Ajouter à `interface PodcastApi` :

```ts
  playStory: (item: { storyId: string; title: string }) => void;
  enqueueStory: (item: { storyId: string; title: string }) => void;
  reorderQueue: (from: number, to: number) => void;
  removeFromQueue: (index: number) => void;
  cycleMode: () => void;
```

Ajouter à `INITIAL_STATE` :

```ts
  queue: [],
  mode: "auto",
  currentTokenIndex: null,
  activeStoryId: null,
```

- [ ] **Step 2: Ajouter les refs miroir et brancher `onToken`**

Après les refs existantes, ajouter :

```ts
  const queueRef = useRef<QueueItem[]>([]);
  const qIndexRef = useRef(0);
  const modeRef = useRef<PlayMode>("auto");
```

Dans `createSegmentPlayer({...})`, ajouter le callback :

```ts
      onToken: (i) => patch({ currentTokenIndex: i }),
```

Modifier `onSegmentStart` pour réinitialiser le token :

```ts
      onSegmentStart: (i) => {
        qIndexRef.current = /* inchangé : index segment courant du pack */ qIndexRef.current;
        patch({ index: i, segProgress: 0, currentTokenIndex: null });
      },
```

> `index` (dans l'état) reste l'index SEGMENT du pack courant (utilisé par la barre / tracklist). `qIndexRef` est l'index dans la FILE. Ne pas confondre les deux.

Remplacer `onEnded` pour appeler la nouvelle logique :

```ts
      onEnded: () => void handleEnded(),
```

- [ ] **Step 3: `loadItem` (généralise `loadLesson`)**

Remplacer `loadLesson` par `loadItem`. La branche leçon reprend le corps actuel de `loadLesson` (pack `getPodcast`/`generatePodcastPack`, `markLessonStarted`, `lessonIndex`/`lessonTotal`). Ajouter la branche histoire. `chainTargetRef` est supprimé (l'enchaînement passe désormais par `handleEnded`).

```ts
  const loadItem = useCallback(
    async (item: QueueItem, opts?: { resumeIndex?: number; autoplay?: boolean }) => {
      const autoplay = opts?.autoplay ?? true;
      const startIndex = opts?.resumeIndex ?? 0;
      player.halt();
      const token = ++loadTokenRef.current;
      player.resetMode();
      player.setIndex(startIndex);
      patch({
        active: true,
        playing: false,
        error: null,
        preparing: "Préparation…",
        index: startIndex,
        segProgress: 0,
        currentTokenIndex: null,
        activeStoryId: item.kind === "story" ? item.storyId : null,
      });
      try {
        if (item.kind === "lesson") {
          const lesson = await getLesson(item.lessonId);
          if (!lesson) throw new Error(`Leçon introuvable : ${item.lessonId}`);
          const order = getCurriculum();
          const idx = order.findIndex((c) => c.id === item.lessonId);
          const nextEntry = idx >= 0 ? order[idx + 1] : undefined;
          const existing = await getPodcast(item.lessonId);
          const pack =
            existing && existing.version === PACK_VERSION
              ? existing
              : await generatePodcastPack(item.lessonId, { nextLessonTitle: nextEntry?.title }, (msg) => {
                  if (token === loadTokenRef.current) patch({ preparing: msg });
                });
          if (token !== loadTokenRef.current) return;
          await markLessonStarted(item.lessonId);
          player.setSegments(pack.segments);
          const clamped = Math.min(startIndex, Math.max(0, pack.segments.length - 1));
          player.setIndex(clamped);
          patch({
            title: lesson.title,
            segments: pack.segments,
            preparing: null,
            index: clamped,
            lessonIndex: idx,
            lessonTotal: order.length,
          });
          if (autoplay) startAt(clamped);
        } else {
          const story = await getStory(item.storyId);
          if (!story) throw new Error(`Histoire introuvable : ${item.storyId}`);
          const analyzed = await analyze(story.text);
          if (token !== loadTokenRef.current) return;
          const segments = buildStorySegments(analyzed.tokens);
          player.setSegments(segments);
          const clamped = Math.min(startIndex, Math.max(0, segments.length - 1));
          player.setIndex(clamped);
          patch({
            title: item.title,
            segments,
            preparing: null,
            index: clamped,
            lessonIndex: -1,
            lessonTotal: 0,
          });
          if (autoplay) startAt(clamped);
        }
      } catch (e) {
        if (token === loadTokenRef.current) {
          if (typeof window !== "undefined") localStorage.removeItem(RESUME_KEY);
          patch({ preparing: null, playing: false, error: String(e instanceof Error ? e.message : e) });
        }
      }
    },
    [patch, player, startAt],
  );
```

- [ ] **Step 4: `playQueueIndex`, `handleEnded`, `computeNext`**

Ajouter (après `loadItem`) :

```ts
  const playQueueIndex = useCallback(
    (i: number) => {
      const q = queueRef.current;
      if (i < 0 || i >= q.length) return;
      qIndexRef.current = i;
      void loadItem(q[i], { autoplay: true });
    },
    [loadItem],
  );

  async function computeNext(last: QueueItem): Promise<QueueItem | null> {
    if (last.kind === "lesson") {
      const order = getCurriculum();
      const i = order.findIndex((c) => c.id === last.lessonId);
      const nxt = i >= 0 ? order[i + 1] : undefined;
      return nxt ? { kind: "lesson", lessonId: nxt.id, title: nxt.title } : null;
    }
    const all = await allStories();
    const i = all.findIndex((s) => s.id === last.storyId);
    const nxt = i >= 0 ? all[i + 1] : undefined;
    return nxt ? { kind: "story", storyId: nxt.id, title: nxt.titleFr ?? nxt.title } : null;
  }

  async function handleEnded(): Promise<void> {
    const q = queueRef.current;
    const idx = qIndexRef.current;
    const action = endAction(modeRef.current, idx + 1 < q.length);
    if (action === "advance") return playQueueIndex(idx + 1);
    if (action === "loop") return playQueueIndex(0);
    if (action === "stop") return patch({ playing: false });
    const next = await computeNext(q[q.length - 1]);
    if (!next) return patch({ playing: false });
    const nq = [...q, next];
    queueRef.current = nq;
    patch({ queue: nq });
    playQueueIndex(nq.length - 1);
  }
```

> `handleEnded`/`computeNext` sont des fonctions du corps du composant (pas `useCallback`) — lues via `queueRef`/`qIndexRef`/`modeRef`, donc pas de closure périmée. Le moteur ne référence `handleEnded` qu'à travers `() => void handleEnded()` dans `createSegmentPlayer`, créé une seule fois : s'assurer que `handleEnded` est défini via une ref si nécessaire (pattern `startLessonRef` existant). Utiliser le même pattern : `const endedRef = useRef(() => {}); endedRef.current = () => void handleEnded();` et `onEnded: () => endedRef.current()`.

- [ ] **Step 5: Actions publiques (playStory, enqueue, reorder, remove, cycleMode, startLesson)**

```ts
  const setQueue = useCallback((q: QueueItem[]) => {
    queueRef.current = q;
    patch({ queue: q });
  }, [patch]);

  const playStory = useCallback((item: { storyId: string; title: string }) => {
    const qi: QueueItem = { kind: "story", storyId: item.storyId, title: item.title };
    setQueue([qi]);
    qIndexRef.current = 0;
    void loadItem(qi, { autoplay: true });
  }, [loadItem, setQueue]);

  const enqueueStory = useCallback((item: { storyId: string; title: string }) => {
    const qi: QueueItem = { kind: "story", storyId: item.storyId, title: item.title };
    if (queueRef.current.length === 0) {
      playStory(item);
      return;
    }
    setQueue([...queueRef.current, qi]);
  }, [playStory, setQueue]);

  const reorderQueue = useCallback((from: number, to: number) => {
    const cur = queueRef.current[qIndexRef.current];
    const nq = reorder(queueRef.current, from, to);
    qIndexRef.current = nq.indexOf(cur);
    setQueue(nq);
  }, [setQueue]);

  const removeFromQueue = useCallback((index: number) => {
    if (index === qIndexRef.current) return;
    const nq = queueRef.current.filter((_, i) => i !== index);
    if (index < qIndexRef.current) qIndexRef.current -= 1;
    setQueue(nq);
  }, [setQueue]);

  const cycleMode = useCallback(() => {
    const m = nextMode(modeRef.current);
    modeRef.current = m;
    patch({ mode: m });
  }, [patch]);
```

Réécrire `startLesson` pour initialiser la file :

```ts
  const startLesson = useCallback((lessonId: string) => {
    void getLesson(lessonId).then((lesson) => {
      const title = lesson?.title ?? lessonId;
      const qi: QueueItem = { kind: "lesson", lessonId, title };
      setQueue([qi]);
      qIndexRef.current = 0;
      void loadItem(qi, { autoplay: true });
    });
  }, [loadItem, setQueue]);
```

Supprimer `startLessonRef`/`chainTargetRef` (remplacés).

- [ ] **Step 6: Adapter `close`, `toggle`, `seek` et la reprise**

`close` : ajouter reset file : dans `setState(INITIAL_STATE)` la file repart vide ; ajouter `queueRef.current = []; qIndexRef.current = 0;`.

`toggle`/`seek`/`next`/`prev`/`jumpTo` : inchangés (agissent sur les SEGMENTS de la piste courante via `player`). Vérifier qu'ils compilent.

Reprise (effet de montage) + sauvegarde : généraliser `RESUME_KEY` :

```ts
  // Sauvegarde
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (restoringRef.current) return;
    if (state.active && state.queue.length) {
      localStorage.setItem(
        RESUME_KEY,
        JSON.stringify({ queue: state.queue, qIndex: qIndexRef.current, index: state.index, mode: state.mode }),
      );
    } else {
      localStorage.removeItem(RESUME_KEY);
    }
  }, [state.active, state.queue, state.index, state.mode]);

  // Reprise
  useEffect(() => {
    if (typeof window === "undefined") return;
    const raw = localStorage.getItem(RESUME_KEY);
    if (!raw) return;
    try {
      const saved = JSON.parse(raw) as { queue?: QueueItem[]; qIndex?: number; index?: number; mode?: PlayMode };
      if (saved.queue?.length) {
        restoringRef.current = true;
        queueRef.current = saved.queue;
        qIndexRef.current = saved.qIndex ?? 0;
        modeRef.current = saved.mode ?? "auto";
        patch({ queue: saved.queue, mode: saved.mode ?? "auto" });
        void loadItem(saved.queue[qIndexRef.current], { resumeIndex: saved.index ?? 0, autoplay: false }).finally(() => {
          restoringRef.current = false;
        });
      }
    } catch {
      localStorage.removeItem(RESUME_KEY);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
```

Mettre à jour le miroir `mode`/`playing` : ajouter `useEffect(() => { modeRef.current = state.mode; }, [state.mode]);`

- [ ] **Step 7: Exposer les nouvelles actions dans `api`**

```ts
  const api = useMemo<PodcastApi>(
    () => ({ ...state, startLesson, playStory, enqueueStory, reorderQueue, removeFromQueue, cycleMode, toggle, next, prev, jumpTo, close }),
    [state, startLesson, playStory, enqueueStory, reorderQueue, removeFromQueue, cycleMode, toggle, next, prev, jumpTo, close],
  );
```

- [ ] **Step 8: Typecheck**

Run: `cd app && npm run build`
Expected: OK (aucune erreur TS ; `onToken` désormais fourni).

- [ ] **Step 9: Commit**

```bash
git add app/src/ui/usePodcastPlayer.tsx
git commit -m "feat(audio): file d'attente unifiée (histoires + leçons), modes de lecture, surlignage token, reprise"
```

---

### Task 5: `Reader` — brancher sur le lecteur unifié + split button

**Files:**
- Modify: `app/src/ui/Reader.tsx`

**Interfaces:**
- Consumes: `usePodcastPlayer` (`playStory`, `enqueueStory`, `activeStoryId`, `currentTokenIndex`, `playing`, `preparing`, `toggle`).
- Produces: aucun (composant UI).

- [ ] **Step 1: Remplacer le player local**

Retirer l'import `useArticlePlayer` (ligne 10 : garder `splitSentences` seulement s'il est encore utilisé — il ne l'est plus ici, retirer aussi). Retirer `useMemo` `sentences` (109) et `const player = useArticlePlayer(...)` (110).

Ajouter :

```ts
import { usePodcastPlayer } from "./usePodcastPlayer";
```

Dans le composant :

```ts
  const podcast = usePodcastPlayer();
  const isActiveStory = !!incoming.id && podcast.activeStoryId === incoming.id;
  const currentTokenIndex = isActiveStory ? podcast.currentTokenIndex : null;
```

- [ ] **Step 2: Surlignage depuis le contexte**

Remplacer `const active = i === player.currentTokenIndex;` (≈184) par :

```ts
              const active = i === currentTokenIndex;
```

- [ ] **Step 3: Bouton split (Écouter / Pause + menu file)**

Remplacer le `<Button>` audio (223-241) par le split button. Ajouter un état local `const [menuOpen, setMenuOpen] = useState(false);`.

```tsx
            <div className="relative flex items-stretch">
              <Button
                active={isActiveStory && podcast.playing}
                onClick={() => {
                  if (!incoming.id) return;
                  if (isActiveStory) podcast.toggle();
                  else podcast.playStory({ storyId: incoming.id, title: incoming.title ?? "Histoire" });
                }}
                disabled={!incoming.id || (isActiveStory && !!podcast.preparing)}
              >
                {isActiveStory && podcast.playing ? (
                  <>
                    <IconPause size={16} />
                    Pause
                  </>
                ) : (
                  <>
                    <IconPlay size={16} />
                    Écouter l'article
                  </>
                )}
              </Button>
              <Button
                size="icon"
                aria-label="Options de lecture"
                onClick={() => setMenuOpen((o) => !o)}
                disabled={!incoming.id}
              >
                <IconChevronDown size={16} />
              </Button>
              {menuOpen && incoming.id && (
                <div className="absolute left-0 top-full z-20 mt-1 rounded-sm border border-hairline bg-surface shadow">
                  <button
                    className="block w-full cursor-pointer px-3 py-2 text-left text-sm hover:bg-surface-2"
                    onClick={() => {
                      podcast.enqueueStory({ storyId: incoming.id!, title: incoming.title ?? "Histoire" });
                      setMenuOpen(false);
                    }}
                  >
                    Ajouter à la file d'attente
                  </button>
                </div>
              )}
            </div>
```

Ajouter `IconChevronDown` à l'import d'icônes (ligne 14).

- [ ] **Step 4: Retirer l'affichage d'erreur du player local**

Retirer `{player.error && ...}` (258) — les erreurs audio s'affichent désormais dans la barre. Retirer aussi la dépendance `sentences.length` du `disabled` (déjà remplacé).

- [ ] **Step 5: Typecheck + test**

Run: `cd app && npm run build && npm run test`
Expected: build OK ; tous les tests PASS (sauf `tts.test.ts` sur `useArticlePlayer` — traité Task 7 ; si présent, le supprimer maintenant est prématuré, garder pour Task 7).

- [ ] **Step 6: Commit**

```bash
git add app/src/ui/Reader.tsx
git commit -m "feat(reader): histoire jouée dans le lecteur unifié, surlignage synchronisé, menu ajouter à la file"
```

---

### Task 6: `PodcastPlayer` — file éditable (drag & drop) + bouton mode

**Files:**
- Modify: `app/src/ui/PodcastPlayer.tsx`
- Modify: `app/src/ui/kit/Icon.tsx` (ajout `IconRepeat`, `IconRepeatOne`, `IconInfinity`)

**Interfaces:**
- Consumes: `usePodcastPlayer` (`queue`, `mode`, `reorderQueue`, `removeFromQueue`, `cycleMode`, + existants).
- Produces: aucun.

- [ ] **Step 1: Ajouter les icônes de mode**

Dans `app/src/ui/kit/Icon.tsx`, ajouter trois icônes sur le modèle des existantes (même signature `IconProps`, `viewBox="0 0 24 24"`), par exemple `IconInfinity` (auto), `IconRepeat` (répétition), `IconRepeatOne` (une fois). Path SVG minimal accepté.

- [ ] **Step 2: Bouton mode dans la barre**

Dans `PodcastPlayer.tsx`, importer les icônes + définir un libellé :

```tsx
const MODE_LABEL: Record<"auto" | "repeat" | "once", string> = {
  auto: "Lecture auto",
  repeat: "Répétition",
  once: "Jouer une fois",
};
```

Ajouter, dans la rangée de contrôles (près de « Liste »), un bouton :

```tsx
          <Button size="sm" onClick={p.cycleMode} aria-label={`Mode : ${MODE_LABEL[p.mode]}`} title={MODE_LABEL[p.mode]}>
            {p.mode === "auto" ? <IconInfinity size={14} /> : p.mode === "repeat" ? <IconRepeat size={14} /> : <IconRepeatOne size={14} />}
          </Button>
```

- [ ] **Step 3: Liste de file éditable (remplace/complète la tracklist)**

Ajouter une seconde liste dépliable montrant `p.queue` (pistes, pas segments), avec drag & drop natif et bouton retirer. Conserver la tracklist par segments existante pour la piste courante. Ajouter un ref d'index de drag :

```tsx
  const dragFrom = useRef<number | null>(null);
```

Bloc liste (dans la zone `open`) :

```tsx
        {open && p.queue.length > 0 && (
          <ol className="mb-3 max-h-64 list-none overflow-y-auto rounded-sm border border-hairline">
            {p.queue.map((item, qi) => {
              const key = item.kind === "lesson" ? `l-${item.lessonId}-${qi}` : `s-${item.storyId}-${qi}`;
              const isCurrent = qi === p.queue.findIndex((_, i) => i === qi) && qi === /* index piste courante */ p.queueCurrent;
              return (
                <li
                  key={key}
                  draggable
                  onDragStart={() => (dragFrom.current = qi)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={() => {
                    if (dragFrom.current !== null && dragFrom.current !== qi) p.reorderQueue(dragFrom.current, qi);
                    dragFrom.current = null;
                  }}
                  className="flex items-center gap-2 border-b border-hairline px-3 py-2 text-sm last:border-b-0"
                >
                  <span className="cursor-grab text-muted">⠿</span>
                  <span className="min-w-0 flex-1 truncate">
                    {item.kind === "lesson" ? "🎓 " : "📖 "}
                    {item.title}
                  </span>
                  <button
                    className="cursor-pointer text-muted hover:text-accent"
                    aria-label="Retirer de la file"
                    onClick={() => p.removeFromQueue(qi)}
                  >
                    <IconClose size={14} />
                  </button>
                </li>
              );
            })}
          </ol>
        )}
```

> `p.queueCurrent` n'existe pas dans le contexte tel que défini ; exposer `queueCurrent: qIndexRef.current` n'est pas réactif. Option retenue : exposer l'index de piste courante via l'état. Ajouter en Task 4 (Step 1) le champ d'état `queueIndex: number` (mis à jour dans `playQueueIndex` et `loadItem` via `patch({ queueIndex: qIndexRef.current })`), et l'utiliser ici comme `p.queueIndex`. Corriger la ligne `isCurrent` en `const isCurrent = qi === p.queueIndex;` et surligner l'item courant (`text-accent`).

- [ ] **Step 4: Typecheck**

Run: `cd app && npm run build`
Expected: OK.

- [ ] **Step 5: Commit**

```bash
git add app/src/ui/PodcastPlayer.tsx app/src/ui/kit/Icon.tsx
git commit -m "feat(audio): barre lecteur — file éditable (drag & drop) + bouton mode de lecture"
```

> Ajustement rétroactif requis en Task 4 : ajouter `queueIndex: number` à `PodcastState`/`INITIAL_STATE` (défaut 0) et le patcher dans `playQueueIndex`, `loadItem`, `playStory`, `reorderQueue`, `removeFromQueue`. Le plan le note ici pour que l'implémenteur de Task 4 l'inclue.

---

### Task 7: Suppression de `useArticlePlayer` (orphelin) + nettoyage tests

**Files:**
- Modify: `app/src/lib/tts.ts` (retirer `useArticlePlayer`, `ArticlePlayer`, et helpers privés devenus inutilisés : `mediaSessionAvailable`, `setSpokenMediaSessionMeta`, `setMediaSessionPlaybackState`, `releaseMediaSession`, `unloadAudio` — SEULEMENT s'ils ne sont plus référencés)
- Modify: `app/src/lib/tts.test.ts` (retirer les tests couvrant `useArticlePlayer` s'il y en a ; garder ceux de `splitSentences`)

**Interfaces:** aucun ajout.

- [ ] **Step 1: Vérifier l'absence de références résiduelles**

Run: `cd app && grep -rn "useArticlePlayer\|ArticlePlayer" src/`
Expected: aucune occurrence hors `lib/tts.ts` (Reader déjà migré Task 5).

- [ ] **Step 2: Retirer `useArticlePlayer` et ses helpers privés inutilisés**

Dans `lib/tts.ts`, supprimer l'export `useArticlePlayer` et l'interface `ArticlePlayer`. Puis, pour chaque helper privé listé, vérifier qu'il n'est plus référencé (`grep -n "nomHelper" src/lib/tts.ts`) avant suppression. Conserver `speakWord`, `speakSentence`, `stopSentence`, `splitSentences`, `PlayerSentence`, `primeAudioFocus`/`nudgeAudioFocusRelease` (imports).

- [ ] **Step 3: Nettoyer les tests**

Dans `lib/tts.test.ts`, ne garder que les tests `splitSentences` (déjà présents). Retirer tout test référant `useArticlePlayer` (s'il n'y en a pas, ne rien faire).

- [ ] **Step 4: Typecheck + suite complète**

Run: `cd app && npm run build && npm run test`
Expected: build OK ; tous les tests PASS.

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/tts.ts app/src/lib/tts.test.ts
git commit -m "refactor(audio): retire useArticlePlayer (remplacé par le lecteur unifié)"
```

---

### Task 8: Vérification bout-en-bout (app réelle)

**Files:** aucun (validation).

- [ ] **Step 1: Lancer la vérification via le skill `verify`**

Utiliser le skill `verify` (vite + Playwright/Chromium headless) pour dérouler :
1. Ouvrir une histoire → « Écouter l'article » → la barre apparaît, lecture démarre, un token se surligne.
2. Le bouton n'affiche pas « Chargement… » entre les phrases.
3. Pause / retour début / navigation phrase depuis la barre fonctionnent.
4. Menu du bouton → « Ajouter à la file » : la file s'allonge sans couper la lecture.
5. Ouvrir la liste : réordonner par drag & drop, retirer un item.
6. Cliquer le bouton mode : cycle auto → répétition → une fois.
7. Naviguer ailleurs puis revenir sur l'histoire en lecture → surlignage toujours synchronisé.
8. Recharger la page → file + position restaurées (pas d'autoplay).
9. Lancer une leçon (CourseDetail) → lecture normale, enchaînement en mode auto.

- [ ] **Step 2: Corriger les écarts éventuels**

Pour chaque critère en échec, corriger dans le fichier concerné, re-tester, committer avec un message ciblé.

## Self-Review

**Spec coverage :**
- §1 modèle données → Task 1 ✓
- §2 constructeur → Task 1 ✓
- §3 moteur onToken → Task 2 ✓
- §4 file/état/reprise/modes → Task 3 (helpers) + Task 4 ✓
- §5 Reader → Task 5 ✓
- §6 barre (file éditable DnD, bouton mode) → Task 6 ✓
- Nettoyage useArticlePlayer → Task 7 ✓
- Critères de succès 1-9 → Task 8 ✓

**Type consistency :** `QueueItem`/`PlayMode` définis Task 3, consommés identiquement Task 4/5/6. `onToken(index|null)` cohérent Task 2 ↔ Task 4. `queueIndex` d'état : introduit Task 4, consommé Task 6 (noté explicitement). `activeStoryId`/`currentTokenIndex` produits Task 4, consommés Task 5.

**Placeholders :** helper `handleEnded` via ref (pattern existant) explicité ; `queueIndex` d'état explicité comme ajout Task 4. Aucun « TODO » résiduel.
