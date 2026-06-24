// Copie le dictionnaire kuromoji (~12 Mo, .dat.gz) de @sglkc/kuromoji vers app/public/dict/
// pour qu'il soit servi statiquement sous <base>/dict/. Exécuté en pre(dev|build).
// Le dossier public/dict/ est gitignoré (volumineux, reproductible).

import { createRequire } from "node:module";
import { cpSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const dest = join(here, "..", "public", "dict");

function resolveDictDir() {
  // main = .../@sglkc/kuromoji/src/kuromoji.js → le dict est à .../@sglkc/kuromoji/dict
  const main = require.resolve("@sglkc/kuromoji");
  const candidates = [
    join(dirname(main), "..", "dict"),
    join(dirname(main), "dict"),
  ];
  return candidates.find((p) => existsSync(p));
}

const src = resolveDictDir();
if (!src) {
  console.error(
    "[copy-dict] Dictionnaire @sglkc/kuromoji introuvable. Lance `npm install` d'abord.",
  );
  process.exit(1);
}

mkdirSync(dest, { recursive: true });
cpSync(src, dest, { recursive: true });
const n = readdirSync(dest).length;
console.log(`[copy-dict] ${n} fichiers copiés depuis ${src} → ${dest}`);
