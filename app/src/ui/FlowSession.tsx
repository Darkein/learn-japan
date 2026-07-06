import { useEffect, useRef, useState } from "react";
import { getSrsDaily, getStory, localDateString } from "../lib/db";
import { gatherFlowState, pickNext, type FlowActivity } from "../lib/flow";
import { checkOmikuji } from "../lib/omikuji";
import { getLesson, markLessonStarted, type Lesson } from "../lib/lessons";
import { markMirrorDone, runMirrorDelta } from "../lib/mirror";
import { markStationCelebrated, tokaidoStatus, type RouteArrival } from "../lib/tokaido";
import { MirrorDeltaView } from "./MirrorDelta";
import { formatMinutes } from "../lib/time";
import { FlowCheckpoint, type FlowBlockResult } from "./FlowCheckpoint";
import { OmikujiSheet } from "./OmikujiSheet";
import { incomingFromStory, Reader, type IncomingStory } from "./Reader";
import { ReviewSession } from "./ReviewSession";
import { StationArrival } from "./StationArrival";
import { Markdown } from "./LessonMarkdown";
import { Button } from "./kit/Button";
import { Card } from "./kit/Card";
import { SectionLabel } from "./kit/SectionLabel";
import { useFlowClock } from "./useFlowClock";
import { useSettings } from "./useSettings";

type Phase =
  | { name: "loading" }
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

  useEffect(() => {
    void (async () => {
      const { state } = await gatherFlowState();
      reviewedAtBlockStart.current = state.reviewedToday;
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    // Le défi omikuji peut venir d'être accompli par ce bloc : on l'évalue AVANT le
    // Tōkaidō pour que le bonus éventuel soit crédité dans la position lue juste après.
    const omikuji = await checkOmikuji();
    const { state, lessons } = await gatherFlowState(finished.kind);
    const recap = await recapFor(finished, reviewedAtBlockStart.current, omikuji?.completedNow ?? false);
    if (mirrorExtra) recap.extra = mirrorExtra;
    // Une arrivée de station se fête au checkpoint (la progression vient d'être créditée).
    const tokaido = await tokaidoStatus(lessons);
    if (tokaido.newlyArrived) setArrival(tokaido.newlyArrived);
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
          <h2 className="m-0 font-serif text-xl">Flux d'étude</h2>
          {flowMs > 0 && (
            <span className="text-xs text-muted">{formatMinutes(flowMs)} aujourd'hui</span>
          )}
        </div>
        <Button variant="quiet" onClick={onExit}>
          Terminer
        </Button>
      </header>

      {phase.name === "loading" && <p className="text-muted">Un instant…</p>}

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
  if (activity.kind === "review" || activity.kind === "reinforce") {
    const daily = await getSrsDaily(localDateString());
    const delta = Math.max(0, (daily?.reviewed ?? 0) - reviewedBefore);
    return {
      kind: activity.kind,
      recap:
        (delta > 0
          ? `${delta} révision${delta > 1 ? "s" : ""} faite${delta > 1 ? "s" : ""} — ${daily?.reviewed ?? 0} aujourd'hui.`
          : "Bloc de révision terminé.") + suffix,
    };
  }
  if (activity.kind === "read-story" || activity.kind === "mirror") {
    return { kind: activity.kind, recap: "Histoire lue — chaque page recroise tes acquis." + suffix };
  }
  if (activity.kind === "lesson") {
    return { kind: activity.kind, recap: "Leçon découverte — ses mots arrivent en révision." + suffix };
  }
  if (activity.kind === "omikuji") {
    return { kind: activity.kind, recap: "Fortune tirée — le défi du jour est lancé." };
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
  if (activity.kind === "review" || activity.kind === "reinforce") {
    return <ReviewSession opts={{ scope: "due" }} onExit={onDone} />;
  }
  if (activity.kind === "read-story" || activity.kind === "mirror") {
    return <StoryBlock storyId={activity.refId} onDone={onDone} />;
  }
  if (activity.kind === "lesson") {
    return <LessonBlock lessonId={activity.refId} furigana={furigana} onDone={onDone} />;
  }
  if (activity.kind === "omikuji") {
    return <OmikujiSheet onClose={onDone} />;
  }
  return null;
}

function StoryBlock({ storyId, onDone }: { storyId?: string; onDone: () => void }) {
  const [incoming, setIncoming] = useState<IncomingStory | null>(null);
  useEffect(() => {
    if (!storyId) return;
    void getStory(storyId).then((s) => s && setIncoming(incomingFromStory(s)));
  }, [storyId]);

  if (!storyId) return null;
  if (!incoming) return <p className="text-muted">Chargement…</p>;
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
  useEffect(() => {
    if (!lessonId) return;
    void getLesson(lessonId).then((l) => l && setLesson(l));
  }, [lessonId]);

  if (!lessonId) return null;
  if (!lesson) return <p className="text-muted">Chargement…</p>;

  async function finish() {
    await markLessonStarted(lessonId!);
    onDone();
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <SectionLabel>Leçon{lesson.level ? ` · N${lesson.level}` : ""}</SectionLabel>
        <p className="m-0 font-serif text-lg text-text">{lesson.title}</p>
      </div>
      {lesson.framing ? (
        <Markdown text={lesson.framing} reveal={furigana} />
      ) : (
        <Card className="py-4">
          <p className="m-0 text-sm text-muted">
            Le cours de cette leçon n'est pas encore généré — ouvre la page de la leçon pour
            lancer la génération, puis reviens dans le flux.
          </p>
        </Card>
      )}
      <Button variant="primary" className="self-start" onClick={() => void finish()}>
        Leçon lue — continuer
      </Button>
    </div>
  );
}
