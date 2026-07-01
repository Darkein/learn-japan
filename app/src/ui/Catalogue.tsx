import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  allGrammar,
  allVocab,
  type ItemStatus,
  type StoryRecord,
} from "../lib/db";
import {
  allGrammarInv,
  allKanjiInv,
  allVocabInv,
} from "../lib/inventory";
import { listLessons, type Lesson } from "../lib/lessons";
import { Badge } from "./kit/Badge";
import { SegmentedControl } from "./kit/SegmentedControl";
import { LessonList } from "./LessonList";
import { useGenJobs } from "./useGenJobs";

type Section = "lessons" | "kanji" | "vocab" | "grammar";

const SECTIONS: { id: Section; label: string }[] = [
  { id: "lessons", label: "Leçons" },
  { id: "kanji", label: "Kanji" },
  { id: "vocab", label: "Vocabulaire" },
  { id: "grammar", label: "Grammaire" },
];

const STATUS_LABEL: Record<ItemStatus, string> = {
  unknown: "pas vu",
  review: "à revoir",
  known: "connu",
};

const STATUS_FILTERS: { value: ItemStatus | "all"; label: string }[] = [
  { value: "all", label: "Tous" },
  { value: "known", label: "Connus" },
  { value: "review", label: "À revoir" },
  { value: "unknown", label: "Pas vus" },
];

const LEVELS = [5, 4, 3, 2, 1];
const LEVEL_OPTIONS: { value: number; label: string }[] = [
  { value: 0, label: "Tous" },
  ...LEVELS.map((n) => ({ value: n, label: `N${n}` })),
];
const MAX_ROWS = 400;

interface Props {
  onOpenStory: (story: StoryRecord) => void;
  onOpenCourse: (lesson: Lesson) => void;
}

/** Catalogue : parcours complet (leçons) + inventaire navigable (kanji / vocab / grammaire). */
export function Catalogue({ onOpenStory, onOpenCourse }: Props) {
  const [section, setSection] = useState<Section>("lessons");
  const [level, setLevel] = useState<number>(0); // 0 = tous
  const [status, setStatus] = useState<ItemStatus | "all">("all");
  const { dataVersion } = useGenJobs();

  const [lessons, setLessons] = useState<Lesson[] | null>(null);
  const [statusMaps, setStatusMaps] = useState<{
    vocab: Map<string, ItemStatus>;
    grammar: Map<string, ItemStatus>;
  } | null>(null);

  async function refresh() {
    const [ls, vs, gs] = await Promise.all([listLessons(), allVocab(), allGrammar()]);
    setLessons(ls);
    setStatusMaps({
      vocab: new Map(vs.map((v) => [v.id, v.status])),
      grammar: new Map(gs.map((g) => [g.id, g.status])),
    });
  }
  // Se recharge au montage et dès qu'une génération aboutit (dataVersion change).
  useEffect(() => {
    void refresh();
  }, [dataVersion]);

  const inventory = useMemo(() => ({
    kanji: allKanjiInv(),
    vocab: allVocabInv(),
    grammar: allGrammarInv(),
  }), []);

  function statusOf(track: "vocab" | "grammar", id: string): ItemStatus {
    return statusMaps?.[track].get(id) ?? "unknown";
  }

  function matches(track: "kanji" | "vocab" | "grammar", id: string, lvl: number): boolean {
    if (level !== 0 && lvl !== level) return false;
    if (track !== "kanji" && status !== "all" && statusOf(track as "vocab" | "grammar", id) !== status) return false;
    return true;
  }

  return (
    <div className="flex flex-col gap-6">
      <nav className="flex flex-wrap gap-4 border-b border-hairline pb-2">
        {SECTIONS.map((s) => (
          <button
            key={s.id}
            aria-current={section === s.id}
            onClick={() => setSection(s.id)}
            className="cursor-pointer border-b-2 border-transparent py-1 font-sans text-sm tracking-wide text-muted aria-[current=true]:border-accent aria-[current=true]:text-text"
          >
            {s.label}
          </button>
        ))}
      </nav>

      {section === "lessons" ? (
        lessons === null ? (
          <p className="text-muted">Chargement…</p>
        ) : (
          <LessonList
            lessons={lessons}
            split
            onOpenStory={onOpenStory}
            onOpenCourse={onOpenCourse}
          />
        )
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-4">
            <SegmentedControl
              ariaLabel="Niveau JLPT"
              options={LEVEL_OPTIONS}
              value={level}
              onChange={setLevel}
            />
            <SegmentedControl
              ariaLabel="Statut"
              options={STATUS_FILTERS}
              value={status}
              onChange={setStatus}
            />
          </div>

          {statusMaps === null ? (
            <p className="text-muted">Chargement…</p>
          ) : (
            <InventoryRows
              section={section}
              inventory={inventory}
              matches={matches}
              statusOf={statusOf}
            />
          )}
        </>
      )}
    </div>
  );
}

interface RowsProps {
  section: "kanji" | "vocab" | "grammar";
  inventory: {
    kanji: ReturnType<typeof allKanjiInv>;
    vocab: ReturnType<typeof allVocabInv>;
    grammar: ReturnType<typeof allGrammarInv>;
  };
  matches: (track: "kanji" | "vocab" | "grammar", id: string, lvl: number) => boolean;
  statusOf: (track: "vocab" | "grammar", id: string) => ItemStatus;
}

function StatusTag({ status }: { status: ItemStatus }) {
  const dot =
    status === "unknown"
      ? "bg-state-unknown"
      : status === "review"
        ? "bg-state-review"
        : "bg-accent-2";
  return (
    <span className="inline-flex items-center justify-self-end gap-2 whitespace-nowrap text-xs tracking-wide text-muted">
      <span className={`h-2 w-2 rounded-full border border-transparent ${dot}`} />
      {STATUS_LABEL[status]}
    </span>
  );
}

function LevelTag({ level, className = "" }: { level: number; className?: string }) {
  return <Badge className={className}>N{level}</Badge>;
}

function InventoryRows({ section, inventory, matches, statusOf }: RowsProps) {
  if (section === "kanji") {
    const items = inventory.kanji.filter((k) => matches("kanji", k.id, k.level));
    return (
      <List count={items.length}>
        {items.slice(0, MAX_ROWS).map((k) => (
          <li
            key={k.id}
            className="flex flex-col gap-1 border-t border-hairline py-3 last:border-b sm:grid sm:grid-cols-[2.5rem_1fr_1.5fr_auto] sm:items-baseline sm:gap-3 sm:py-2"
          >
            <span className="flex items-baseline gap-3 sm:contents">
              <span className="font-jp text-lg text-text">{k.ja}</span>
              <LevelTag level={k.level} className="ml-auto sm:order-4 sm:ml-0 sm:justify-self-end" />
            </span>
            <span className="font-jp text-sm text-muted">
              {[...k.kun, ...k.on].slice(0, 4).join("・")}
            </span>
            <span className="font-sans text-sm text-text">{k.fr}</span>
          </li>
        ))}
      </List>
    );
  }
  if (section === "vocab") {
    const items = inventory.vocab.filter((v) => matches("vocab", v.id, v.level));
    return (
      <List count={items.length}>
        {items.slice(0, MAX_ROWS).map((v) => (
          <li
            key={v.id}
            className="flex flex-col gap-1 border-t border-hairline py-3 last:border-b min-[60rem]:grid min-[60rem]:grid-cols-[7rem_6rem_1fr_auto_auto] min-[60rem]:items-baseline min-[60rem]:gap-3 min-[60rem]:py-2"
          >
            <span className="flex items-baseline gap-3 min-[60rem]:contents">
              <span className="font-jp text-lg text-text">{v.ja}</span>
              <LevelTag level={v.level} className="ml-auto min-[60rem]:order-4 min-[60rem]:ml-0 min-[60rem]:justify-self-end" />
            </span>
            <span className="font-jp text-sm text-muted">{v.yomi ?? ""}</span>
            <span className="font-sans text-sm text-text">{v.fr}</span>
            <StatusTag status={statusOf("vocab", v.id)} />
          </li>
        ))}
      </List>
    );
  }
  const items = inventory.grammar.filter((g) => matches("grammar", g.id, g.level));
  return (
    <List count={items.length}>
      {items.slice(0, MAX_ROWS).map((g) => (
        <li
          key={g.id}
          className="flex flex-col gap-1 border-t border-hairline py-3 last:border-b min-[60rem]:grid min-[60rem]:grid-cols-[1fr_2fr_auto_auto] min-[60rem]:items-baseline min-[60rem]:gap-3 min-[60rem]:py-2"
        >
          <span className="flex items-baseline gap-3 min-[60rem]:contents">
            <span className="font-jp text-lg text-text">{g.name}</span>
            <LevelTag level={g.level} className="ml-auto min-[60rem]:order-4 min-[60rem]:ml-0 min-[60rem]:justify-self-end" />
          </span>
          <span className="font-sans text-sm text-text">
            {g.ruleFr} <em className="text-muted">ex. {g.exampleJa}</em>
          </span>
          <StatusTag status={statusOf("grammar", g.id)} />
        </li>
      ))}
    </List>
  );
}

function List({ count, children }: { count: number; children: ReactNode }) {
  return (
    <>
      <p className="m-0 text-xs uppercase tracking-wider text-muted">
        {count} élément{count > 1 ? "s" : ""}
        {count > MAX_ROWS ? ` · ${MAX_ROWS} affichés` : ""}
      </p>
      {count === 0 ? (
        <p className="text-muted">Aucun élément pour ce filtre.</p>
      ) : (
        <ul className="flex list-none flex-col">{children}</ul>
      )}
    </>
  );
}
