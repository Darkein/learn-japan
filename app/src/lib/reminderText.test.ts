import { describe, expect, it } from "vitest";
import { reminderBody, type ReminderHint } from "./reminderText";

const TODAY = "2026-08-10";

const hint = (over: Partial<ReminderHint> = {}): ReminderHint => ({
  date: TODAY,
  kind: "lesson",
  ...over,
});

describe("reminderBody", () => {
  it("annonce le dû en priorité, au bon nombre", () => {
    expect(reminderBody(1, undefined, TODAY)).toBe("1 révision t'attend — c'est vite plié.");
    expect(reminderBody(7, undefined, TODAY)).toBe("7 révisions t'attendent — 5 minutes suffisent.");
    // Le dû passe devant l'indice d'activité, même s'il y en a un.
    expect(reminderBody(3, hint({ label: "Les nombres" }), TODAY)).toContain("3 révisions");
  });

  it("ne promet pas 5 minutes quand le backlog ne tient pas dedans", () => {
    // Un gros dû : on propose la première bouchée, pas une durée intenable.
    expect(reminderBody(51, undefined, TODAY)).toBe(
      "51 révisions t'attendent — commence par les 10 plus urgentes, le reste attendra.",
    );
    // Frontière : 10 tient dans cinq minutes, 11 non.
    expect(reminderBody(10, undefined, TODAY)).toContain("5 minutes suffisent");
    expect(reminderBody(11, undefined, TODAY)).not.toContain("5 minutes");
  });

  it("nomme la leçon ou l'histoire quand rien n'est dû", () => {
    expect(reminderBody(0, hint({ kind: "lesson", label: "Les nombres" }), TODAY)).toBe(
      "Ta prochaine leçon est prête : Les nombres.",
    );
    expect(
      reminderBody(0, hint({ kind: "read-story", label: "Le chat de Kamakura" }), TODAY),
    ).toBe("Une histoire t'attend : Le chat de Kamakura.");
    expect(reminderBody(0, hint({ kind: "mirror", label: "Vieux conte" }), TODAY)).toBe(
      "Une vieille histoire t'attend — mesure le chemin parcouru.",
    );
    expect(reminderBody(0, hint({ kind: "omikuji" }), TODAY)).toBe("Tire ton omikuji du jour.");
  });

  it("se rabat sur le générique sans mentir", () => {
    const generic = "Cinq minutes de japonais ?";
    // Indice absent, périmé, ou activité sans rien à annoncer.
    expect(reminderBody(0, undefined, TODAY)).toBe(generic);
    expect(reminderBody(0, hint({ date: "2026-08-09", label: "Les nombres" }), TODAY)).toBe(generic);
    expect(reminderBody(0, hint({ kind: "done" }), TODAY)).toBe(generic);
    // `review`/`reinforce` sans dû : l'indice a vieilli en cours de journée.
    expect(reminderBody(0, hint({ kind: "review" }), TODAY)).toBe(generic);
    // Un label vide ne doit pas produire « leçon est prête :  . »
    expect(reminderBody(0, hint({ kind: "lesson", label: "   " }), TODAY)).toBe(
      "Ta prochaine leçon est prête.",
    );
  });

  it("tronque un titre trop long pour ne pas être coupé par l'OS", () => {
    const long = "Un titre d'histoire vraiment interminable qui déborde de la notification système";
    const body = reminderBody(0, hint({ kind: "read-story", label: long }), TODAY);
    expect(body).toContain("…");
    expect(body.length).toBeLessThan(long.length + 25);
  });
});
