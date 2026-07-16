// Types du module virtuel `virtual:pwa-register` (registration du service worker PWA).
/// <reference types="vite-plugin-pwa/client" />

// Constantes injectées à la compilation par Vite (`define` dans vite.config.ts).

/** SHA git court du build (`""` hors dépôt git), affiché en bas des réglages. */
declare const __BUILD_SHA__: string;
/** Instant du build au format ISO UTC ; rendu en heure locale à l'affichage. */
declare const __BUILD_TIME__: string;
