import { fileURLToPath } from 'node:url'
import { mergeConfig } from 'vite'
import base from '../../vite.config.ts'

// The build the UI tests run against (npm run test:ui): the app's own build (vite.config.ts) plus
//  - the component gallery, dev/gallery.html, which mounts the shared components and the score island
//    for harness.test.ts and shows them on the review page (make ui-review);
//  - the seeded app, test/ui/seeded.html: the app's own `mount` on the fake platform, started from a
//    seed (seeds.ts), which is what the journeys run.
// Neither is in the app's build: only this config adds them, and the harness serves them next to the app.
const here = (path: string): string => fileURLToPath(new URL(path, import.meta.url))

export default mergeConfig(base, {
  build: {
    rolldownOptions: {
      input: {
        main: here('../../index.html'),
        gallery: here('../../dev/gallery.html'),
        seeded: here('./seeded.html'),
      },
    },
  },
})
