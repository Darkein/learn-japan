import { useEffect, useRef, useState } from "react";
import { getGrammar, getVocab } from "../lib/db";
import { isMiss, type Exercise } from "../lib/exercise";
import { playSfx } from "../lib/sfx";
import { isMastered, type SrsGrade } from "../lib/srs";
import { SRS } from "../lib/config";
import { ClozeText } from "./exercise/ClozeText";
import { Badge } from "./kit/Badge";
import { Button } from "./kit/Button";
import { Card } from "./kit/Card";
import { SectionLabel } from "./kit/SectionLabel";

interface SummaryEntry {
  card: Exercise;
  /** Le nom de l'élément : sa graphie (mot) ou son nom (grammaire), quelle que soit la face
      servie par l'exercice. Absent si l'élément n'est pas en base. */
  label?: string;
  mastered: boolean;
  intervalDaysBefore: number;
  intervalDays: number;
}

interface ResultEntry {
  card: Exercise;
  grade: SrsGrade;
  daysBefore: number;
}

interface Props {
  results: ResultEntry[];
  title: string;
  onClose?: () => void;
  /** Libellé de la sortie. Fourni (le parcours : « Continuer »), elle devient le bouton
   *  principal — la suite du parcours, pas un retour en arrière. */
  closeLabel?: string;
  /** Seconde sortie à côté de « Continuer » (le parcours : « Arrêter ici »). */
  onStop?: () => void;
  stopLabel?: string;
  onRestart?: () => void;
  onReplayMissed?: (missed: Exercise[]) => void;
  /** Mention sous le titre : ce que la session a fait (ou non) à la planification. */
  note?: string;
}

/**
 * Étiquette d'ÉTAT d'un élément au bilan : ce que vaut le mot dans ta tête, jamais un
 * rouage du parcours : aucun seuil propre à l'app (ouverture de la production, étapes
 * d'une leçon) n'a de badge — il ne dit rien de ce que tu sais, seulement ce que l'app
 * autorise ensuite.
 *
 * L'INTERVALLE RETOMBÉ À ZÉRO se lit différemment selon d'où l'on vient — « nouveau »
 * pour un élément jamais stabilisé, « oublié » pour un élément qui tenait plusieurs jours
 * et qu'on vient de rater (FSRS l'a renvoyé en réapprentissage). Les confondre donnait un
 * « nouveau » sur des mots revus depuis des semaines.
 *
 * `null` = en route, sans plus : la barre raconte la progression mieux qu'un mot.
 */
export function summaryBadge(entry: {
  mastered: boolean;
  intervalDays: number;
  intervalDaysBefore: number;
}): { label: string; variant: "default" | "accent" } | null {
  if (entry.mastered) return { label: "maîtrisé", variant: "accent" };
  if (entry.intervalDays > 0) return null;
  return entry.intervalDaysBefore > 0
    ? { label: "oublié", variant: "default" }
    : { label: "nouveau", variant: "default" };
}

/**
 * Ce qui remplit le trou d'une carte à trou, pour la nommer au bilan : la forme attendue
 * dans la phrase (し pour する dans 「宿題を◯◯ます。」), la bonne particule d'un QCM, ou
 * le mot de la carte (`back` sans sa lecture entre parenthèses). Le bilan dit ce qu'on a
 * revu ; reposer la question avec son trou ne le disait pas.
 */
export function blankAnswer(card: Exercise): string {
  if (card.blankForm) return card.blankForm;
  if (card.mode === "choice") return card.choices[card.answerIndex];
  return card.back.split("（")[0];
}

/**
 * Un élément par ligne : un mot revu plusieurs fois dans la session (sous plusieurs faces)
 * n'apparaît qu'une fois, avec l'état d'AVANT la session, celui de son premier passage. Le
 * second passage partait de l'intervalle que le premier venait de poser : le compter seul
 * l'annonçait « oublié » à côté du même mot « nouveau ».
 */
export function groupResults<R extends { card: Exercise; daysBefore: number }>(results: R[]): R[] {
  const seen = new Map<string, R>();
  for (const r of results) {
    const key = `${r.card.track}:${r.card.id}`;
    if (!seen.has(key)) seen.set(key, r);
  }
  return [...seen.values()];
}

/** Le nom d'un élément au bilan : le sien, ou à défaut sa carte, trou rempli par la réponse. */
function EntryName({ entry }: { entry: Pick<SummaryEntry, "card" | "label"> }) {
  return entry.label ?? <ClozeText text={entry.card.front} fill={blankAnswer(entry.card)} />;
}

/** Bilan de fin de session (Échauffement, Exercices du lecteur) : score, maîtrise, relances. */
export function SessionSummary({
  results,
  title,
  onClose,
  closeLabel,
  onStop,
  stopLabel,
  onRestart,
  onReplayMissed,
  note,
}: Props) {
  const [summary, setSummary] = useState<SummaryEntry[] | null>(null);
  const chimed = useRef(false);

  // Fin de série : la cadence de cloches, une seule fois par bilan (garde-fou contre le
  // double montage du mode strict en dev, qui la jouerait deux fois). Le bilan s'ouvre
  // sur le clic de la dernière carte : l'audio est encore déverrouillé par ce geste.
  useEffect(() => {
    if (chimed.current) return;
    chimed.current = true;
    playSfx("complete");
  }, []);

  useEffect(() => {
    setSummary(null);
    async function loadSummary() {
      const entries: SummaryEntry[] = [];
      for (const r of groupResults(results)) {
        let fsrsCard: import("ts-fsrs").Card | undefined;
        let label: string | undefined;
        if (r.card.track === "vocab") {
          const item = await getVocab(r.card.id);
          fsrsCard = item?.card;
          label = item?.surface;
        } else {
          const item = await getGrammar(r.card.id);
          fsrsCard = item?.card;
          label = item?.name;
        }
        entries.push({
          card: r.card,
          label,
          mastered: fsrsCard ? isMastered(fsrsCard) : false,
          intervalDaysBefore: r.daysBefore,
          intervalDays: fsrsCard?.scheduled_days ?? 0,
        });
      }
      setSummary(entries);
    }
    void loadSummary();
  }, [results]);

  const missed = results.filter((r) => isMiss(r.grade));
  // Les éléments difficiles se nomment comme les lignes du bilan : une fois les éléments lus.
  const leeches = (summary ?? []).filter((e) => e.card.isLeech);
  const reviewed = groupResults(results).length;

  return (
    <Card className="flex flex-col gap-4 py-6">
      <div>
        <SectionLabel>Bilan</SectionLabel>
        <p className="font-serif text-lg text-text">
          {title} — {reviewed} élément{reviewed > 1 ? "s" : ""} revu
          {reviewed > 1 ? "s" : ""}
        </p>
        {note && <p className="m-0 text-xs text-muted">{note}</p>}
      </div>

      {leeches.length > 0 && (
        <div className="flex flex-col gap-1">
          <SectionLabel>Éléments difficiles</SectionLabel>
          <div className="flex flex-wrap gap-2">
            {leeches.map((entry) => (
              <Badge key={entry.card.key} className="font-jp">
                <EntryName entry={entry} />
              </Badge>
            ))}
          </div>
        </div>
      )}

      <div className="flex flex-col gap-2">
        <SectionLabel>Éléments revus</SectionLabel>
        {summary === null ? (
          <p className="text-sm text-muted">Calcul de la maîtrise…</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {summary.map((entry) => {
              const beforePct = Math.min(
                100,
                Math.round((entry.intervalDaysBefore / SRS.masteredIntervalDays) * 100),
              );
              const afterPct = Math.min(
                100,
                Math.round((entry.intervalDays / SRS.masteredIntervalDays) * 100),
              );
              const badge = summaryBadge(entry);
              return (
                <li key={entry.card.key} className="flex flex-col gap-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-jp text-sm text-text">
                      <EntryName entry={entry} />
                    </span>
                    <div className="flex items-center gap-1.5">
                      {entry.card.isLeech && <Badge>difficile</Badge>}
                      {badge && <Badge variant={badge.variant}>{badge.label}</Badge>}
                    </div>
                  </div>
                  <div className="relative h-1 w-full overflow-hidden rounded-full bg-hairline">
                    <div
                      className="absolute inset-y-0 left-0 rounded-l-full bg-accent/30 transition-all"
                      style={{ width: `${beforePct}%` }}
                    />
                    <div
                      className="absolute inset-y-0 left-0 rounded-l-full bg-accent transition-all"
                      style={{ width: `${afterPct}%` }}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        {onClose && closeLabel && (
          <Button variant="primary" onClick={onClose}>
            {closeLabel}
          </Button>
        )}
        {onStop && stopLabel && (
          <Button variant="ghost" onClick={onStop}>
            {stopLabel}
          </Button>
        )}
        {onRestart && (
          <Button variant={closeLabel ? "ghost" : "primary"} onClick={onRestart}>
            Recommencer
          </Button>
        )}
        {onReplayMissed && (
          <Button
            variant="ghost"
            disabled={missed.length === 0}
            onClick={() => onReplayMissed(missed.map((r) => r.card))}
          >
            Rejouer les ratés {missed.length > 0 ? `(${missed.length})` : ""}
          </Button>
        )}
        {onClose && !closeLabel && (
          <Button variant="ghost" onClick={onClose}>
            Retour
          </Button>
        )}
      </div>
    </Card>
  );
}
