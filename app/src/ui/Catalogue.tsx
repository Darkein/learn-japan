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
import { LessonCard } from "./LessonCard";
import styles from "./Catalogue.module.css";

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
}

/** Catalogue : parcours complet (leçons) + inventaire navigable (kanji / vocab / grammaire). */
export function Catalogue({ onOpenStory }: Props) {
  const [section, setSection] = useState<Section>("lessons");
  const [level, setLevel] = useState<number>(0); // 0 = tous
  const [status, setStatus] = useState<ItemStatus | "all">("all");

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
  useEffect(() => {
    void refresh();
  }, []);

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
    <div className={styles.wrap}>
      <nav className={styles.sections}>
        {SECTIONS.map((s) => (
          <button
            key={s.id}
            aria-current={section === s.id}
            onClick={() => setSection(s.id)}
            className={styles.section}
          >
            {s.label}
          </button>
        ))}
      </nav>

      {section === "lessons" ? (
        lessons === null ? (
          <p className={styles.empty}>Chargement…</p>
        ) : (
          <ol className={styles.list}>
            {lessons.map((lesson) => (
              <LessonCard
                key={lesson.id}
                lesson={lesson}
                onOpenStory={onOpenStory}
                onChanged={() => void refresh()}
              />
            ))}
          </ol>
        )
      ) : (
        <>
          <div className={styles.filters}>
            <div className={styles.filterGroup} role="group" aria-label="Niveau JLPT">
              <button aria-pressed={level === 0} onClick={() => setLevel(0)}>
                Tous
              </button>
              {LEVELS.map((n) => (
                <button key={n} aria-pressed={level === n} onClick={() => setLevel(n)}>
                  N{n}
                </button>
              ))}
            </div>
            <div className={styles.filterGroup} role="group" aria-label="Statut">
              {STATUS_FILTERS.map((f) => (
                <button key={f.id} aria-pressed={status === f.id} onClick={() => setStatus(f.id)}>
                  {f.label}
                </button>
              ))}
            </div>
          </div>

          {statusMaps === null ? (
            <p className={styles.empty}>Chargement…</p>
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
  return (
    <span className={styles.statusTag} data-status={status}>
      <span className={styles.dot} />
      {STATUS_LABEL[status]}
    </span>
  );
}

function LevelTag({ level }: { level: number }) {
  return <span className={styles.levelTag}>N{level}</span>;
}

function InventoryRows({ section, inventory, matches, statusOf }: RowsProps) {
  if (section === "kanji") {
    const items = inventory.kanji.filter((k) => matches("kanji", k.id, k.level));
    return (
      <List count={items.length}>
        {items.slice(0, MAX_ROWS).map((k) => (
          <li key={k.id} className={styles.row}>
            <span className={styles.ja}>{k.ja}</span>
            <span className={styles.reading}>{[...k.kun, ...k.on].slice(0, 4).join("・")}</span>
            <span className={styles.fr}>{k.fr}</span>
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
          <li key={v.id} className={styles.rowVocab}>
            <span className={styles.ja}>{v.ja}</span>
            <span className={styles.reading}>{v.yomi ?? ""}</span>
            <span className={styles.fr}>{v.fr}</span>
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
        <li key={g.id} className={styles.rowGrammar}>
          <span className={styles.ja}>{g.name}</span>
          <span className={styles.fr}>
            {g.ruleFr} <em className={styles.example}>ex. {g.exampleJa}</em>
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
      <p className={styles.count}>
        {count} élément{count > 1 ? "s" : ""}
        {count > MAX_ROWS ? ` · ${MAX_ROWS} affichés` : ""}
      </p>
      {count === 0 ? (
        <p className={styles.empty}>Aucun élément pour ce filtre.</p>
      ) : (
        <ul className={styles.invList}>{children}</ul>
      )}
    </>
  );
}
