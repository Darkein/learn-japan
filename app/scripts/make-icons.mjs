// Rastérise public/icon.svg en PNG pour le manifest PWA et l'artwork MediaSession
// (l'écran verrouillé / les notifications média veulent du PNG raster, pas du SVG).
// Outil de développement lancé à la main (node scripts/make-icons.mjs) : les PNG produits
// sont versionnés dans public/. Nécessite un Chromium pilotable par Playwright — soit les
// dépendances locales, soit les chemins d'un environnement CI (variables ci-dessous).
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const pub = join(here, "..", "public");

const PLAYWRIGHT = process.env.PLAYWRIGHT_MODULE ?? "playwright";
const CHROMIUM_PATH = process.env.CHROMIUM_PATH; // ex. /opt/pw-browsers/chromium

const { chromium } = await import(PLAYWRIGHT);
const svg = await readFile(join(pub, "icon.svg"), "utf8");

const browser = await chromium.launch(CHROMIUM_PATH ? { executablePath: CHROMIUM_PATH } : {});

/** Capture `html` (fond transparent) en `size`×`size` px vers public/`name`. */
async function shoot(name, size, html) {
  const page = await browser.newPage({ viewport: { width: size, height: size } });
  await page.setContent(
    `<style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${html}`,
  );
  await page.screenshot({ path: join(pub, name), omitBackground: true });
  await page.close();
  console.log(`✓ ${name} (${size}×${size})`);
}

// Icônes « any » : le SVG tel quel (coins arrondis du fond inclus).
await shoot("icon-192.png", 192, svg);
await shoot("icon-512.png", 512, svg);

// Variante « maskable » : fond plein bord à bord (l'OS applique son propre masque) et
// glyphe réduit à ~80 % pour rester dans la zone de sécurité.
const maskable = svg
  .replace(/rx="96"/, 'rx="0"')
  .replace(/(<circle|<g)/, '<g transform="translate(51.2 51.2) scale(0.8)">$1')
  .replace(/<\/svg>/, "</g></svg>");
await shoot("icon-maskable-512.png", 512, maskable);

await browser.close();
