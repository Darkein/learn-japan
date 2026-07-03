---
name: verify
description: Lancer et piloter l'app Learn Japan en local pour vérifier un changement de bout en bout (vite + Playwright/Chromium headless).
---

# Vérifier Learn Japan en local

## Lancer

```bash
npm run dev > /tmp/vite.log 2>&1 &   # racine du repo ; port 5173, base /learn-japan/
# prêt quand : "VITE ... ready" dans le log. URL : http://localhost:5173/learn-japan/
```

Le predev copie le dictionnaire kuromoji dans `app/public/dict` (nécessaire aux furigana).
Sans Worker Cloudflare joignable : la génération LLM (histoires, cadrage, traduction,
QCM de compréhension) et le Cloud TTS échouent proprement — l'UI dégrade (messages
d'erreur « Réessayer », repli Web Speech). Les flux Lecteur→Exercices sont donc
inaccessibles hors ligne ; Révision et Vérification des acquis restent pilotables.

## Piloter (Playwright)

Chromium : `executablePath: "/opt/pw-browsers/chromium"` ; en session cloud, Playwright
global : `import { chromium } from "/opt/node22/lib/node_modules/playwright/index.mjs"`.

Semer l'état SANS LLM via les modules Vite dans `page.evaluate` :

```js
await page.evaluate(async () => {
  const db = await import("/learn-japan/src/lib/db.ts");
  const srs = await import("/learn-japan/src/lib/srs.ts");
  await db.putVocab({ id: "水|みず", surface: "水", reading: "みず", meaning: "eau",
    tags: [], status: "review", cards: { written: srs.newCard(new Date("2020-01-01")) },
    example: { ja: "毎朝、水を飲みます。", fr: "Chaque matin, je bois de l'eau." } });
  // ou enrôler une leçon entière (items sans carte) :
  const cur = await import("/learn-japan/src/lib/curriculum.ts");
  const enroll = await import("/learn-japan/src/lib/enroll.ts");
  await enroll.enrollLesson(cur.getCurriculum()[0].id);
});
await page.reload();
```

## Parcours utiles

- Révision SRS : Accueil → bouton « Réviser maintenant » (exige une carte due semée).
- Vérification des acquis : onglet Catalogue → titre de leçon → bouton « Vérifier mes
  acquis » (exige la leçon enrôlée, sinon état vide).
- Saisie : `input[lang=ja]`, bouton « Vérifier » ; tuiles build : `button.font-jp`.

## Pièges

- L'état vit dans IndexedDB : un nouveau contexte navigateur = base vide.
- Les libellés de compteur sont en CSS `uppercase` — `innerText` renvoie « QUESTION 1 / 7 ».
- Les furigana arrivent async (kuromoji) : `waitForSelector("ruby rt")`.
