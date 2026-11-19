import { fileURLToPath } from 'node:url'

/** Where `npm run test:ui` builds the web app (git-ignored). */
export const BUILD_DIR = fileURLToPath(new URL('../../../build/web-test/', import.meta.url))
