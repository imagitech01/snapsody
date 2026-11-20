import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { CREDIT_GROUPS, CREDITS, groupCredits, findCredit, licenceFileOf } from '../src/app/credits.ts'

// The credits (openspec `paper-and-ink-and-about` D7) are the list of components in `src/app/credits.ts`. The SoundFont's
// acknowledgements, which its licence asks to travel with the app, are copied there, so the first test checks that they
// are still the ones in `NOTICE` (the repository's record of the licences) and `docs/samples.md` (where the choice of
// the SoundFont is recorded), whatever the white space. The others keep the list true: every entry has its licence
// text, `NOTICE` names every entry, and every dependency in the build files is credited with the version it has there.

const read = (path: string): string => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')
const flat = (text: string): string => text.replace(/\s+/g, ' ')

test('credits: the acknowledgements, licence and source are those recorded in NOTICE and docs/samples.md', () => {
  const notice = flat(read('../../NOTICE'))
  const samples = flat(read('../../docs/samples.md'))
  const soundfont = findCredit('musescore-general')
  assert.ok(soundfont, 'the SoundFont is credited')
  assert.equal(`${soundfont.name} ${soundfont.version}`, 'MuseScore_General 0.2')
  assert.ok(notice.includes(`${soundfont.name} ${soundfont.version}`), 'NOTICE names the same SoundFont and version')
  assert.ok(notice.includes(soundfont.licence), 'NOTICE has the same licence')
  assert.ok(notice.includes(soundfont.source), 'NOTICE has the same source')
  const lines = soundfont.notices ?? []
  for (const line of lines) {
    assert.ok(notice.includes(flat(line)), `NOTICE does not have: ${line}`)
    assert.ok(samples.includes(flat(line)), `docs/samples.md does not have: ${line}`)
  }
  assert.equal(lines.filter((line) => /^(FluidR3|Mono conversion|Adaptation|Temple Blocks|Drumline)/.test(line)).length, 5, 'the five acknowledgements the licence lists')
})

test('credits: every entry has a non-empty licence file, and the files are not left over', () => {
  const ids = new Set<string>()
  for (const credit of CREDITS) {
    assert.ok(!ids.has(credit.id), `${credit.id} is listed twice`)
    ids.add(credit.id)
    const file = `../public/licences/${licenceFileOf(credit)}`
    assert.ok(statSync(fileURLToPath(new URL(file, import.meta.url))).size > 0, `${credit.id}: ${file} is empty`)
    assert.ok(read(file).trim().length > 100, `${credit.id}: ${file} has no licence text`)
  }
  // The sub-libraries' texts were left out on purpose (design, "Credits list the big parts"): no file without an entry.
  const used = new Set(CREDITS.map(licenceFileOf))
  for (const file of readdirSync(fileURLToPath(new URL('../public/licences/', import.meta.url)))) {
    assert.ok(used.has(file), `public/licences/${file} belongs to no credits entry`)
  }
})

// Task 4.2: what Verovio compiles in (read from its repository at version-6.4.0) has its notice in its licence text.
test('credits: the Verovio licence file carries the notice of each library compiled into it', () => {
  const text = read('../public/licences/verovio.txt')
  const verovio = CREDITS.find((credit) => credit.id === 'verovio')
  for (const library of ['pugixml', 'jsonxx', 'miniz-cpp', 'midifile', 'Tuning Library', 'CRC-32', 'base64', 'libmei']) {
    assert.ok(text.includes(`${library} `), `verovio.txt has no notice for ${library}`)
    assert.ok(verovio?.notices?.join(' ').includes(library), `the Verovio entry does not name ${library}`)
  }
  assert.ok(/Permission is hereby granted/.test(text) && /Redistribution and use/.test(text), 'MIT and BSD notices')
})

test('credits: NOTICE names every entry, with its version', () => {
  const notice = flat(read('../../NOTICE')).toLowerCase()
  for (const credit of CREDITS) {
    assert.ok(notice.includes(credit.name.toLowerCase()), `NOTICE does not name ${credit.name}`)
    if (credit.version !== undefined) {
      assert.ok(notice.includes(credit.version), `NOTICE does not have the version of ${credit.name}: ${credit.version}`)
    }
  }
})

// What the build files ask for, as the coordinates `Credit.covers` lists (see there for the forms).
const gradleVariables = (): Map<string, string> =>
  new Map([...read('../../android/variables.gradle').matchAll(/^\s*(\w+)\s*=\s*'([^']+)'/gm)].map((m): [string, string] => [m[1] ?? '', m[2] ?? '']))

function dependenciesInBuildFiles(): string[] {
  const variables = gradleVariables()
  const resolve = (version: string): string => version.replace(/\$(\w+)/g, (_, name: string) => {
    const value = variables.get(name)
    assert.ok(value !== undefined, `variables.gradle has no ${name}`)
    return value
  })
  const found: string[] = []

  // npm: the runtime dependencies. devDependencies (the test browser, TypeScript, Vite) do not ship.
  const pkg = JSON.parse(read('../package.json')) as { dependencies: Record<string, string> }
  for (const [name, version] of Object.entries(pkg.dependencies)) found.push(`npm:${name}@${version}`)

  // The app module: `implementation` lines only, so the test and androidTest dependencies are left out.
  const app = read('../../android/app/build.gradle')
  for (const m of app.matchAll(/^\s*implementation\s+(["'])([^"']+)\1/gm)) {
    const [group, artifact, version = ''] = (m[2] ?? '').split(':')
    found.push(`maven:${group}:${artifact}:${resolve(version)}`)
  }
  for (const m of app.matchAll(/^\s*implementation\s+project\(':([^']+)'\)/gm)) found.push(`project:${m[1]}`)
  for (const m of app.matchAll(/^\s*install\("([^"]+)"\)/gm)) found.push(`pip:${m[1]}`)
  const python = /^\s*version\s*=\s*"([^"]+)"/m.exec(app)
  assert.ok(python, 'android/app/build.gradle has no Chaquopy python version')
  found.push(`python:${python[1]}`)

  // The Gradle plugins that ship code: Chaquopy, and the Kotlin one that sets the Kotlin version of the app.
  const root = read('../../android/build.gradle')
  const chaquopy = /classpath\s+'com\.chaquo\.python:gradle:([^']+)'/.exec(root)
  assert.ok(chaquopy, 'android/build.gradle has no Chaquopy plugin')
  found.push(`maven:com.chaquo.python:gradle:${chaquopy[1]}`)
  const kotlin = /ext\.kotlin_version\s*=\s*'([^']+)'/.exec(root)
  assert.ok(kotlin, 'android/build.gradle has no kotlin_version')
  found.push(`maven:org.jetbrains.kotlin:kotlin-gradle-plugin:${kotlin[1]}`)

  // Cordova's version is a variable that capacitor-cordova-android-plugins reads.
  const cordova = variables.get('cordovaAndroidVersion')
  assert.ok(cordova, 'variables.gradle has no cordovaAndroidVersion')
  found.push(`maven:org.apache.cordova:framework:${cordova}`)
  return found
}

test('credits: every dependency in the build files is credited with the same version', () => {
  const covered = new Map<string, string>()
  for (const credit of CREDITS) for (const coordinate of credit.covers) covered.set(coordinate, credit.id)
  const found = dependenciesInBuildFiles()
  assert.ok(found.length > 25, 'the build files were read')
  for (const coordinate of found) {
    assert.ok(covered.has(coordinate), `${coordinate} is in a build file but no credits entry covers it (name and version)`)
  }
  // The other way round: an entry must not keep covering a dependency that is gone or has another version.
  for (const [coordinate, id] of covered) {
    assert.ok(found.includes(coordinate), `${id} covers ${coordinate}, which no build file asks for`)
  }
})

test('credits: groupCredits gives the groups in order and every entry once', () => {
  const sections = groupCredits()
  const order = sections.map((section) => section.group)
  assert.deepEqual(order, CREDIT_GROUPS.filter((group) => order.includes(group)), 'the order of CREDIT_GROUPS')
  assert.equal(new Set(order).size, order.length, 'a group appears once')
  assert.deepEqual(sections.flatMap((section) => section.credits.map((c) => c.id)).sort(), CREDITS.map((c) => c.id).sort())
  for (const section of sections) {
    assert.ok(section.credits.every((credit) => credit.group === section.group))
  }
  assert.equal(sections.length, CREDIT_GROUPS.length, 'today every group has an entry')
  assert.equal(groupCredits([]).length, 0)
  assert.equal(CREDITS.find((credit) => credit.notOpenSource)?.id, 'mlkit-document-scanner')
})
