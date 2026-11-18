import { defineConfig } from "vite";

// Relative URLs (base "./"), so the build works from any origin: the Capacitor app's
// https://localhost on the phone (web/dist is Capacitor's webDir; android/'s syncWeb task builds it
// and runs `cap sync`), the UI tests' harness, and `vite dev`. Only index.html is built: the pages in
// dev/ are for `vite dev`.
export default defineConfig({
  base: "./",
  build: {
    target: "es2022",
    assetsInlineLimit: 0,
    // The Verovio chunk (engraving engine with its WebAssembly embedded) is large by nature
    // and loaded lazily; it is bundled locally, never fetched.
    chunkSizeWarningLimit: 9000,
  },
});
