import { describe, it, expect } from "vitest";
import {
  answerInQuestion,
  contentStems,
  isDuplicateQuestion,
  keepDistinct,
  stemOverlap,
} from "./examQuality";

describe("contentStems", () => {
  it("réduit les formes d'une même famille au même radical", () => {
    expect(contentStems("existence").has("exist")).toBe(true);
    expect(contentStems("exister").has("exist")).toBe(true);
    expect(contentStems("inanimés").has("inani")).toBe(true);
    expect(contentStems("inanimé").has("inani")).toBe(true);
  });

  it("ignore les mots-outils et les mots de l'énoncé", () => {
    const stems = contentStems("Quel est le rôle de ce point de grammaire ?");
    expect([...stems]).toEqual([]);
  });

  it("ignore les formes japonaises citées", () => {
    // Seul le français compte : « X がある » n'est pas un indice, c'est la règle.
    expect([...contentStems("« X がある »")]).toEqual([]);
  });
});

describe("stemOverlap", () => {
  it("rapporte le recouvrement au plus petit des deux jeux", () => {
    const petit = new Set(["compl", "objet"]);
    const grand = new Set(["marqu", "compl", "objet", "direct", "actio"]);
    expect(stemOverlap(petit, grand)).toBe(1);
  });

  it("vaut zéro face à un jeu vide", () => {
    expect(stemOverlap(new Set(), new Set(["compl"]))).toBe(0);
  });
});

describe("answerInQuestion", () => {
  it("repère la glose du référentiel recopiée dans la bonne réponse", () => {
    // Le cas signalé : la face avant portait « ある (exister, inanimé) ».
    expect(
      answerInQuestion({
        prompt: "ある (exister, inanimé) Quel est le rôle de ce point de grammaire ?",
        answer: "Existence d'objets inanimés : « X がある ».",
      }),
    ).toBe(true);
  });

  it("laisse passer la même question posée sur la FORME seule", () => {
    expect(
      answerInQuestion({
        prompt: "ある Quel est le rôle de ce point de grammaire ?",
        answer: "Existence d'objets inanimés : « X がある ».",
      }),
    ).toBe(false);
  });

  it("ne se déclenche pas sur une réponse trop courte pour conclure", () => {
    expect(answerInQuestion({ prompt: "Où le chat dort-il ?", answer: "Dans la cuisine." })).toBe(
      false,
    );
  });

  it("laisse passer une question de compréhension ordinaire", () => {
    expect(
      answerInQuestion({
        prompt: "Pourquoi Yuki est-elle contente ?",
        answer: "Parce qu'elle a reçu un cadeau de son frère.",
      }),
    ).toBe(false);
  });
});

describe("isDuplicateQuestion", () => {
  it("voit le doublon quand deux énoncés différents appellent la même réponse", () => {
    expect(
      isDuplicateQuestion(
        {
          prompt: "を Quel est le rôle de ce point de grammaire ?",
          answer: "Marque le complément d'objet direct (ce sur quoi porte l'action).",
        },
        { prompt: "Que marque を dans une phrase ?", answer: "Le complément d'objet direct." },
      ),
    ).toBe(true);
  });

  it("distingue deux questions de compréhension sur le même personnage", () => {
    expect(
      isDuplicateQuestion(
        { prompt: "Que fait Yuki le matin ?", answer: "Elle boit du thé vert." },
        { prompt: "Que fait Yuki le soir ?", answer: "Elle lit un livre de japonais." },
      ),
    ).toBe(false);
  });

  it("distingue deux angles différents sur le même point", () => {
    expect(
      isDuplicateQuestion(
        { prompt: "Pourquoi は disparaît-il parfois ?", answer: "Parce que le thème est évident dans la situation." },
        { prompt: "Quelle faute change le sens ?", answer: "Employer が au lieu de は met l'accent sur le sujet." },
      ),
    ).toBe(false);
  });
});

describe("keepDistinct", () => {
  const sig = (q: { prompt: string; answer: string }) => q;

  it("retient la première formulation et écarte la reformulation", () => {
    const kept = keepDistinct(
      [
        { prompt: "Que marque を ?", answer: "Le complément d'objet direct." },
        { prompt: "À quoi sert を ?", answer: "Il marque le complément d'objet direct." },
        { prompt: "Pourquoi は tombe-t-il à l'oral ?", answer: "Le thème est déjà connu des deux interlocuteurs." },
      ],
      sig,
    );
    expect(kept.map((q) => q.prompt)).toEqual([
      "Que marque を ?",
      "Pourquoi は tombe-t-il à l'oral ?",
    ]);
  });

  it("confronte la série aux questions déjà retenues du sujet", () => {
    const kept = keepDistinct(
      [{ prompt: "Que marque を ?", answer: "Le complément d'objet direct." }],
      sig,
      [
        {
          prompt: "を Quel est le rôle de ce point de grammaire ?",
          answer: "Marque le complément d'objet direct (ce sur quoi porte l'action).",
        },
      ],
    );
    expect(kept).toEqual([]);
  });

  it("écarte une question dont l'énoncé donne la réponse", () => {
    const kept = keepDistinct(
      [
        {
          prompt: "Le chat mange-t-il du poisson dans la cuisine ?",
          answer: "Oui, le chat mange du poisson dans la cuisine.",
        },
      ],
      sig,
    );
    expect(kept).toEqual([]);
  });
});
