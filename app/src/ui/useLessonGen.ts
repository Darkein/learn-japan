import type { Lesson } from "../lib/lessons";
import { useGenJobs, type JobView } from "./useGenJobs";

/**
 * Vue, pour une leçon, de l'état de génération partagé (file `genJobs`). La logique réelle
 * (séquencement cours → histoire, persistance, reprise au rechargement) vit dans le contexte
 * `GenJobsProvider` ; ce hook se contente d'en projeter l'état pour une leçon donnée. Ainsi
 * la carte résumé (`LessonCard`) et le détail du cours (`CourseDetail`) reflètent le même job.
 */
export function useLessonGen(lesson: Lesson) {
  const { jobs, startLesson, addStory, retry, dismiss } = useGenJobs();
  const job: JobView | undefined = jobs[lesson.id];
  const busy = job?.status === "running";
  const error = job?.status === "error" ? (job.error ?? "Erreur de génération") : null;

  return {
    /** Job courant (état brut) ou `undefined` si aucune génération en cours/échouée. */
    job,
    busy,
    error,
    /** Avancement estimé [0, 1] de la génération courante. */
    progress: job?.progress ?? 0,
    /** Libellé d'étape (« Génération du cours… », « Génération de l'histoire… »). */
    label: job?.label ?? "",
    start: () => startLesson(lesson),
    addStory: (variant?: number) => addStory(lesson, variant),
    retry: () => retry(lesson.id),
    dismiss: () => dismiss(lesson.id),
  };
}
