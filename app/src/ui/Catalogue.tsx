import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  allGrammar,
  allKanji,
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

const STATUS_FILTERS: { id: ItemStatus | "all"; label: string }[] = [
  { id: "all", label: "Tous" },
  { id: "known", label: "Connus" },
  { id: "review", label: "À revoir" },
  { id: "unknown", label: "Pas vus" },
];

const LEVELS = [5, 4, 3, 2, 1];
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
    kanji: Map<string, ItemStatus>;
    vocab: Map<string, ItemStatus>;
    grammar: Map<string, ItemStatus>;
  } | null>(null);

  async function refresh() {
    const [ls, ks, vs, gs] = await Promise.all([listLessons(), allKanji(), allVocab(), allGrammar()]);
    setLessons(ls);
    setStatusMaps({
      kanji: new Map(ks.map((k) => [k.id, k.status])),
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

  function statusOf(track: "kanji" | "vocab" | "grammar", id: string): ItemStatus {
    return statusMaps?.[track].get(id) ?? "unknown";
  }

  function matches(track: "kanji" | "vocab" | "grammar", id: string, lvl: number): boolean {
    if (level !== 0 && lvl !== level) return false;
    if (status !== "all" && statusOf(track, id) !== status) return false;
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
            <div
              className="inline-flex overflow-hidden rounded-sm border border-hairline"
              role="group"
              aria-label="Niveau JLPT"
            >
              <button
                className="cursor-pointer border-l border-hairline px-3 py-1 text-xs tracking-wide text-muted first:border-l-0 aria-pressed:bg-surface-2 aria-pressed:text-text"
                aria-pressed={level === 0}
                onClick={() => setLevel(0)}
              >
                Tous
              </button>
              {LEVELS.map((n) => (
                <button
                  key={n}
                  className="cursor-pointer border-l border-hairline px-3 py-1 text-xs tracking-wide text-muted first:border-l-0 aria-pressed:bg-surface-2 aria-pressed:text-text"
                  aria-pressed={level === n}
                  onClick={() => setLevel(n)}
                >
                  N{n}
                </button>
              ))}
            </div>
            <div
              className="inline-flex overflow-hidden rounded-sm border border-hairline"
              role="group"
              aria-label="Statut"
            >
              {STATUS_FILTERS.map((f) => (
                <button
                  key={f.id}
                  className="cursor-pointer border-l border-hairline px-3 py-1 text-xs tracking-wide text-muted first:border-l-0 aria-pressed:bg-surface-2 aria-pressed:text-text"
                  aria-pressed={status === f.id}
                  onClick={() => setStatus(f.id)}
                >
                  {f.label}
                </button>
              ))}
            </div>
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
  statusOf: (track: "kanji" | "vocab" | "grammar", id: string) => ItemStatus;
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

function LevelTag({ level }: { level: number }) {
  return (
    <span className="justify-self-end rounded-sm border border-hairline px-2 text-xs text-muted">
      N{level}
    </span>
  );
}

function InventoryRows({ section, inventory, matches, statusOf }: RowsProps) {
  if (section === "kanji") {
    const items = inventory.kanji.filter((k) => matches("kanji", k.id, k.level));
    return (
      <List count={items.length}>
        {items.slice(0, MAX_ROWS).map((k) => (
          <li
            key={k.id}
            className="grid grid-cols-[2.5rem_1fr_1.5fr_auto_auto] items-baseline gap-3 border-t border-hairline py-2 last:border-b"
          >
            <span className="font-jp text-lg text-text">{k.ja}</span>
            <span className="font-jp text-sm text-muted">
              {[...k.kun, ...k.on].slice(0, 4).join("・")}
            </span>
            <span className="font-sans text-sm text-text">{k.fr}</span>
            <LevelTag level={k.level} />
            <StatusTag status={statusOf("kanji", k.id)} />
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
            className="grid grid-cols-[7rem_6rem_1fr_auto_auto] items-baseline gap-3 border-t border-hairline py-2 last:border-b"
          >
            <span className="font-jp text-lg text-text">{v.ja}</span>
            <span className="font-jp text-sm text-muted">{v.yomi ?? ""}</span>
            <span className="font-sans text-sm text-text">{v.fr}</span>
            <LevelTag level={v.level} />
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
          className="grid grid-cols-[1fr_2fr_auto_auto] items-baseline gap-3 border-t border-hairline py-2 last:border-b"
        >
          <span className="font-jp text-lg text-text">{g.name}</span>
          <span className="font-sans text-sm text-text">
            {g.ruleFr} <em className="text-muted">ex. {g.exampleJa}</em>
          </span>
          <LevelTag level={g.level} />
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
