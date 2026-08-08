import { useEffect, useState } from "react";
import { fitFurigana } from "../../lib/furigana";
import type { Mnemonic } from "../../lib/genParsers";
import { hasKanji } from "../../lib/kana";
import { kanjiMnemonic, vocabMnemonic } from "../../lib/mnemonics";
import { kanjiIn } from "../../lib/kanjiInfo";
import { KanjiBreakdown } from "../KanjiBreakdown";
import { Emphasis } from "../kit/Emphasis";
import { Ruby } from "../Ruby";

/**
 * Correction d'une carte du triangle : le mot complet, en grand, avec ses furigana en ruby
 * — puis de quoi l'ancrer visuellement, la décomposition en kanji et le mnémo. C'est le
 * moment d'étude de la carte : on vient de répondre, juste ou faux, et c'est là qu'on
 * regarde vraiment la forme du mot.
 */
export function WordFeedback({ word }: { word: { id: string; surface: string; reading: string } }) {
  const [mnemonic, setMnemonic] = useState<Mnemonic | undefined>(undefined);

  // Corpus statiques chargés paresseusement (≈ 660 Ko, cf. lib/mnemonics.ts). Le mnémo du
  // MOT prime ; à défaut, celui de son premier kanji — pour un mot d'un seul kanji les deux
  // se valent, pour un composé le kanji de tête reste un point d'accroche.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const m = (await vocabMnemonic(word.id)) ?? (await firstKanjiMnemonic(word.surface));
      if (!cancelled) setMnemonic(m);
    })();
    return () => {
      cancelled = true;
    };
  }, [word.id, word.surface]);

  return (
    <div className="flex w-full flex-col items-center gap-2">
      <div className="font-jp text-4xl text-text">
        <Ruby segments={fitFurigana(word.surface, word.reading)} reveal />
      </div>
      {mnemonic && (mnemonic.story || mnemonic.composition) && (
        <div className="flex w-full flex-col gap-1 rounded-sm border border-hairline p-3 text-left text-sm">
          {mnemonic.story && (
            <span>
              <span className="text-muted">Mnémo :</span>{" "}
              <span className="text-text">
                <Emphasis text={mnemonic.story} />
              </span>
            </span>
          )}
          {mnemonic.composition && (
            <span>
              <span className="text-muted">Composition :</span>{" "}
              <span className="text-text">
                <Emphasis text={mnemonic.composition} />
              </span>
            </span>
          )}
        </div>
      )}
      {hasKanji(word.surface) && (
        <div className="w-full text-left">
          <KanjiBreakdown surface={word.surface} />
        </div>
      )}
    </div>
  );
}

async function firstKanjiMnemonic(surface: string): Promise<Mnemonic | undefined> {
  const ch = kanjiIn(surface)[0];
  return ch ? kanjiMnemonic(ch) : undefined;
}
