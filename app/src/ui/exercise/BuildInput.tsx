import { useMemo, useState } from "react";
import { isCorrectOrder, shuffleTiles, type Tile } from "../../lib/builder";
import { isAcceptableOrder } from "../../lib/buildOrders";
import { translateExampleFr, type BuildExercise } from "../../lib/exercise";
import type { SrsGrade } from "../../lib/srs";
import { Button } from "../kit/Button";
import { GradeButtons } from "./GradeButtons";
import { SentenceFeedback } from "./SentenceFeedback";

interface Props {
  exercise: BuildExercise;
  onGraded: (grade: SrsGrade) => void;
  onNext: () => void;
}

/**
 * Construction de phrase : l'utilisateur réordonne des tuiles, vérification explicite. La
 * note est différée au choix Bien/Facile (réponse correcte) ou Continuer (ratée) — comme
 * TypeInput — au lieu de toujours noter "good" : voir le commentaire de ChoiceInput.
 */
type BuildResult = "exact" | "alt" | "wrong";

export function BuildInput({ exercise: ex, onGraded, onNext }: Props) {
  const [placed, setPlaced] = useState<Tile[]>([]);
  const [checked, setChecked] = useState<BuildResult | null>(null);
  const shuffled = useMemo(() => shuffleTiles(ex.target), [ex]);

  const placedKeys = new Set(placed.map((t) => t.key));
  function place(tile: Tile) {
    if (checked !== null) return;
    setPlaced((p) => [...p, tile]);
  }
  function unplace(tile: Tile) {
    if (checked !== null) return;
    setPlaced((p) => p.filter((t) => t.key !== tile.key));
  }
  function checkBuild() {
    const tiles = placed.map((t) => t.tile);
    if (isCorrectOrder(tiles, ex.target)) setChecked("exact");
    else if (isAcceptableOrder(tiles, ex.tokens)) setChecked("alt");
    else setChecked("wrong");
  }

  return (
    <>
      {ex.front && <p className="text-text">{ex.front}</p>}
      {!ex.audioOnly && ex.contextFr && ex.front !== ex.contextFr && (
        <p className="m-0 text-sm text-muted">« {ex.contextFr} »</p>
      )}
      <div className="flex min-h-12 w-full flex-wrap items-center justify-center gap-2 rounded-sm border border-dashed border-hairline p-2">
        {placed.length === 0 && <span className="text-sm text-muted">Compose la phrase…</span>}
        {placed.map((t) => (
          <button
            key={t.key}
            className="min-h-11 cursor-pointer rounded-sm border border-accent bg-bg px-3 py-1.5 font-jp text-lg text-text disabled:cursor-default"
            onClick={() => unplace(t)}
            disabled={checked !== null}
          >
            {t.tile}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap justify-center gap-2">
        {shuffled.map((t) => (
          <button
            key={t.key}
            className="min-h-11 cursor-pointer rounded-sm border border-hairline-strong bg-bg px-3 py-1.5 font-jp text-lg text-text transition-colors hover:border-accent disabled:cursor-default disabled:border-hairline disabled:text-muted"
            onClick={() => place(t)}
            disabled={placedKeys.has(t.key) || checked !== null}
          >
            {t.tile}
          </button>
        ))}
      </div>
      {checked === null ? (
        <Button variant="primary" onClick={checkBuild} disabled={placed.length === 0}>
          Vérifier
        </Button>
      ) : checked !== "wrong" ? (
        <>
          <div className="text-sm text-accent-2">✓ Correct</div>
          {checked === "alt" && (
            <div className="text-sm text-muted">
              Autre ordre valide — ordre du texte : <span className="font-jp">{ex.target.join(" ")}</span>
            </div>
          )}
          <SentenceFeedback
            tokens={ex.tokens}
            fr={ex.contextFr}
            onTranslate={() => translateExampleFr(ex.target.join(""), ex)}
          />
          <GradeButtons onGraded={onGraded} onNext={onNext} />
        </>
      ) : (
        <>
          <div className="text-sm text-accent">✗ Ordre attendu : {ex.target.join(" ")}</div>
          <SentenceFeedback
            tokens={ex.tokens}
            fr={ex.contextFr}
            onTranslate={() => translateExampleFr(ex.target.join(""), ex)}
          />
          <Button
            variant="primary"
            onClick={() => {
              onGraded("again");
              onNext();
            }}
          >
            Continuer
          </Button>
        </>
      )}
    </>
  );
}
