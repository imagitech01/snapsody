import { signal } from '@preact/signals'
import type { ReadonlySignal, Signal } from '@preact/signals'
import { DEFAULT_INSTRUMENT, instrumentById } from '../core/instruments/instruments.ts'
import type { InstrumentId } from '../core/instruments/instruments.ts'
import type { NoteNameStyle } from '../core/score/noteNames.ts'
import { PlatformError } from '../platform/port.ts'
import type { Files } from '../platform/port.ts'
import { isJson, settleTemps } from './strayTemps.ts'

/*
 * The general settings (practice-app design D4, D8, D13; spec `app-shell`, "General settings"):
 * the default instrument, the count-in (design D17), whether
 * the scan hint was seen, the note names and the editor's view (change redesign-score-editor, D9), kept in
 * `settings.json` at the root of the app's files.
 *
 *   { "defaultInstrument": "tenor-sax", "countIn": false, "scanHintSeen": false, "noteNames": "letters", "editorView": "notes" }
 *
 * - Each setting is a signal. A setter changes the signal at once, so the app follows without a
 *   restart, and returns the promise of the save. Saves go through one queue, each writing the
 *   whole current state with `Files.writeTextAtomic`, so a cut-off save leaves the old file and the
 *   last value set is the one that stays. When a save fails, the value stays set for this run and
 *   the promise rejects, so the caller can tell the user it will not be kept.
 * - Playback is always tuned to A4 = 440 Hz (design D19): an older file may still have a
 *   `pitchReference`; it is ignored when read and not written again. So is a `language` (the app is
 *   English only, `paper-and-ink-and-about` D11).
 * - What is read is never trusted. A missing file, a file that is not JSON or a wrongly shaped one
 *   gives the defaults, and so does each value that is not valid: an instrument id that is unknown
 *   or hidden (none is, today) gives the tenor
 *   saxophone, a count-in or scan hint flag that is not true gives false, note names that are not
 *   `solfege` give `letters` and an editor view that is not `grid` gives `notes` (so an older file without
 *   them needs no migration).
 * - A file that is there but cannot be read (the platform reports anything other than "not found")
 *   is not replaced: the app runs with the defaults, the settings are `readOnly`, and every save
 *   rejects without writing, until a later start reads the file. The user's settings may still be
 *   in it, and writing the defaults over them would lose them for good.
 * - `loadSettings` first settles the stray `settings.json.tmp-*` of an earlier cut-off save
 *   (`settleTemps`): removed when settings.json is there, and when it is not, the newest one that is
 *   JSON becomes settings.json (it may be the only copy).
 */

/** The settings as stored. */
export interface SettingsData {
  defaultInstrument: InstrumentId
  /** One bar of clicks before the music starts, for every piece. */
  countIn: boolean
  /** The hint before the first scan has been shown. */
  scanHintSeen: boolean
  /** How notes are named everywhere in the app: C D E, or Do Re Mi. */
  noteNames: NoteNameStyle
  /** The editor's surface the user last chose: engraved notes or the grid. */
  editorView: EditorView
}

export type EditorView = 'notes' | 'grid'

export const DEFAULT_SETTINGS: Readonly<SettingsData> = {
  defaultInstrument: DEFAULT_INSTRUMENT.id,
  countIn: false,
  scanHintSeen: false,
  noteNames: 'letters',
  editorView: 'notes',
}

const SETTINGS_FILE = 'settings.json'
const STRAY_TEMP = /^settings\.json\.tmp-/

export interface SettingsOptions {
  /** settings.json is there but could not be read: never write over it (see `Settings.readOnly`). */
  readOnly?: boolean
}

/** An instrument the user can have as default: one that exists and is not hidden. */
function offeredInstrument(id: unknown): InstrumentId | undefined {
  if (typeof id !== 'string') return undefined
  const instrument = instrumentById(id)
  return instrument && !instrument.hidden ? instrument.id : undefined
}

/** Settings from anything that was stored: every value that is not valid becomes its default. */
export function normaliseSettings(value: unknown): SettingsData {
  const o = typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {}
  return {
    defaultInstrument: offeredInstrument(o.defaultInstrument) ?? DEFAULT_SETTINGS.defaultInstrument,
    countIn: o.countIn === true,
    scanHintSeen: o.scanHintSeen === true,
    noteNames: o.noteNames === 'solfege' ? 'solfege' : 'letters',
    editorView: o.editorView === 'grid' ? 'grid' : 'notes',
  }
}

export class Settings {
  private readonly files: Files
  private readonly instrument: Signal<InstrumentId>
  private readonly count: Signal<boolean>
  private readonly hint: Signal<boolean>
  private readonly names: Signal<NoteNameStyle>
  private readonly view: Signal<EditorView>
  /** The end of the queue of saves; it never rejects. */
  private tail: Promise<unknown> = Promise.resolve()
  /**
   * True when settings.json was there but could not be read at start: the values are the defaults,
   * a change still takes effect for this run, but its save rejects and nothing is written. The next
   * `loadSettings` that reads the file ends it.
   */
  readonly readOnly: boolean

  constructor(files: Files, data: SettingsData, options: SettingsOptions = {}) {
    this.files = files
    this.readOnly = options.readOnly ?? false
    this.instrument = signal(data.defaultInstrument)
    this.count = signal(data.countIn)
    this.hint = signal(data.scanHintSeen)
    this.names = signal(data.noteNames)
    this.view = signal(data.editorView)
  }

  /** The instrument every practice session starts with. */
  get defaultInstrument(): ReadonlySignal<InstrumentId> {
    return this.instrument
  }

  /** One bar of clicks before the music starts, for every piece. */
  get countIn(): ReadonlySignal<boolean> {
    return this.count
  }

  get scanHintSeen(): ReadonlySignal<boolean> {
    return this.hint
  }

  /** How notes are named: in the editor, in the warnings and in the instrument's range. */
  get noteNames(): ReadonlySignal<NoteNameStyle> {
    return this.names
  }

  /** The editor's surface: Notes or Grid. */
  get editorView(): ReadonlySignal<EditorView> {
    return this.view
  }

  /** The current values, as they are stored. */
  snapshot(): SettingsData {
    return {
      defaultInstrument: this.instrument.value,
      countIn: this.count.value,
      scanHintSeen: this.hint.value,
      noteNames: this.names.value,
      editorView: this.view.value,
    }
  }

  /** Rejects (and changes nothing) for an id that is unknown or hidden: the settings list offers only the others. */
  setDefaultInstrument(id: string): Promise<void> {
    const offered = offeredInstrument(id)
    if (offered === undefined) return Promise.reject(new Error(`not an instrument the user can choose: ${String(id)}`))
    this.instrument.value = offered
    return this.save()
  }

  setCountIn(on: boolean): Promise<void> {
    this.count.value = on
    return this.save()
  }

  setScanHintSeen(seen: boolean = true): Promise<void> {
    this.hint.value = seen
    return this.save()
  }

  setNoteNames(style: NoteNameStyle): Promise<void> {
    this.names.value = style
    return this.save()
  }

  setEditorView(view: EditorView): Promise<void> {
    this.view.value = view
    return this.save()
  }

  /** Writes the settings as they are when the write comes up; resolves when they are on disk. */
  private save(): Promise<void> {
    if (this.readOnly) return Promise.reject(new Error('settings.json could not be read at start; changes are kept for this run only'))
    const run = this.tail.then(() => this.files.writeTextAtomic(SETTINGS_FILE, `${JSON.stringify(this.snapshot(), null, 2)}\n`))
    this.tail = run.catch(() => undefined)
    return run
  }
}

/**
 * Settles the stray temp files of cut-off saves, then reads `settings.json` (the defaults for what
 * is missing or not valid). It does not fail: the app starts with the defaults rather than not at
 * all. When the file is there but cannot be read, or the folder cannot be listed to settle the temp
 * files, the settings are `readOnly` for this run.
 */
export async function loadSettings(files: Files): Promise<Settings> {
  let readOnly = false
  try {
    const entries = (await files.list('')).filter((e) => e.name === SETTINGS_FILE || STRAY_TEMP.test(e.name))
    await settleTemps(files, '', entries, (_target, text) => isJson(text))
  } catch {
    // A temp file may hold the only copy of the settings: do not write until a start can look.
    readOnly = true
  }
  let data = normaliseSettings(undefined)
  let text: string | undefined
  try {
    text = await files.readText(SETTINGS_FILE)
  } catch (error) {
    // No file yet: the defaults. Anything else: the defaults, without writing over the file.
    if (!(error instanceof PlatformError && error.code === 'not-found')) readOnly = true
  }
  if (text !== undefined) {
    try {
      data = normaliseSettings(JSON.parse(text))
    } catch {
      // Not JSON: the defaults, and the next save replaces it.
    }
  }
  return new Settings(files, data, { readOnly })
}
