// Navigation référentielle dans UNE feuille : mot → kanji → mot lié → kanji… Chaque tap
// empile une vue, la rangée « ← Retour à … » dépile — jamais de modales superposées.
// `useRefStack` porte la pile ; `RefStackView` rend la vue du dessus avec sa rangée retour ;
// `RefSheet` enveloppe le tout dans une BottomSheet pour l'ouverture directe depuis
// l'inventaire du Catalogue (racine kanji ou mot). WordSheet (lecteur) réutilise la pile
// au-dessus de SA vue racine (le token du texte).

import { useState } from "react";
import type { ItemStatus } from "../lib/db";
import type { InvVocab } from "../lib/inventory";
import { BottomSheet } from "./BottomSheet";
import { KanjiDetail } from "./KanjiDetail";
import { VocabPeekDetail } from "./VocabPeekDetail";

export type RefView =
  | { kind: "kanji"; ch: string }
  | { kind: "vocab"; v: InvVocab; status: ItemStatus };

/** Libellé court d'une vue : ce qu'affiche la rangée retour vers elle. */
export function refLabel(view: RefView): string {
  return view.kind === "kanji" ? view.ch : view.v.ja;
}

/** Libellé accessible de la feuille quand cette vue est au-dessus. */
export function refAria(view: RefView): string {
  return view.kind === "kanji" ? `Fiche du kanji ${view.ch}` : `Fiche du mot ${view.v.ja}`;
}

export function useRefStack(initial: RefView[] = []) {
  const [stack, setStack] = useState<RefView[]>(initial);
  return {
    stack,
    top: stack.length > 0 ? stack[stack.length - 1] : null,
    /** Vue sous le dessus (destination du retour), null si le retour mène à la racine hôte. */
    below: stack.length > 1 ? stack[stack.length - 2] : null,
    push: (view: RefView) => setStack((s) => [...s, view]),
    back: () => setStack((s) => s.slice(0, -1)),
    /** Clé de remise à zéro du scroll de la feuille : change à chaque push/pop. */
    key: String(stack.length),
  };
}

export function BackRow({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      className="flex min-h-11 cursor-pointer items-center gap-2 self-start text-sm text-muted transition-colors hover:text-text"
      onClick={onClick}
    >
      ← Retour à <span className="font-jp text-text">{label}</span>
    </button>
  );
}

/**
 * Vue du dessus de la pile. `rootVocabId` : id du mot racine de l'hôte (token du lecteur,
 * mot de l'inventaire) — exclu des mots liés d'une fiche kanji ouverte directement dessus.
 */
export function RefStackView({
  view,
  below,
  rootVocabId,
  onPush,
}: {
  view: RefView;
  below: RefView | null;
  rootVocabId?: string;
  onPush: (view: RefView) => void;
}) {
  if (view.kind === "kanji") {
    // On arrive toujours à un kanji depuis un mot (le mot racine, ou une fiche mot empilée) :
    // ce mot a déjà sa fiche juste dessous, inutile de le relister.
    const from = below?.kind === "vocab" ? below.v.id : below ? undefined : rootVocabId;
    return (
      <KanjiDetail
        ch={view.ch}
        excludeVocabId={from}
        onOpenVocab={(v, status) => onPush({ kind: "vocab", v, status })}
      />
    );
  }
  return (
    <VocabPeekDetail
      v={view.v}
      status={view.status}
      onOpenKanji={(ch) => onPush({ kind: "kanji", ch })}
    />
  );
}

/** Feuille référentielle ouverte directement sur un kanji ou un mot (inventaire du Catalogue). */
export function RefSheet({ root, onClose }: { root: RefView; onClose: () => void }) {
  const nav = useRefStack([root]);
  // La pile n'est jamais vide (la racine n'a pas de retour) — `top` est garanti.
  const top = nav.top ?? root;
  return (
    <BottomSheet onClose={onClose} resetKey={nav.key} ariaLabel={refAria(top)}>
      {nav.below && <BackRow label={refLabel(nav.below)} onClick={nav.back} />}
      <RefStackView view={top} below={nav.below} onPush={nav.push} />
    </BottomSheet>
  );
}
