import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { readVersionName } from '../appVersion.ts'

// The version Settings and About show comes from android/app/build.gradle at build time (design D8). These fail
// loudly when the line moves or changes shape, rather than letting the app show no version.

test('app version: read from today\'s android/app/build.gradle', () => {
  const gradle = readFileSync(fileURLToPath(new URL('../../android/app/build.gradle', import.meta.url)), 'utf8')
  assert.match(readVersionName(gradle), /^\d+\.\d+\.\d+$/)
  assert.equal(readVersionName(gradle), /versionName "([^"]+)"/.exec(gradle)?.[1])
})

test('app version: the forms Gradle accepts', () => {
  assert.equal(readVersionName('android {\n  defaultConfig {\n    versionName "0.1.2"\n  }\n}'), '0.1.2')
  assert.equal(readVersionName("versionName = '1.4.0'"), '1.4.0')
  assert.equal(readVersionName('    versionName("2.0.0")'), '2.0.0')
})

test('app version: a build.gradle without versionName throws', () => {
  assert.throws(() => readVersionName('android {\n  defaultConfig {\n    versionCode 3\n  }\n}'), /No versionName/)
})
