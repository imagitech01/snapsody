// The app as the UI tests start it (web/test/ui/app.ts): the same `mount` as src/main.tsx, on the fake
// platform instead of the phone's. It is built only by test/ui/vite.config.ts and is never part of the app.
//
//   seeded.html?seed=library,v2-settings
//
//   seed      what the fake files hold at the first start of the tab (seeds.ts); a reload finds the files
//             of the last snapshot instead (snapshot.ts), as a phone keeps its files
//   reader    `manual`: a reading job sends its events only when the journey steps it (`platform.reader.jobs.at(-1)`),
//             so a journey can look at the reading screen and cancel; by default a job runs through at once
//
// The platform, the shell and `snapshot` are left on `window.__test` for the journeys (testHooks.ts).

import { createFakePlatform } from '../../src/platform/fake/index.ts'
import { activePractice } from '../../src/ui/screens/activePractice.ts'
import { mount } from '../../src/ui/mount.tsx'
import { applySeed } from './seeds.ts'
import { barsScore } from './scores.ts'
import { restoreSnapshot, saveSnapshot } from './snapshot.ts'

const params = new URLSearchParams(location.search)
// A page that is read without a score of its own of the journey's makes four bars (the default is not a score at all).
const platform = createFakePlatform({ musicxml: barsScore(4), autoRun: params.get('reader') !== 'manual' })
if (!restoreSnapshot(platform.files)) await applySeed(platform, params.get('seed') ?? '')

const snapshot = (): void => saveSnapshot(platform.files)
addEventListener('pagehide', snapshot)

const shell = await mount(platform, document.getElementById('app')!)
const practice = () => {
  const session = activePractice.value
  return session ? { bar: session.bar.value, bars: session.bars, shownBar: session.shownBar.value, following: session.following.value } : null
}
window.__test = { platform, shell, snapshot, practice }
