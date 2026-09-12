import { useEffect, useState } from "react";
import {
  allComprehension,
  allExams,
  allGrammar,
  allReviews,
  allSrsDaily,
  allVocab,
  localDateString,
  type ComprehensionItem,
  type GrammarItem,
  type ReviewLog,
  type ExamRecord,
  type SrsDailyRecord,
  type VocabItem,
} from "../lib/db";
import { getCurriculumEntry } from "../lib/curriculum";
import { buildBulletin, type Bulletin } from "../lib/exam";
import { EXAM, SRS } from "../lib/config";
import { formatMinutes } from "../lib/time";
import { loadSettings } from "../lib/settings";
import { effectiveNewPerDay, loadTuning, type FsrsTuning } from "../lib/tuning";
import {
  accuracyKey,
  activityTotals,
  cardMaturity,
  collectCards,
  dailyWindow,
  daysBetween,
  firstActiveDay,
  perItemAccuracy,
  retentionRate,
  reviewForecast,
  reviewStreak,
  shiftDay,
  statusCounts,
  type ForecastDay,
  type ItemAccuracy,
  type StatsPeriod,
} from "../lib/stats";
import { Card } from "./kit/Card";
import { LoadingScreen } from "./kit/LoadingScreen";
import { SectionLabel } from "./kit/SectionLabel";
import { SegmentedControl } from "./kit/SegmentedControl";

/** En dessous, la précision d'un élément n'est pas significative — exclu du top des difficultés. */
const MIN_REVIEWS_FOR_ACCURACY = 4;
const WORST_ITEMS = 10;

/**
 * Période d'observation, commune à toute la page (sauf la charge à venir, qui regarde le
 * futur). Valeurs en chaîne : c'est ce que porte le groupe de bascules.
 */
const PERIODS: { value: string; label: string }[] = [
  { value: "7", label: "7 jours" },
  { value: "30", label: "30 jours" },
  { value: "all", label: "Depuis le début" },
];
const DEFAULT_PERIOD = "30";

/** Jours du détail « temps d'étude » — fixe, hors période (cf. la charge à venir, même durée). */
const RECENT_DAYS = 7;

function parsePeriod(value: string): StatsPeriod {
  return value === "all" ? "all" : Number(value);
}

interface Data {
  /** TOUT l'historique journalier : la fenêtre choisie y est découpée sans relire la base. */
  daily: SrsDailyRecord[];
  vocab: VocabItem[];
  grammar: GrammarItem[];
  comprehension: ComprehensionItem[];
  reviews: ReviewLog[];
  tuning: FsrsTuning;
  /** Copies rendues aux contrôles de fin de leçon (bulletin, lib/exam.ts). */
  exams: ExamRecord[];
}

interface ResolvedItem {
  key: string;
  label: string;
  detail?: string;
  trackFr: string;
  acc?: ItemAccuracy;
}

/** Résout un id d'élément en libellé lisible, toutes pistes confondues. */
function resolveItems(data: Data, ids: Set<string>, acc: Map<string, ItemAccuracy>): ResolvedItem[] {
  const out: ResolvedItem[] = [];
  for (const id of ids) {
    const v = data.vocab.find((x) => x.id === id);
    if (v) {
      out.push({
        key: `vocab:${id}`,
        label: v.reading && v.reading !== v.surface ? `${v.surface}（${v.reading}）` : v.surface,
        detail: v.meaning !== "—" ? v.meaning : undefined,
        trackFr: "vocabulaire",
        acc: acc.get(accuracyKey("vocab", id)),
      });
      continue;
    }
    const g = data.grammar.find((x) => x.id === id);
    if (g) {
      out.push({
        key: `grammar:${id}`,
        label: g.name,
        trackFr: "grammaire",
        acc: acc.get(accuracyKey("grammar", id)),
      });
      continue;
    }
    const c = data.comprehension.find((x) => x.id === id);
    if (c) {
      out.push({
        key: `comprehension:${id}`,
        label: c.name,
        trackFr: "compréhension",
        acc: acc.get(accuracyKey("comprehension", id)),
      });
    }
  }
  return out.sort((a, b) => (b.acc?.again ?? 0) - (a.acc?.again ?? 0));
}

/** Top des éléments à la pire précision (assez révisés pour être significatifs). */
function worstItems(data: Data, acc: Map<string, ItemAccuracy>): (ResolvedItem & { errorRate: number })[] {
  const rows: (ResolvedItem & { errorRate: number })[] = [];
  for (const [key, a] of acc) {
    if (a.total < MIN_REVIEWS_FOR_ACCURACY || a.again === 0) continue;
    const id = key.slice(key.indexOf(":") + 1);
    const resolved = resolveItems(data, new Set([id]), acc).find((r) => r.key === key);
    if (!resolved) continue;
    rows.push({ ...resolved, acc: a, errorRate: a.again / a.total });
  }
  return rows.sort((a, b) => b.errorRate - a.errorRate).slice(0, WORST_ITEMS);
}

/** Date calendaire (YYYY-MM-DD) en Date locale de midi — jamais de glissement de fuseau. */
function noon(date: string): Date {
  return new Date(`${date}T12:00:00`);
}

/** Étiquette d'un jour d'activité. */
function dayLabel(date: string, today: string): string {
  if (date === today) return "Aujourd'hui";
  if (date === shiftDay(today, -1)) return "Hier";
  return noon(date).toLocaleDateString("fr-FR", { weekday: "short", day: "numeric" });
}

function forecastLabel(day: ForecastDay, index: number): string {
  if (index === 0) return "Aujourd'hui";
  if (index === 1) return "Demain";
  return new Date(`${day.date}T12:00:00`).toLocaleDateString("fr-FR", {
    weekday: "short",
    day: "numeric",
  });
}

/** Statistiques locales : rétention, charge à venir, temps d'étude, bulletin. Sans LLM ni réseau. */
export function Stats() {
  const [data, setData] = useState<Data | null>(null);
  const [periodValue, setPeriodValue] = useState<string>(DEFAULT_PERIOD);

  async function refresh() {
    const [vocab, grammar, comprehension, reviews, daily, tuning, exams] = await Promise.all([
      allVocab(),
      allGrammar(),
      allComprehension(),
      allReviews(),
      allSrsDaily(),
      loadTuning(),
      allExams(),
    ]);
    setData({ vocab, grammar, comprehension, reviews, daily, tuning, exams });
  }

  useEffect(() => {
    void refresh();
  }, []);

  if (!data) return <LoadingScreen />;

  const now = new Date();
  const today = localDateString(now);
  const period = parsePeriod(periodValue);
  // Précision : bornée à la fenêtre, pour refléter ce qui coince EN CE MOMENT. La rétention,
  // elle, reçoit tout le log : elle a besoin du passé pour reconnaître une première exposition.
  const since = period === "all" ? -Infinity : now.getTime() - period * 86_400_000;
  const acc = perItemAccuracy(data.reviews.filter((r) => r.at >= since));
  const retention = retentionRate(data.reviews, period, now);
  const totals = activityTotals(dailyWindow(data.daily, period, today));
  // Moyenne par jour actif : le SEUL chiffre de temps comparable d'une période à l'autre —
  // un total sur 400 jours ne se compare pas à un total sur 7.
  const avgPerActiveDay = totals.activeDays > 0 ? totals.flowMs / totals.activeDays : 0;
  // Le détail jour par jour ne suit PAS la période : au-delà d'une semaine il devient une
  // forêt de barres. Sept jours suffisent à lire le rythme récent, quelle que soit la période.
  const recentDays = dailyWindow(data.daily, RECENT_DAYS, today);
  const maxFlow = Math.max(1, ...recentDays.map((d) => d.flowMs ?? 0));
  const forecast = reviewForecast(collectCards(data.vocab, data.grammar, data.comprehension), now);
  const maxLoad = Math.max(1, ...forecast.map((d) => d.count));
  const overdueToday = forecast[0]?.date === today ? forecast[0].count : 0;
  const worst = worstItems(data, acc);
  const settings = loadSettings();
  const newBase = settings.newPerDay;
  const effNew = effectiveNewPerDay(newBase, data.tuning.measuredRetention, data.tuning.backlog);
  const bulletin = buildBulletin(data.exams, (id) => getCurriculumEntry(id)?.title);

  // État courant : ce qui ne dépend d'aucune période — l'édifice, pas le chantier du moment.
  const vocabCounts = statusCounts(data.vocab);
  const grammarCounts = statusCounts(data.grammar);
  const maturity = cardMaturity(collectCards(data.vocab, data.grammar, data.comprehension));
  const maxMaturity = Math.max(1, maturity.fresh, maturity.learning, maturity.young, maturity.mature);
  const streak = reviewStreak(data.daily, settings.dailyGoal, today);
  const firstDay = firstActiveDay(data.daily, data.reviews);
  // Ancienneté inclusive : le premier jour compte pour un.
  const sinceDays = firstDay ? daysBetween(firstDay, today) + 1 : 0;

  return (
    <div className="flex flex-col gap-8">
      {/* --- État courant : aucune période ne s'y applique. --------------------------- */}
      <section className="flex flex-col gap-3">
        <SectionLabel>Où j'en suis</SectionLabel>
        <Card className="flex flex-wrap items-baseline gap-x-6 gap-y-2 text-sm">
          <Figure value={`${vocabCounts.known} / ${vocabCounts.total}`} label="mots connus" />
          <Figure
            value={`${grammarCounts.known} / ${grammarCounts.total}`}
            label="points de grammaire connus"
          />
          <Figure value={String(streak)} label={`jour${streak > 1 ? "s" : ""} de série`} />
          {firstDay && (
            <Figure value={String(sinceDays)} label={`jour${sinceDays > 1 ? "s" : ""} depuis le début`} />
          )}
        </Card>
      </section>

      <section className="flex flex-col gap-3">
        <SectionLabel>Maturité des cartes</SectionLabel>
        {maturity.total === 0 ? (
          <p className="text-sm text-muted">
            Aucune carte pour l'instant — elles apparaissent dès la première leçon travaillée.
          </p>
        ) : (
          <>
            <div className="flex flex-col gap-1.5">
              <BarRow label="Neuves" value={String(maturity.fresh)} ratio={maturity.fresh / maxMaturity} labelClass="w-36" />
              <BarRow label="Apprentissage" value={String(maturity.learning)} ratio={maturity.learning / maxMaturity} labelClass="w-36" />
              <BarRow
                label={`Jeunes (< ${SRS.masteredIntervalDays} j)`}
                value={String(maturity.young)}
                ratio={maturity.young / maxMaturity}
                labelClass="w-36"
              />
              <BarRow
                label={`Mûres (≥ ${SRS.masteredIntervalDays} j)`}
                value={String(maturity.mature)}
                ratio={maturity.mature / maxMaturity}
                labelClass="w-36"
              />
            </div>
            {/* Plus de cartes que de mots : un mot en porte une par compétence travaillée. */}
            <p className="text-xs text-muted">
              {maturity.total} carte{maturity.total > 1 ? "s" : ""} au total — un mot en porte une
              par compétence (écrit, écoute, production){" · "}
              {Math.round((maturity.mature / maturity.total) * 100)}% mûres
            </p>
          </>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <SectionLabel>Temps d'étude ({RECENT_DAYS} derniers jours)</SectionLabel>
        {recentDays.every((d) => !d.flowMs) ? (
          <p className="text-sm text-muted">
            Pas de temps mesuré ces jours-ci — le flux d'étude (bouton « Commencer » de
            l'accueil) compte tes minutes.
          </p>
        ) : (
          <div className="flex flex-col gap-1.5">
            {recentDays.map((d) => (
              <BarRow
                key={d.date}
                label={dayLabel(d.date, today)}
                value={d.flowMs ? formatMinutes(d.flowMs) : "—"}
                ratio={(d.flowMs ?? 0) / maxFlow}
              />
            ))}
          </div>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <SectionLabel>Charge des 7 prochains jours</SectionLabel>
        {overdueToday > 0 && (
          <p className="text-sm text-muted">
            Le jour « Aujourd'hui » inclut les cartes en retard.
          </p>
        )}
        <div className="flex flex-col gap-1.5">
          {forecast.map((d, i) => (
            <BarRow
              key={d.date}
              label={forecastLabel(d, i)}
              value={String(d.count)}
              ratio={d.count / maxLoad}
            />
          ))}
        </div>
      </section>

      {bulletin.rows.length > 0 && <BulletinSection bulletin={bulletin} />}

      {/* --- Sur une période : une seule bascule commande tout ce qui suit — deux périodes
              affichées côte à côte ne se compareraient pas. ------------------------------ */}
      <div className="flex flex-col gap-8 border-t border-hairline pt-8">
        <div className="flex flex-wrap items-center gap-3">
          <SegmentedControl
            ariaLabel="Période"
            options={PERIODS}
            value={periodValue}
            onChange={setPeriodValue}
          />
          <span className="text-xs text-muted">période des trois sections ci-dessous</span>
        </div>

        <section className="flex flex-col gap-3">
          <SectionLabel>Rétention</SectionLabel>
          {retention.rate === null ? (
            <p className="text-sm text-muted">
              Pas encore assez de révisions pour mesurer la rétention — reviens après quelques sessions.
            </p>
          ) : (
            <Card className="flex items-baseline gap-4">
              <span className="font-serif text-4xl text-text">{Math.round(retention.rate * 100)}%</span>
              <span className="text-sm text-muted">
                {retention.correct} / {retention.total} révisions réussies (premières expositions exclues)
              </span>
            </Card>
          )}
          {/* Auto-réglage : cible de rétention et débit de nouveautés ajustés selon les erreurs. */}
          <p className="text-xs text-muted">
            Réglage auto — cible de rétention&nbsp;: {Math.round(data.tuning.requestRetention * 100)}%
            {" · "}nouveautés&nbsp;: {effNew}/j{effNew < newBase ? ` (au lieu de ${newBase}, retard/erreurs)` : ""}
          </p>
        </section>

        <section className="flex flex-col gap-3">
          <SectionLabel>Activité</SectionLabel>
          <Card className="flex flex-wrap items-baseline gap-x-6 gap-y-2 text-sm">
            <Figure value={formatMinutes(totals.flowMs)} label="d'étude" />
            <Figure value={String(totals.reviewed)} label={`révision${totals.reviewed > 1 ? "s" : ""}`} />
            <Figure
              value={String(totals.introduced)}
              label={`nouveau${totals.introduced > 1 ? "x" : ""} mot${totals.introduced > 1 ? "s" : ""}`}
            />
            <Figure
              value={String(totals.storiesRead)}
              label={`histoire${totals.storiesRead > 1 ? "s" : ""} lue${totals.storiesRead > 1 ? "s" : ""}`}
            />
            <Figure
              value={`${totals.activeDays} / ${totals.days}`}
              label={`jour${totals.activeDays > 1 ? "s" : ""} actif${totals.activeDays > 1 ? "s" : ""}`}
            />
          </Card>
          {/* La moyenne rend deux périodes comparables, ce qu'un total ne fait pas. */}
          <p className="text-xs text-muted">
            {totals.activeDays > 0
              ? `Par jour actif : ${formatMinutes(avgPerActiveDay)} d'étude · ${Math.round(totals.reviewed / totals.activeDays)} révisions`
              : "Aucun jour d'activité sur cette période."}
          </p>
        </section>

        <section className="flex flex-col gap-3">
          <SectionLabel>Précision la plus faible</SectionLabel>
          {worst.length === 0 ? (
            <p className="text-sm text-muted">Rien à signaler pour l'instant.</p>
          ) : (
            <div className="flex flex-col gap-1.5">
              {worst.map((item) => (
                <div key={item.key} className="flex items-baseline justify-between gap-4 text-sm">
                  <span className="min-w-0 truncate">
                    <span className="font-jp text-text">{item.label}</span>
                    {item.detail && <span className="text-muted"> — {item.detail}</span>}
                  </span>
                  <span className="shrink-0 text-muted">
                    {Math.round((1 - item.errorRate) * 100)}% ({item.acc!.total} rév.)
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

/** Rangée « libellé — barre — valeur », le motif commun des trois listes de la page. */
function BarRow({
  label,
  value,
  ratio,
  labelClass = "w-24",
}: {
  label: string;
  value: string;
  /** Part de la plus grande valeur de la liste, entre 0 et 1. */
  ratio: number;
  labelClass?: string;
}) {
  return (
    <div className="flex items-center gap-3 text-sm">
      <span className={`${labelClass} shrink-0 truncate text-muted`}>{label}</span>
      <div className="h-3 grow rounded-sm bg-bg">
        <div className="h-full rounded-sm bg-accent" style={{ width: `${ratio * 100}%` }} />
      </div>
      <span className="w-16 shrink-0 text-right text-text">{value}</span>
    </div>
  );
}

/** Chiffre du résumé d'activité : la valeur en avant, son libellé en second. */
function Figure({ value, label }: { value: string; label: string }) {
  return (
    <span className="flex items-baseline gap-1.5">
      <span className="font-serif text-xl text-text">{value}</span>
      <span className="text-muted">{label}</span>
    </span>
  );
}

/**
 * Bulletin — relevé des contrôles de fin de leçon (le 関所). Une ligne par leçon présentée,
 * avec sa MEILLEURE note : repasser un contrôle peut faire monter la moyenne, jamais la
 * faire baisser. La moyenne générale compte chaque leçon une fois, comme un bulletin.
 */
function BulletinSection({ bulletin }: { bulletin: Bulletin }) {
  return (
    <section className="flex flex-col gap-3">
      <SectionLabel>Bulletin — contrôles de fin de leçon</SectionLabel>
      <Card className="flex items-baseline gap-4">
        <span className="font-serif text-4xl text-text">{bulletin.average}</span>
        <span className="font-serif text-xl text-muted">/ 20</span>
        <span className="text-sm text-muted">
          moyenne générale sur {bulletin.rows.length} leçon{bulletin.rows.length > 1 ? "s" : ""}
          {" · "}
          {bulletin.passedCount} admise{bulletin.passedCount > 1 ? "s" : ""}
        </span>
      </Card>
      <div className="flex flex-col gap-1.5">
        {bulletin.rows.map((row) => (
          <div key={row.lessonId} className="flex items-baseline justify-between gap-4 text-sm">
            <span className="min-w-0 truncate">
              <span className="text-text">{row.title}</span>
              {row.attempts > 1 && (
                <span className="text-muted"> — {row.attempts} tentatives</span>
              )}
            </span>
            <span
              className={`shrink-0 ${row.note >= EXAM.passMark ? "text-accent-2" : "text-accent"}`}
            >
              {row.note}/20 <span className="text-muted">{row.mention}</span>
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}
