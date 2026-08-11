import { describe, expect, it } from "vitest";
import { pickReminderItem, type PickVocabLike } from "./reminderItem";

const NOW = new Date("2026-08-10T19:00:00Z");
const TODAY = "2026-08-10";

const card = (daysFromNow: number, reps = 3) => ({
  due: new Date(NOW.getTime() + daysFromNow * 86_400_000),
  reps,
});

const v = (surface: string, written?: ReturnType<typeof card>): PickVocabLike => ({
  surface,
  cards: written ? { written } : {},
});

describe("pickReminderItem", () => {
  it("ne retient que des cartes dues ET déjà révisées", () => {
    // Jamais révisée (reps 0) : « tu te souviens de… » serait faux.
    expect(pickReminderItem([v("新品", card(-1, 0))], [], NOW, TODAY)).toBeUndefined();
    // Pas encore due.
    expect(pickReminderItem([v("明日", card(2))], [], NOW, TODAY)).toBeUndefined();
    // Jamais apprise (aucune carte).
    expect(pickReminderItem([v("未知")], [], NOW, TODAY)).toBeUndefined();
    expect(pickReminderItem([v("花火", card(-1))], [], NOW, TODAY)).toEqual({
      text: "花火",
      kind: "vocab",
    });
  });

  it("prend la grammaire comme le vocabulaire", () => {
    const item = pickReminderItem([], [{ name: "は (thème)", card: card(-3) }], NOW, TODAY);
    expect(item).toEqual({ text: "は (thème)", kind: "grammar" });
  });

  it("puise dans les plus en retard, et varie d'un jour à l'autre", () => {
    // 30 mots dus : les 12 plus en retard forment le peloton, le reste n'est jamais servi.
    const vocab = Array.from({ length: 30 }, (_, i) => v(`語${String(i).padStart(2, "0")}`, card(-30 + i)));
    const picks = new Set(
      ["2026-08-10", "2026-08-11", "2026-08-12", "2026-08-13"].map(
        (d) => pickReminderItem(vocab, [], NOW, d)!.text,
      ),
    );
    expect(picks.size).toBeGreaterThan(1); // la notification ne répète pas le même mot
    for (const text of picks) expect(Number(text.slice(1))).toBeLessThan(12);
  });

  it("est déterministe à date égale", () => {
    const vocab = [v("一", card(-5)), v("二", card(-4)), v("三", card(-3))];
    const a = pickReminderItem(vocab, [], NOW, TODAY);
    const b = pickReminderItem([...vocab].reverse(), [], NOW, TODAY);
    expect(a).toEqual(b); // l'ordre de lecture d'IndexedDB ne doit rien changer
  });
});
