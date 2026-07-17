/// <reference types="vitest/config" />
import { defineConfig, type PluginOption } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";
import { readFile } from "node:fs/promises";
import { execSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Déployé sous https://<user>.github.io/learn-japan/ → base = '/learn-japan/'.
const BASE = "/learn-japan/";

const here = dirname(fileURLToPath(import.meta.url));

// Identité de build affichée en bas des réglages : permet de vérifier d'un coup d'œil
// quelle version est réellement servie (utile avec le cache du service worker PWA).
// On expose le SHA et l'instant BRUT (ISO UTC) séparément : la date est formatée à
// l'exécution dans le fuseau horaire du navigateur (PC / mobile), pas figée en UTC.
const BUILD_SHA = (() => {
  try {
    return execSync("git rev-parse --short HEAD", { cwd: here }).toString().trim();
  } catch {
    // hors dépôt git (archive, CI minimal) : on se contente de la date.
    return "";
  }
})();
const BUILD_TIME = new Date().toISOString();

/**
 * Sert les assets `*.gz` (dictionnaire JMdict, dict kuromoji) en OCTETS BRUTS, sans
 * en-tête `Content-Encoding: gzip`, en dev comme en preview.
 *
 * Par défaut, le serveur statique de Vite (sirv) ajoute `Content-Encoding: gzip` dès
 * qu'un fichier se termine par `.gz` : le navigateur le décompresse alors tout seul, et
 * le code applicatif — qui veut décompresser lui-même — reçoit des octets déjà déballés
 * (« incorrect header check » côté DecompressionStream pour JMdict, « invalid gzip data »
 * côté fflate dans kuromoji). On intercepte donc ces requêtes pour renvoyer le gzip brut,
 * ce qui correspond aussi au comportement de GitHub Pages en production.
 */
function rawGzipAssets(): PluginOption {
  type Req = { url?: string };
  type Res = {
    setHeader: (k: string, v: string | number) => void;
    end: (b?: unknown) => void;
  };
  const serve = (server: { middlewares: { use: (fn: unknown) => void } }) => {
    server.middlewares.use(async (req: Req, res: Res, next: () => void) => {
      const path = (req.url ?? "").split("?")[0];
      if (!path.endsWith(".gz")) return next();
      const rel = path.startsWith(BASE) ? path.slice(BASE.length) : path.replace(/^\//, "");
      try {
        const buf = await readFile(join(here, "public", rel));
        res.setHeader("Content-Type", "application/octet-stream");
        res.setHeader("Content-Length", buf.byteLength);
        res.end(buf); // pas de Content-Encoding → le navigateur ne décompresse pas
      } catch {
        next();
      }
    });
  };
  return {
    name: "raw-gzip-assets",
    configureServer: serve,
    configurePreviewServer: serve,
  };
}

export default defineConfig({
  base: BASE,
  define: {
    __BUILD_SHA__: JSON.stringify(BUILD_SHA),
    __BUILD_TIME__: JSON.stringify(BUILD_TIME),
  },
  build: {
    rollupOptions: {
      output: {
        // Découpe le bundle pour rester sous la limite de precache Workbox (2 Mio par
        // fichier) et pour que le hash de la DONNÉE soit découplé du hash du CODE :
        // régénérer l'inventaire (ou livrer du code) n'invalide que le chunk concerné
        // côté PWA. Les JSON de mnémotechniques ne sont PAS listés ici : importés
        // dynamiquement (lib/mnemonics.ts), ils ont déjà leurs propres chunks.
        manualChunks(id) {
          if (id.includes("/data/inventory/") && !id.includes("-mnemonics")) return "inventory";
          if (id.includes("/data/curriculum.json")) return "inventory";
          if (/node_modules\/(react|react-dom|scheduler)\//.test(id)) return "react";
        },
      },
    },
  },
  plugins: [
    rawGzipAssets(),
    react(),
    tailwindcss(),
    VitePWA({
      // `prompt` (et non `autoUpdate`) : le nouveau SW s'installe mais n'est activé que
      // lorsqu'on le décide côté app (main.tsx : au retour dans l'app, jamais en pleine
      // lecture). Le SW n'appelle donc plus `skipWaiting()` de lui-même — il attend le
      // message SKIP_WAITING envoyé par `updateSW(true)`. Voir src/main.tsx et src/sw.ts.
      registerType: "prompt",
      // SW custom (src/sw.ts) : même precache/runtime-cache qu'avant (le dictionnaire
      // kuromoji ~12 Mo reste hors precache, servi en CacheFirst) + rappels de révisions
      // (periodic background sync → notification locale). Voir src/sw.ts.
      strategies: "injectManifest",
      srcDir: "src",
      filename: "sw.ts",
      injectManifest: {
        globPatterns: ["**/*.{js,css,html,svg,png,woff2}"],
        globIgnores: ["**/dict/**"],
      },
      manifest: {
        name: "Learn Japan — lecteur de japonais",
        short_name: "Learn Japan",
        description:
          "Lecteur de japonais extensif et adaptatif, local-first, hors-ligne.",
        lang: "fr",
        start_url: BASE,
        scope: BASE,
        display: "standalone",
        background_color: "#15130F",
        theme_color: "#15130F",
        // PNG raster (générés par scripts/make-icons.mjs) : requis pour l'artwork
        // MediaSession (notification média / écran verrouillé) et les launchers Android.
        icons: [
          { src: "icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
          { src: "icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
          { src: "icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
          { src: "icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
    }),
  ],
  test: {
    environment: "node",
    globals: true,
  },
});
