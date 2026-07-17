import { useEffect, useState } from "react";
import {
  allComprehension,
  allGrammar,
  allReviews,
  allVocab,
  localDateString,
  putComprehensionItem,
  putGrammar,
  putVocab,
  recentSrsDaily,
  type ComprehensionItem,
  type GrammarItem,
  type ReviewLog,
  type Skill,
  type SrsDailyRecord,
  type VocabItem,
} from "../lib/db";
import { formatMinutes } from "../lib/time";
import { newCard } from "../lib/srs";
import { loadSettings } from "../lib/settings";
import { effectiveNewPerDay, loadTuning, type FsrsTuning } from "../lib/tuning";
import {
  accuracyKey,
  collectCards,
  leechIds,
  perItemAccuracy,
  retentionRate,
  reviewForecast,
  type ForecastDay,
  type ItemAccuracy,
} from "../lib/stats";
import { Button } from "./kit/Button";
import { Card } from "./kit/Card";
import { LoadingScreen } from "./kit/LoadingScreen";
import { SectionLabel } from "./kit/SectionLabel";

const RETENTION_WINDOW_DAYS = 30;
/** En dessous, la précision d'un élément n'est pas significative — exclu du top des difficultés. */
const MIN_REVIEWS_FOR_ACCURACY = 4;
const WORST_ITEMS = 10;

interface Data {
  daily: SrsDailyRecord[];
  vocab: VocabItem[];
  grammar: GrammarItem[];
  comprehension: ComprehensionItem[];
  reviews: ReviewLog[];
  tuning: FsrsTuning;
}

interface ResolvedItem {
  key: string;
  label: string;
  detail?: string;
  trackFr: string;
  acc?: ItemAccuracy;
}

/** Résout un id de leech/précision en libellé lisible, toutes pistes confondues. */
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

function studyDayLabel(date: string, index: number, total: number): string {
  if (index === total - 1) return "Aujourd'hui";
  if (index === total - 2) return "Hier";
  return new Date(`${date}T12:00:00`).toLocaleDateString("fr-FR", {
    weekday: "short",
    day: "numeric",
  });
}

function forecastLabel(day: ForecastDay, index: number): string {
  if (index === 0) return "Aujourd'hui";
  if (index === 1) return "Demain";
  return new Date(`${day.date}T12:00:00`).toLocaleDateString("fr-FR", {
    weekday: "short",
    day: "numeric",
  });
}

/** Statistiques locales : rétention, charge à venir, éléments difficiles. Sans LLM ni réseau. */
export function Stats() {
  const [data, setData] = useState<Data | null>(null);

  async function refresh() {
    const [vocab, grammar, comprehension, reviews, daily, tuning] = await Promise.all([
      allVocab(),
      allGrammar(),
      allComprehension(),
      allReviews(),
      recentSrsDaily(7),
      loadTuning(),
    ]);
    setData({ vocab, grammar, comprehension, reviews, daily, tuning });
  }

  useEffect(() => {
    void refresh();
  }, []);

  /** Remet l'élément à zéro : cartes FSRS neuves, il repart en apprentissage. */
  async function resetItem(item: ResolvedItem) {
    if (!data) return;
    const now = new Date();
    const [track, id] = [item.key.slice(0, item.key.indexOf(":")), item.key.slice(item.key.indexOf(":") + 1)];
    if (track === "vocab") {
      const v = data.vocab.find((x) => x.id === id);
      if (v) {
        for (const skill of Object.keys(v.cards) as Skill[]) v.cards[skill] = newCard(now);
        v.status = "review";
        await putVocab(v);
      }
    } else if (track === "grammar") {
      const g = data.grammar.find((x) => x.id === id);
      if (g?.card) {
        g.card = newCard(now);
        await putGrammar(g);
      }
    } else {
      const c = data.comprehension.find((x) => x.id === id);
      if (c?.card) {
        c.card = newCard(now);
        await putComprehensionItem(c);
      }
    }
    void refresh();
  }

  if (!data) return <LoadingScreen />;

  const now = new Date();
  const acc = perItemAccuracy(data.reviews);
  const retention = retentionRate(data.reviews, RETENTION_WINDOW_DAYS, now);
  const forecast = reviewForecast(collectCards(data.vocab, data.grammar, data.comprehension), now);
  const maxLoad = Math.max(1, ...forecast.map((d) => d.count));
  const overdueToday = forecast[0]?.date === localDateString(now) ? forecast[0].count : 0;
  const leeches = resolveItems(data, leechIds(data.reviews), acc);
  const worst = worstItems(data, acc);
  const newBase = loadSettings().newPerDay;
  const effNew = effectiveNewPerDay(newBase, data.tuning.measuredRetention, data.tuning.backlog);

  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-3">
        <SectionLabel>Rétention ({RETENTION_WINDOW_DAYS} derniers jours)</SectionLabel>
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
        <SectionLabel>Charge des 7 prochains jours</SectionLabel>
        {overdueToday > 0 && (
          <p className="text-sm text-muted">
            Le jour « Aujourd'hui » inclut les cartes en retard.
          </p>
        )}
        <div className="flex flex-col gap-1.5">
          {forecast.map((d, i) => (
            <div key={d.date} className="flex items-center gap-3 text-sm">
              <span className="w-24 shrink-0 text-muted">{forecastLabel(d, i)}</span>
              <div className="h-3 grow rounded-sm bg-bg">
                <div
                  className="h-full rounded-sm bg-accent"
                  style={{ width: `${(d.count / maxLoad) * 100}%` }}
                />
              </div>
              <span className="w-8 shrink-0 text-right text-text">{d.count}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <SectionLabel>Temps d'étude (7 derniers jours)</SectionLabel>
        {data.daily.every((d) => !d.flowMs) ? (
          <p className="text-sm text-muted">
            Pas encore de temps mesuré — le flux d'étude (bouton « Commencer » de l'accueil)
            compte tes minutes.
          </p>
        ) : (
          <div className="flex flex-col gap-1.5">
            {data.daily.map((d, i) => {
              const maxMs = Math.max(1, ...data.daily.map((x) => x.flowMs ?? 0));
              const ms = d.flowMs ?? 0;
              return (
                <div key={d.date} className="flex items-center gap-3 text-sm">
                  <span className="w-24 shrink-0 text-muted">{studyDayLabel(d.date, i, data.daily.length)}</span>
                  <div className="h-3 grow rounded-sm bg-bg">
                    <div
                      className="h-full rounded-sm bg-accent"
                      style={{ width: `${(ms / maxMs) * 100}%` }}
                    />
                  </div>
                  <span className="w-16 shrink-0 text-right text-text">
                    {ms > 0 ? formatMinutes(ms) : "—"}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <SectionLabel>Éléments difficiles (leeches)</SectionLabel>
        {leeches.length === 0 ? (
          <p className="text-sm text-muted">Aucun élément en difficulté — continue comme ça.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {leeches.map((item) => (
              <Card key={item.key} className="flex items-center justify-between gap-4">
                <div className="flex flex-col">
                  <span className="font-jp text-lg text-text">{item.label}</span>
                  <span className="text-xs text-muted">
                    {item.detail ? `${item.detail} · ` : ""}
                    {item.trackFr}
                    {item.acc ? ` · ${item.acc.again} échec${item.acc.again > 1 ? "s" : ""} / ${item.acc.total}` : ""}
                  </span>
                </div>
                <Button variant="ghost" className="shrink-0" onClick={() => void resetItem(item)}>
                  Réinitialiser
                </Button>
              </Card>
            ))}
          </div>
        )}
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
  );
}
