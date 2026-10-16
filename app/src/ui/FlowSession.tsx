import { useCallback, useEffect, useRef, useState } from "react";
import { getSrsDaily, getStory, localDateString } from "../lib/db";
import { gatherFlowState, pickNext, type FlowActivity } from "../lib/flow";
import { checkOmikuji } from "../lib/omikuji";
import { startLessonJob } from "../lib/genJobs";
import { getLesson, markLessonCourseRead, markStepDone, type Lesson } from "../lib/lessons";
import { STEP_LABEL } from "../lib/path";
import { markMirrorDone, runMirrorDelta } from "../lib/mirror";
import { markStationCelebrated, tokaidoStatus, type RouteArrival } from "../lib/tokaido";
import { MirrorDeltaView } from "./MirrorDelta";
import { claimOmikujiAutoOpen, OmikujiSheet } from "./OmikujiSheet";
import { formatMinutes } from "../lib/time";
import { FlowCheckpoint, type FlowBlockResult } from "./FlowCheckpoint";
import { incomingFromStory, Reader, type IncomingStory } from "./Reader";
import { ReviewSession } from "./ReviewSession";
import { ExamSession } from "./exam/ExamSession";
import { GenProgress } from "./GenProgress";
import { useLessonGen } from "./useLessonGen";
import { StationArrival } from "./StationArrival";
import { LessonObjectives } from "./LessonObjectives";
import { Markdown } from "./LessonMarkdown";
import { Button } from "./kit/Button";
import { Card } from "./kit/Card";
import { LoadingScreen } from "./kit/LoadingScreen";
import { SectionLabel } from "./kit/SectionLabel";
import { useFlowClock } from "./useFlowClock";
import { useSettings } from "./useSettings";

type Phase =
  | { name: "loading" }
  // Bandelette du jour pas encore vue (entrée directe par la notification) : on la
  // présente avant tout, et le premier bloc n'est choisi qu'une fois refermée.
  | { name: "omikuji" }
  | { name: "activity"; activity: FlowActivity }
  | { name: "checkpoint"; result: FlowBlockResult | null; next: FlowActivity };

interface Props {
  onExit: () => void;
  /** Activité imposée à l'entrée (ex. "miroir" depuis la carte de l'accueil). */
  forced?: string;
}

/**
 * Session de flux continu : enchaîne les activités choisies par le moteur (lib/flow.ts),
 * avec un checkpoint entre chaque bloc (récap + une suggestion + sortie). ReviewSession et
 * Reader sont embarqués tels quels — l'orchestration vit au-dessus.
 */
export function FlowSession({ onExit, forced }: Props) {
  const { settings } = useSettings();
  const flowMs = useFlowClock();
  const [phase, setPhase] = useState<Phase>({ name: "loading" });
  const [arrival, setArrival] = useState<RouteArrival | null>(null);
  // Révisions du jour au début du bloc courant → « 12 révisions faites » au checkpoint.
  const reviewedAtBlockStart = useRef(0);
  // Contexte de la séance : une relecture-miroir au plus. État de séance UI, jamais persisté.
  const flowCtx = useRef({ mirrorDoneThisFlow: false });

  // Réservation de l'ouverture auto mémorisée : un effet rejoué (StrictMode) doit relire la
  // même réponse, pas re-réserver — il obtiendrait `false` et lancerait le flux par-dessus.
  const omikujiClaim = useRef<Promise<boolean> | null>(null);

  useEffect(() => {
    omikujiClaim.current ??= claimOmikujiAutoOpen();
    void omikujiClaim.current.then((open) => {
      if (open) setPhase({ name: "omikuji" });
      else start();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function start() {
    setPhase({ name: "loading" });
    void (async () => {
      const [{ state }, daily] = await Promise.all([gatherFlowState(), getSrsDaily(localDateString())]);
      reviewedAtBlockStart.current = daily?.reviewed ?? 0;
      // Entrée forcée depuis une carte de l'accueil (ex. relecture-miroir).
      const first =
        forced === "miroir" && state.mirrorCandidate
          ? {
              kind: "mirror" as const,
              refId: state.mirrorCandidate.storyId,
              title: `Relecture-miroir — ${state.mirrorCandidate.title}`,
              reason: "",
            }
          : pickNext(state);
      setPhase(
        first.kind === "done"
          ? { name: "checkpoint", result: null, next: first }
          : { name: "activity", activity: first },
      );
    })();
  }

  async function toCheckpoint(finished: FlowActivity) {
    setPhase({ name: "loading" });
    // Après une relecture-miroir : calcule le delta (à l'époque / aujourd'hui) et
    // déclenche le refroidissement de 14 jours AVANT de re-collecter l'état.
    let mirrorExtra: FlowBlockResult["extra"];
    if (finished.kind === "mirror" && finished.refId) {
      const story = await getStory(finished.refId);
      if (story) {
        const delta = await runMirrorDelta(story);
        mirrorExtra = <MirrorDeltaView delta={delta} storyCreatedAt={story.createdAt} />;
      }
      await markMirrorDone();
    }
    // Le défi omikuji (tiré au lancement de l'app, hors du flux) peut venir d'être accompli
    // par ce bloc : on l'évalue AVANT le Tōkaidō pour que le bonus éventuel soit crédité
    // dans la position lue juste après.
    // L'étape finie est VALIDÉE avant de relire l'état : le parcours avance d'un cran. Le
    // contrôle, lui, se valide par son admission (lib/lessons.ts), pas par sa remise.
    if (finished.step && finished.lessonId && finished.step !== "exam") {
      await markStepDone(finished.lessonId, finished.step);
    }
    const omikuji = await checkOmikuji();
    if (finished.kind === "mirror") flowCtx.current.mirrorDoneThisFlow = true;
    const { state, lessons } = await gatherFlowState({
      lastActivity: finished.kind,
      ...flowCtx.current,
    });
    const recap = await recapFor(
      finished,
      reviewedAtBlockStart.current,
      omikuji?.completedNow ?? false,
    );
    if (mirrorExtra) recap.extra = mirrorExtra;
    // Une arrivée de station se fête au checkpoint (la progression vient d'être créditée).
    const tokaido = await tokaidoStatus(lessons);
    if (tokaido.newlyArrived) setArrival(tokaido.newlyArrived);
    // Une leçon s'ouvre : on prépare déjà la suivante (cours, première histoire), pour
    // qu'enchaîner deux leçons dans la soirée ne fasse jamais attendre (SPEC §5.1).
    if (finished.step === "course" && finished.lessonId) {
      const i = lessons.findIndex((l) => l.id === finished.lessonId);
      const following = i >= 0 ? lessons[i + 1] : undefined;
      if (following?.state === "to-generate") void startLessonJob(following);
    }
    setPhase({ name: "checkpoint", result: recap, next: pickNext(state) });
  }

  function startNext(next: FlowActivity) {
    void getSrsDaily(localDateString()).then((d) => {
      reviewedAtBlockStart.current = d?.reviewed ?? 0;
    });
    setPhase({ name: "activity", activity: next });
  }

  return (
    <div className="flex flex-col gap-6">
      <header className="flex items-baseline justify-between gap-4 border-b border-hairline pb-4">
        <div className="flex items-baseline gap-3">
          <h2 className="m-0 font-serif text-xl">Parcours</h2>
          {flowMs > 0 && (
            <span className="text-xs text-muted">{formatMinutes(flowMs)} aujourd'hui</span>
          )}
        </div>
        <Button variant="quiet" onClick={onExit}>
          Arrêter
        </Button>
      </header>

      {phase.name === "loading" && <p className="text-muted">Un instant…</p>}

      {phase.name === "omikuji" && <OmikujiSheet onClose={start} />}

      {phase.name === "activity" && (
        <ActivityBlock
          activity={phase.activity}
          furigana={settings.furiganaDefault}
          onDone={() => void toCheckpoint(phase.activity)}
        />
      )}

      {phase.name === "checkpoint" && (
        <FlowCheckpoint
          result={phase.result}
          next={phase.next}
          onContinue={() => startNext(phase.next)}
          onExit={onExit}
        />
      )}

      {arrival && (
        <StationArrival
          arrival={arrival}
          onClose={() => {
            void markStationCelebrated(arrival.route.level, arrival.station.index);
            setArrival(null);
          }}
        />
      )}
    </div>
  );
}

async function recapFor(
  activity: FlowActivity,
  reviewedBefore: number,
  omikujiDone: boolean,
): Promise<FlowBlockResult> {
  const suffix = omikujiDone ? " Omikuji accompli — un peu de chemin gagné sur la route." : "";
  const daily = await getSrsDaily(localDateString());
  const answered = Math.max(0, (daily?.reviewed ?? 0) - reviewedBefore);
  const answers = answered > 0 ? ` — ${answered} réponse${answered > 1 ? "s" : ""}.` : ".";
  if (activity.kind === "exam") {
    return { kind: activity.kind, recap: "Copie rendue — la note est dans la page de la leçon." + suffix };
  }
  if (activity.kind === "mirror") {
    return { kind: activity.kind, recap: "Histoire relue — chaque page recroise tes acquis." + suffix };
  }
  if (activity.step) {
    return { kind: activity.kind, recap: `Étape validée : ${STEP_LABEL[activity.step]}${answers}` + suffix };
  }
  if (activity.kind === "review") {
    return { kind: activity.kind, recap: `Révision faite${answers}` + suffix };
  }
  return { kind: activity.kind };
}

// ---- Rendu d'un bloc d'activité ------------------------------------------------

function ActivityBlock({
  activity,
  furigana,
  onDone,
}: {
  activity: FlowActivity;
  furigana: boolean;
  onDone: () => void;
}) {
  switch (activity.kind) {
    case "review":
      return <ReviewSession opts={{ scope: "due", itemIds: activity.itemIds }} onExit={onDone} exitLabel="Continuer" />;
    case "vocab":
    case "grammar":
    case "produce":
      return (
        <ReviewSession
          key={`${activity.lessonId}:${activity.kind}`}
          opts={{ scope: "step", lessonId: activity.lessonId, step: activity.kind }}
          onExit={onDone}
          exitLabel="Continuer"
        />
      );
    case "read-story":
      return activity.lessonId ? (
        <StoryStep lessonId={activity.lessonId} storyId={activity.refId} onDone={onDone} />
      ) : null;
    case "mirror":
      return <StoryBlock storyId={activity.refId} onDone={onDone} />;
    case "lesson":
      return <LessonBlock lessonId={activity.refId} furigana={furigana} onDone={onDone} />;
    case "exam":
      // Le contrôle vit dans le flux comme les autres blocs : il porte son en-tête de copie
      // et sa correction, et rend la main au checkpoint une fois la copie rendue.
      return activity.refId ? <ExamSession lessonId={activity.refId} onExit={onDone} /> : null;
    default:
      return null;
  }
}

/**
 * L'étape Histoire : la première histoire de la leçon jamais ouverte (à défaut, la première
 * de toutes). Une leçon sans histoire en reçoit une ICI — téléchargée si elle est
 * pré-générée, générée sinon — plutôt que de renvoyer l'utilisateur hors du parcours.
 */
function StoryStep({ lessonId, storyId, onDone }: { lessonId: string; storyId?: string; onDone: () => void }) {
  const [lesson, setLesson] = useState<Lesson | null>(null);
  const reload = useCallback(async () => {
    const l = await getLesson(lessonId);
    if (l) setLesson(l);
  }, [lessonId]);
  useEffect(() => {
    void reload();
  }, [reload]);

  if (!lesson) return <LoadingScreen />;
  const id = storyId && storyId !== lessonId ? storyId : lesson.stories[0]?.id;
  if (id) return <StoryBlock storyId={id} onDone={onDone} />;
  return <StoryGeneration lesson={lesson} onReload={reload} />;
}

function StoryGeneration({ lesson, onReload }: { lesson: Lesson; onReload: () => Promise<void> }) {
  const { busy, error, progress, label, addStory, retry } = useLessonGen(lesson);
  useEffect(() => {
    if (!busy && !error) addStory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lesson.id]);
  // Génération terminée → l'histoire est en base : on recharge la leçon pour la lire.
  const wasBusy = useRef(false);
  useEffect(() => {
    if (wasBusy.current && !busy) void onReload();
    wasBusy.current = busy;
  }, [busy, onReload]);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <SectionLabel>Histoire</SectionLabel>
        <p className="m-0 font-serif text-lg text-text">{lesson.title}</p>
      </div>
      {busy && <GenProgress label={label} progress={progress} />}
      {!busy && (
        <Card className="py-4">
          <p className="m-0 text-sm text-muted">
            {error
              ? "L'histoire de cette leçon n'a pas pu être préparée (hors ligne ?)."
              : "Préparation de l'histoire de la leçon…"}
          </p>
          {error && (
            <button className="mt-2 cursor-pointer text-sm underline" onClick={() => retry()}>
              Réessayer
            </button>
          )}
        </Card>
      )}
    </div>
  );
}

function StoryBlock({ storyId, onDone }: { storyId?: string; onDone: () => void }) {
  const [incoming, setIncoming] = useState<IncomingStory | null>(null);
  useEffect(() => {
    if (!storyId) return;
    void getStory(storyId).then((s) => s && setIncoming(incomingFromStory(s)));
  }, [storyId]);

  if (!storyId) return null;
  if (!incoming) return <LoadingScreen />;
  return (
    <div className="flex flex-col gap-6">
      {incoming.title && (
        <div>
          <SectionLabel>Lecture</SectionLabel>
          <p className="m-0 font-serif text-lg text-text">{incoming.title}</p>
        </div>
      )}
      <Reader incoming={incoming} />
      <Button variant="ghost" className="self-start" onClick={onDone}>
        J'ai fini ma lecture
      </Button>
    </div>
  );
}

function LessonBlock({
  lessonId,
  furigana,
  onDone,
}: {
  lessonId?: string;
  furigana: boolean;
  onDone: () => void;
}) {
  const [lesson, setLesson] = useState<Lesson | null>(null);
  const reload = useCallback(async () => {
    if (!lessonId) return;
    const l = await getLesson(lessonId);
    if (l) setLesson(l);
  }, [lessonId]);
  useEffect(() => {
    void reload();
  }, [reload]);

  if (!lessonId) return null;
  if (!lesson) return <LoadingScreen />;
  return <LessonCourse lesson={lesson} furigana={furigana} onReload={reload} onDone={onDone} />;
}

/**
 * Le bloc « Leçon » du flux : le cours, puis « Leçon lue ». Le cours peut manquer (leçon
 * devenue courante sans passer par sa page, contenu pré-généré non matérialisé) — on le
 * génère ICI plutôt que de renvoyer l'utilisateur hors du flux.
 */
function LessonCourse({
  lesson,
  furigana,
  onReload,
  onDone,
}: {
  lesson: Lesson;
  furigana: boolean;
  onReload: () => Promise<void>;
  onDone: () => void;
}) {
  const { busy, error, progress, label, start, retry } = useLessonGen(lesson);
  const missing = !lesson.framing;
  useEffect(() => {
    if (missing && !busy && !error) start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lesson.id, missing]);
  // Génération terminée → le cadrage est en base : on recharge la leçon pour l'afficher.
  const wasBusy = useRef(false);
  useEffect(() => {
    if (wasBusy.current && !busy) void onReload();
    wasBusy.current = busy;
  }, [busy, onReload]);

  async function finish() {
    // `markLessonCourseRead` et non `markLessonStarted` : c'est ce jalon qui atteste que la
    // leçon a été ENSEIGNÉE — le flux ne re-proposera pas son cours, et son contrôle peut
    // s'ouvrir une fois une histoire lue (voir lib/flow.ts).
    await markLessonCourseRead(lesson.id);
    onDone();
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <SectionLabel>Leçon{lesson.level ? ` · N${lesson.level}` : ""}</SectionLabel>
        <p className="m-0 font-serif text-lg text-text">{lesson.title}</p>
      </div>
      {/* La matière de la leçon AVANT son cadrage, comme sur sa page : sans elle, on
          découvrait les mots dans les exercices sans les avoir jamais vus posés. Elle vient
          de l'inventaire, donc elle tient même quand le cadrage manque (hors-ligne). */}
      <LessonObjectives lesson={lesson} />
      {lesson.framing && <Markdown text={lesson.framing} reveal={furigana} />}
      {missing && busy && <GenProgress label={label} progress={progress} />}
      {missing && !busy && (
        <Card className="py-4">
          <p className="m-0 text-sm text-muted">
            {error
              ? "Le cours de cette leçon n'a pas pu être généré (hors ligne ?)."
              : "Le cours de cette leçon n'est pas encore disponible."}{" "}
            Sa page en montre la matière (mots, règles) sans génération.
          </p>
          {/* `retry` relance le job en erreur ; sans job (rien n'a pu démarrer), on en crée un. */}
          <button
            className="mt-2 cursor-pointer text-sm underline"
            onClick={() => (error ? retry() : start())}
          >
            Réessayer
          </button>
        </Card>
      )}
      <Button variant="primary" className="self-start" onClick={() => void finish()}>
        Leçon lue — continuer
      </Button>
    </div>
  );
}
