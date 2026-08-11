import { describe, expect, it } from "vitest";
import { POOL_SIZE, reminderItemPool, type PickVocabLike } from "./reminderItem";

const NOW = new Date("2026-08-10T19:00:00Z");

const card = (daysFromNow: number, reps = 3) => ({
  due: new Date(NOW.getTime() + daysFromNow * 86_400_000),
  reps,
});

const v = (surface: string, written?: ReturnType<typeof card>): PickVocabLike => ({
  surface,
  cards: written ? { written } : {},
});

describe("reminderItemPool", () => {
  it("ne retient que des cartes dues ET déjà révisées", () => {
    // Jamais révisée (reps 0) : « tu te souviens de… » serait faux.
    expect(reminderItemPool([v("新品", card(-1, 0))], [], NOW)).toEqual([]);
    // Pas encore due.
    expect(reminderItemPool([v("明日", card(2))], [], NOW)).toEqual([]);
    // Jamais apprise (aucune carte).
    expect(reminderItemPool([v("未知")], [], NOW)).toEqual([]);
    expect(reminderItemPool([v("花火", card(-1))], [], NOW)).toEqual([
      { text: "花火", kind: "vocab" },
    ]);
  });

  it("prend la grammaire comme le vocabulaire", () => {
    expect(reminderItemPool([], [{ name: "は (thème)", card: card(-3) }], NOW)).toEqual([
      { text: "は (thème)", kind: "grammar" },
    ]);
  });

  it("garde les plus en retard d'abord, et s'arrête au peloton", () => {
    const vocab = Array.from({ length: 30 }, (_, i) =>
      v(`語${String(i).padStart(2, "0")}`, card(-30 + i)),
    );
    const pool = reminderItemPool(vocab, [], NOW);
    expect(pool).toHaveLength(POOL_SIZE);
    expect(pool[0].text).toBe("語00"); // le plus en retard ouvre le peloton
    expect(pool.at(-1)!.text).toBe(`語${String(POOL_SIZE - 1).padStart(2, "0")}`);
  });

  it("est déterministe quel que soit l'ordre de lecture d'IndexedDB", () => {
    const vocab = [v("一", card(-5)), v("二", card(-4)), v("三", card(-3))];
    expect(reminderItemPool(vocab, [], NOW)).toEqual(reminderItemPool([...vocab].reverse(), [], NOW));
  });

  it("départage à la milliseconde égale par le texte, pas par l'ordre du store", () => {
    const same = card(-1);
    const pool = reminderItemPool([v("犬", { ...same }), v("猫", { ...same })], [], NOW);
    expect(pool.map((i) => i.text)).toEqual(["犬", "猫"]);
  });
});
