import { describe, expect, it } from "vitest";
import { reminderNotification, type ReminderHint } from "./reminderText";

const TODAY = "2026-08-10";

const hint = (over: Partial<ReminderHint> = {}): ReminderHint => ({
  date: TODAY,
  kind: "lesson",
  ...over,
});

const word = (text: string) => ({ text, kind: "vocab" as const });

describe("reminderNotification", () => {
  it("accroche sur l'élément dû plutôt que sur le compte", () => {
    const n = reminderNotification(51, hint({ kind: "review", item: word("花火") }), TODAY);
    expect(n.title).toBe("Tu te souviens de 「花火」 ?");
    expect(n.body).toBe("Il t'attend dans tes révisions du jour.");
    // Le nombre de cartes ne doit apparaître nulle part : c'est justement ce qu'on remplace.
    expect(`${n.title} ${n.body}`).not.toMatch(/51/);
  });

  it("nomme un point de grammaire avec les guillemets français", () => {
    const n = reminderNotification(
      4,
      hint({ kind: "review", item: { text: "は (thème)", kind: "grammar" } }),
      TODAY,
    );
    expect(n.title).toBe("Et « は (thème) », ça te revient ?");
  });

  it("dit vrai quand il ne reste qu'une carte", () => {
    const n = reminderNotification(1, hint({ kind: "review", item: word("花火") }), TODAY);
    expect(n.body).toBe("C'est ta seule carte due aujourd'hui.");
  });

  it("ouvre le corps sur la série quand elle existe", () => {
    const n = reminderNotification(9, hint({ kind: "review", item: word("花火"), streak: 12 }), TODAY);
    expect(n.body).toBe("Ta série de 12 jours tient toujours. Il t'attend dans tes révisions du jour.");
    // Une série d'un seul jour ne mérite pas d'être annoncée.
    expect(reminderNotification(9, hint({ kind: "review", item: word("花火"), streak: 1 }), TODAY).body)
      .toBe("Il t'attend dans tes révisions du jour.");
  });

  it("se rabat sur le compte quand aucun élément n'est identifié", () => {
    // Indice périmé : le compte reste exact, l'élément non.
    const stale = reminderNotification(51, hint({ item: word("花火"), date: "2026-08-09" }), TODAY);
    expect(stale.title).toBe("51 révisions t'attendent.");
    expect(stale.body).toBe("Commence par les 10 plus urgentes, le reste attendra.");
    // La promesse reste taillée au dû : jamais « cinq minutes » sur un backlog.
    expect(reminderNotification(8, undefined, TODAY).body).toBe("Cinq minutes suffisent.");
    expect(reminderNotification(2, undefined, TODAY).body).toBe("C'est vite plié.");
    expect(reminderNotification(11, undefined, TODAY).body).not.toContain("minutes");
    expect(reminderNotification(1, undefined, TODAY).title).toBe("1 révision t'attend.");
  });

  it("propose le contenu du jour quand rien n'est dû", () => {
    const lesson = reminderNotification(0, hint({ kind: "lesson", label: "Les nombres" }), TODAY);
    expect(lesson).toEqual({
      title: "Ta prochaine leçon est prête.",
      body: "« Les nombres » t'attend quand tu veux.",
    });
    const story = reminderNotification(
      0,
      hint({ kind: "read-story", label: "Le chat de Kamakura" }),
      TODAY,
    );
    expect(story.title).toBe("Et si tu lisais « Le chat de Kamakura » ?");
    const mirror = reminderNotification(
      0,
      hint({ kind: "mirror", label: "Vieux conte", ageDays: 34 }),
      TODAY,
    );
    expect(mirror.title).toBe("Et si tu relisais « Vieux conte » ?");
    expect(mirror.body).toBe("Tu l'as lue il y a 34 jours. Vois ce que tu en comprends aujourd'hui.");
    expect(reminderNotification(0, hint({ kind: "omikuji" }), TODAY).title).toBe(
      "Ton omikuji du jour t'attend.",
    );
  });

  it("ignore l'élément quand plus rien n'est dû (il ne l'est plus non plus)", () => {
    const n = reminderNotification(0, hint({ kind: "omikuji", item: word("花火") }), TODAY);
    expect(n.title).toBe("Ton omikuji du jour t'attend.");
  });

  it("se rabat sur le générique sans mentir", () => {
    const generic = { title: "Cinq minutes de japonais ?", body: "Ton programme du jour t'attend." };
    expect(reminderNotification(0, undefined, TODAY)).toEqual(generic);
    expect(reminderNotification(0, hint({ date: "2026-08-09", label: "Les nombres" }), TODAY)).toEqual(
      generic,
    );
    expect(reminderNotification(0, hint({ kind: "done" }), TODAY)).toEqual(generic);
    // `review`/`reinforce` sans dû : l'indice a vieilli en cours de journée.
    expect(reminderNotification(0, hint({ kind: "review" }), TODAY)).toEqual(generic);
    // Un label vide ne doit pas produire « leçon est prête : « ». »
    expect(reminderNotification(0, hint({ kind: "lesson", label: "   " }), TODAY).body).toBe(
      "Elle t'attend quand tu veux.",
    );
  });

  it("tronque un titre trop long pour ne pas être coupé par l'OS", () => {
    const long = "Un titre d'histoire vraiment interminable qui déborde de la notification système";
    const n = reminderNotification(0, hint({ kind: "read-story", label: long }), TODAY);
    expect(n.title).toContain("…");
    expect(n.title.length).toBeLessThan(long.length + 25);
  });
});
