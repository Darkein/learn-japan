/// <reference types="vitest/config" />
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

// Déployé sous https://<user>.github.io/learn-japan/ → base = '/learn-japan/'.
const BASE = "/learn-japan/";

export default defineConfig({
  base: BASE,
  plugins: [
    react(),
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
