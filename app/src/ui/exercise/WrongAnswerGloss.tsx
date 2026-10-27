import { useEffect, useState } from "react";
import { lookupAnswerGloss, type AnswerGloss } from "../../lib/answerGloss";
import { hasJapanese } from "../../lib/kana";

/**
 * Sens de la réponse fausse, sous la correction : « ねこ veut dire « chat » » pour un mot
 * japonais, « « chat » se dit 猫（ねこ） » pour un sens français. Rien si on ne connaît
 * pas la réponse, ni si elle a le même sens que la bonne (`meaning`) — ce ne serait
 * alors pas une autre traduction à apprendre.
 */
export function WrongAnswerGloss({ answer, meaning }: { answer: string; meaning?: string }) {
  const [gloss, setGloss] = useState<AnswerGloss | null>(null);

  useEffect(() => {
    let cancelled = false;
    setGloss(null);
    void lookupAnswerGloss(answer).then((g) => {
      if (!cancelled) setGloss(g);
    });
    return () => {
      cancelled = true;
    };
  }, [answer]);

  if (!gloss || (meaning && gloss.fr === meaning)) return null;

  const word = (
    <span className="font-jp text-text">
      {gloss.ja}
      {gloss.reading && `（${gloss.reading}）`}
    </span>
  );
  return (
    <div className="text-sm text-muted">
      {hasJapanese(answer) ? (
        <>
          {word} veut dire <span className="text-text">« {gloss.fr} »</span>
        </>
      ) : (
        <>
          <span className="text-text">« {answer.trim()} »</span> se dit {word}
        </>
      )}
    </div>
  );
}
