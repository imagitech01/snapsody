import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import { readVersionName } from "./appVersion.ts";

// Relative URLs (base "./"), so the build works from any origin: the Capacitor app's
// https://localhost on the phone (web/dist is Capacitor's webDir; android/'s syncWeb task builds it
// and runs `cap sync`), the UI tests' harness, and `vite dev`. Only index.html is built: the pages in
// dev/ are for `vite dev`.
//
// `__APP_VERSION__` is the app's version, read from android/app/build.gradle (appVersion.ts). The UI tests'
// build (test/ui/vite.config.ts) is merged from this one, so it gets the same value.
const gradle = readFileSync(fileURLToPath(new URL("../android/app/build.gradle", import.meta.url)), "utf8");

export default defineConfig({
  base: "./",
  define: {
    __APP_VERSION__: JSON.stringify(readVersionName(gradle)),
  },
  build: {
    target: "es2022",
    assetsInlineLimit: 0,
    // The Verovio chunk (engraving engine with its WebAssembly embedded) is large by nature
    // and loaded lazily; it is bundled locally, never fetched.
    chunkSizeWarningLimit: 9000,
  },
});
