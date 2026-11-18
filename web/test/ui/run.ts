// npm run test:ui [-- test/ui/<file>.test.ts ...]: builds the web app for the UI tests into
// build/web-test/ (the same vite build the Android app bundles, plus the component gallery, see
// test/ui/vite.config.ts), then runs the UI tests, or only the given files (openspec test-pyramid
// design T4, docs/testing.md).
import { spawnSync } from 'node:child_process'
import { BUILD_DIR } from './paths.ts'

function run(command: string, args: string[]): void {
  const result = spawnSync(command, args, { stdio: 'inherit' })
  if (result.status !== 0) process.exit(result.status ?? 1)
}

run('npx', ['vite', 'build', '--config', 'test/ui/vite.config.ts', '--outDir', BUILD_DIR, '--emptyOutDir', '--logLevel', 'warn'])
const files = process.argv.slice(2)
// One file at a time: each test file starts its own Chromium, and the Mac has 8 GB.
run(process.execPath, ['--test', '--test-concurrency=1', ...(files.length > 0 ? files : ['test/ui/*.test.ts'])])
