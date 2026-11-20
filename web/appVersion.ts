// The app's version, as the web layer shows it (change paper-and-ink-and-about, design D8). It lives in one
// place, `versionName` in android/app/build.gradle, which the release steps bump. vite.config.ts reads it at build
// time and defines `__APP_VERSION__`, so Settings and About show the version of the build they are in.

/** The `versionName` in the text of a build.gradle. Throws when there is none, so a moved line fails the build. */
export function readVersionName(gradle: string): string {
  const match = /^\s*versionName\s*[=(]?\s*["']([^"']+)["']/m.exec(gradle)
  if (!match?.[1]) throw new Error('No versionName in build.gradle')
  return match[1]
}
