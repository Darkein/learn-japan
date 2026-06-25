/// <reference types="vitest/config" />
import { defineConfig, type PluginOption } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Déployé sous https://<user>.github.io/learn-japan/ → base = '/learn-japan/'.
const BASE = "/learn-japan/";

const here = dirname(fileURLToPath(import.meta.url));

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
  plugins: [
    rawGzipAssets(),
    react(),
    tailwindcss(),
    VitePWA({
      registerType: "autoUpdate",
      // Le dictionnaire kuromoji (~12 Mo) est volumineux : on l'EXCLUT du precache
      // et on le sert via un runtime cache (chargé à la demande, puis offline).
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,woff2}"],
        globIgnores: ["**/dict/**"],
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.includes("/dict/"),
            handler: "CacheFirst",
            options: {
              cacheName: "kuromoji-dict",
              expiration: { maxEntries: 64, maxAgeSeconds: 60 * 60 * 24 * 365 },
            },
          },
        ],
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
        icons: [
          { src: "icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
        ],
      },
    }),
  ],
  test: {
    environment: "node",
    globals: true,
  },
});
