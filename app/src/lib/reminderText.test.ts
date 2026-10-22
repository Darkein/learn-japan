import { describe, expect, it } from "vitest";
import { pickFromPool, reminderNotification, type ReminderHint } from "./reminderText";

const TODAY = "2026-08-10";

const word = (text: string) => ({ text, kind: "vocab" as const });

const hint = (over: Partial<ReminderHint> = {}): ReminderHint => ({
  date: TODAY,
  kind: "review",
  items: [word("花火")],
  ...over,
});

const MIRROR = {
  key: "mirror:s1",
  kind: "mirror" as const,
  label: "Le chat de Kamakura",
  ageDays: 34,
};

describe("reminderNotification", () => {
  it("annonce le rendez-vous rare avant le dû quotidien", () => {
    const n = reminderNotification(51, hint({ event: MIRROR }), TODAY);
    expect(n.title).toBe("Et si tu relisais « Le chat de Kamakura » ?");
    expect(n.body).toBe("Tu l'as lue il y a 34 jours. Vois ce que tu en comprends aujourd'hui.");
    expect(n.eventShown).toBe("mirror:s1");
  });

  it("ne rejoue pas un rendez-vous déjà annoncé tant qu'il reste à faire", () => {
    // Même miroir, mais déjà sorti hier : c'est au tour du contenu dû.
    const n = reminderNotification(51, hint({ event: MIRROR }), TODAY, "mirror:s1");
    expect(n.title).toBe("Tu te souviens de 「花火」 ?");
    expect(n.eventShown).toBeUndefined();
    // Un autre candidat (nouvelle histoire, nouvelle leçon) reprend la main.
    const other = reminderNotification(51, hint({ event: { ...MIRROR, key: "mirror:s2" } }), TODAY, "mirror:s1");
    expect(other.eventShown).toBe("mirror:s2");
  });

  it("redit le rendez-vous les jours vides plutôt qu'une phrase creuse", () => {
    const n = reminderNotification(0, hint({ kind: "mirror", event: MIRROR }), TODAY, "mirror:s1");
    expect(n.title).toBe("Et si tu relisais « Le chat de Kamakura » ?");
  });

  it("accroche sur un élément dû plutôt que sur le compte", () => {
    const n = reminderNotification(51, hint(), TODAY);
    expect(n.title).toBe("Tu te souviens de 「花火」 ?");
    expect(n.body).toBe("Il revient dans ta prochaine révision.");
    // Le nombre de cartes ne doit apparaître nulle part : c'est justement ce qu'on remplace.
    expect(`${n.title} ${n.body}`).not.toMatch(/51/);
  });

  it("nomme un point de grammaire avec les guillemets français", () => {
    const n = reminderNotification(4, hint({ items: [{ text: "は (thème)", kind: "grammar" }] }), TODAY);
    expect(n.title).toBe("Et « は (thème) », ça te revient ?");
  });

  it("dit vrai quand il ne reste qu'une carte", () => {
    expect(reminderNotification(1, hint(), TODAY).body).toBe("C'est ta seule carte due aujourd'hui.");
  });

  it("ouvre le corps sur la série quand elle existe", () => {
    expect(reminderNotification(9, hint({ streak: 12 }), TODAY).body).toBe(
      "Ta série de 12 jours tient toujours. Il revient dans ta prochaine révision.",
    );
    // Une série d'un seul jour ne mérite pas d'être annoncée.
    expect(reminderNotification(9, hint({ streak: 1 }), TODAY).body).toBe(
      "Il revient dans ta prochaine révision.",
    );
  });

  it("garde le peloton d'éléments quand l'app n'a pas été ouverte, mais pas la série", () => {
    // Une carte due il y a trois jours et non révisée l'est encore : l'accroche reste vraie.
    const stale = reminderNotification(51, hint({ date: "2026-08-07", streak: 12 }), TODAY);
    expect(stale.title).toBe("Tu te souviens de 「花火」 ?");
    // La série, elle, a pu se casser depuis : on ne l'affirme plus.
    expect(stale.body).not.toContain("série");
    // Le rendez-vous non plus ne survit pas : l'histoire a pu être lue entre-temps.
    expect(reminderNotification(51, hint({ date: "2026-08-07", event: MIRROR }), TODAY).eventShown)
      .toBeUndefined();
  });

  it("ne se rabat jamais sur le compte de cartes dues", () => {
    // Peloton périmé et 51 cartes dues : plus de « 51 révisions t'attendent » (SPEC §5.8).
    const fossil = reminderNotification(51, hint({ date: "2026-06-01" }), TODAY);
    expect(fossil.title).not.toContain("51");
    expect(reminderNotification(8, undefined, TODAY).title).toBe("Cinq minutes de japonais ?");
  });

  it("annonce l'étape suivante du parcours faute d'élément à nommer", () => {
    const step = { label: "Révision", number: 81, lesson: "Les gens autour de moi" };
    const n = reminderNotification(0, hint({ items: [], step }), TODAY);
    expect(n.title).toBe("Étape 81 : Révision");
    expect(n.body).toBe("« Les gens autour de moi » t'attend là où tu l'as laissée.");
    // Un élément dû passe devant : l'accroche par le contenu reste la meilleure.
    expect(reminderNotification(3, hint({ step }), TODAY).title).toBe("Tu te souviens de 「花火」 ?");
    // L'étape d'un autre jour ne vaut plus : elle a pu être faite depuis.
    expect(reminderNotification(0, hint({ date: "2026-08-09", items: [], step }), TODAY).title).not.toContain("Étape");
  });

  it("propose le contenu du jour quand rien n'est dû", () => {
    const lesson = reminderNotification(
      0,
      hint({ kind: "lesson", items: [], event: { key: "lesson:l4", kind: "lesson", label: "Les nombres" } }),
      TODAY,
    );
    expect(lesson.title).toBe("Ta prochaine leçon est prête.");
    expect(lesson.body).toBe("« Les nombres » t'attend quand tu veux.");
    const story = reminderNotification(
      0,
      hint({ kind: "read-story", items: [], event: { key: "story:s9", kind: "read-story", label: "Le chat de Kamakura" } }),
      TODAY,
    );
    expect(story.title).toBe("Et si tu lisais « Le chat de Kamakura » ?");
    expect(reminderNotification(0, hint({ omikujiPending: true, items: [] }), TODAY).title).toBe(
      "Ton omikuji du jour t'attend.",
    );
  });

  it("ignore le peloton quand plus rien n'est dû (les éléments ne le sont plus non plus)", () => {
    const n = reminderNotification(0, hint({ omikujiPending: true }), TODAY);
    expect(n.title).toBe("Ton omikuji du jour t'attend.");
  });

  it("se rabat sur le générique sans mentir", () => {
    const generic = { title: "Cinq minutes de japonais ?", body: "Ton programme du jour t'attend." };
    expect(reminderNotification(0, undefined, TODAY)).toEqual(generic);
    expect(reminderNotification(0, hint({ date: "2026-08-09", omikujiPending: true }), TODAY)).toEqual(generic);
    expect(reminderNotification(0, hint({ kind: "done", items: [] }), TODAY)).toEqual(generic);
    // `review`/`reinforce` sans dû : l'indice a vieilli en cours de journée.
    expect(reminderNotification(0, hint({ items: [] }), TODAY)).toEqual(generic);
    // Un label vide ne doit pas produire « « ». »
    expect(
      reminderNotification(0, hint({ items: [], event: { key: "lesson:l4", kind: "lesson", label: "   " } }), TODAY).body,
    ).toBe("Elle t'attend quand tu veux.");
  });

  it("tronque un titre trop long pour ne pas être coupé par l'OS", () => {
    const long = "Un titre d'histoire vraiment interminable qui déborde de la notification système";
    const n = reminderNotification(
      0,
      hint({ items: [], event: { key: "story:s9", kind: "read-story", label: long } }),
      TODAY,
    );
    expect(n.title).toContain("…");
    expect(n.title.length).toBeLessThan(long.length + 25);
  });
});

describe("pickFromPool", () => {
  it("varie d'un jour à l'autre et ne bouge pas dans la journée", () => {
    const pool = Array.from({ length: 12 }, (_, i) => word(`語${i}`));
    const days = ["2026-08-10", "2026-08-11", "2026-08-12", "2026-08-13"];
    expect(new Set(days.map((d) => pickFromPool(pool, d)!.text)).size).toBeGreaterThan(1);
    expect(pickFromPool(pool, TODAY)).toEqual(pickFromPool(pool, TODAY));
  });

  it("rend undefined sur un peloton vide", () => {
    expect(pickFromPool([], TODAY)).toBeUndefined();
  });
});
