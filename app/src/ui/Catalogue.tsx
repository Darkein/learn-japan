import { useEffect, useMemo, useState } from "react";
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
  type InvVocab,
} from "../lib/inventory";
import { listLessons, type Lesson } from "../lib/lessons";
import { SegmentedControl } from "./kit/SegmentedControl";
import { InventoryRows } from "./CatalogueInventory";
import { KanjiSheet } from "./KanjiSheet";
import { LessonList } from "./LessonList";
import { useGenJobs } from "./useGenJobs";
import { VocabPeekSheet } from "./VocabPeekSheet";

type Section = "lessons" | "kanji" | "vocab" | "grammar";

const SECTIONS: { id: Section; label: string }[] = [
  { id: "lessons", label: "Leçons" },
  { id: "kanji", label: "Kanji" },
  { id: "vocab", label: "Vocabulaire" },
  { id: "grammar", label: "Grammaire" },
];

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
  const [kanjiOpen, setKanjiOpen] = useState<string | null>(null);
  const [vocabOpen, setVocabOpen] = useState<InvVocab | null>(null);
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
              onOpenKanji={setKanjiOpen}
              onOpenVocab={setVocabOpen}
            />
          )}
        </>
      )}

      {vocabOpen && (
        <VocabPeekSheet
          v={vocabOpen}
          status={statusOf("vocab", vocabOpen.id)}
          onOpenKanji={setKanjiOpen}
          onClose={() => setVocabOpen(null)}
        />
      )}
      {/* Fiche kanji rendue après la fiche mot → empilée au-dessus (même z-50).
          À la fermeture, refresh() : des mots ont pu être ajoutés « à revoir ». */}
      {kanjiOpen && (
        <KanjiSheet
          ch={kanjiOpen}
          excludeVocabId={vocabOpen?.id}
          onClose={() => {
            setKanjiOpen(null);
            void refresh();
          }}
        />
      )}
    </div>
  );
}
