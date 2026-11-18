import { fileURLToPath } from 'node:url'

/** Where `npm run test:ui` builds the web app (git-ignored). */
export const BUILD_DIR = fileURLToPath(new URL('../../../build/web-test/', import.meta.url))

/** Where journey steps put their screenshots for the design review (make ui-review). */
export const REVIEW_DIR = fileURLToPath(new URL('../../../build/ui-review/', import.meta.url))

/** The Figma reference frames and the recorded deviations (docs/design/). */
export const DESIGN_DIR = fileURLToPath(new URL('../../../docs/design/', import.meta.url))
