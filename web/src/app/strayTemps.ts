import { PlatformError } from '../platform/port.ts'
import type { FileEntry, Files } from '../platform/port.ts'

/*
 * The temp files that cut-off atomic writes leave behind (practice-app design D4, "Atomic
 * writes"): `<target>.tmp-<suffix>`, see `Files.writeTextAtomic`. The library's start-up sweep and
 * `loadSettings` settle them with `settleTemps`.
 *
 * A temp file next to its target is a write that never happened: the target is whole, so the temp
 * is removed. A temp file whose target is missing may hold the only copy (an adapter whose rename
 * deleted the target first and was cut off before the rename), so it is never just deleted: the
 * newest one whose content validates becomes the target, and the rest are removed.
 *
 * "Newest" is the greatest suffix by name, among the suffixes of the known format (`TEMP_SUFFIX`:
 * nine base-36 digits of the time of the write, "-", random characters; see `tempSuffix`), so that
 * is the last write; the random part only breaks a tie. A suffix of any other shape has no time in
 * it and counts as older than every one that has. A clock that was set back between two cut-off
 * writes of one target, with no start in between, could pick the older one; that takes two crashes
 * and a clock change, and either copy is a whole file.
 *
 * A temp whose target name itself holds ".tmp-" (`a.tmp-x.tmp-y`) is a temp of a temp: it is never
 * promoted, only removed.
 */

/** `<target>.tmp-<suffix>`: group 1 is the target's name, group 2 the suffix. */
export const TEMP_NAME = /^(.+)\.tmp-([^/]*)$/

/** The suffix `tempSuffix` makes: the only kind that is compared by time. */
export const TEMP_SUFFIX = /^[0-9a-z]{9}-[0-9a-z]+$/

/** Newest first: suffixes of the known format by name, descending, then every other one. */
function newestFirst(a: { suffix: string }, b: { suffix: string }): number {
  const timedA = TEMP_SUFFIX.test(a.suffix)
  const timedB = TEMP_SUFFIX.test(b.suffix)
  if (timedA !== timedB) return timedA ? -1 : 1
  return a.suffix < b.suffix ? 1 : a.suffix > b.suffix ? -1 : 0
}

export interface SettledTemps {
  /** The temp files removed (paths). */
  removed: string[]
  /** The targets a temp file was renamed to (paths). */
  restored: string[]
}

/**
 * Settles the temp files among [entries] (what `Files.list(folder)` gave). [valid] says whether a
 * temp's text is a whole file for [target] (the JSON parses, the score parses). Best effort: a
 * temp that cannot be read, renamed or removed is left as it is for the next start, together with
 * the other temps of its target, so an older copy never replaces one that could not be checked.
 */
export async function settleTemps(
  files: Files,
  folder: string,
  entries: FileEntry[],
  valid: (target: string, text: string) => boolean,
): Promise<SettledTemps> {
  const at = (name: string): string => (folder === '' ? name : `${folder}/${name}`)
  const present = new Set(entries.map((e) => e.name))
  const groups = new Map<string, Array<{ name: string; suffix: string }>>()
  for (const entry of entries) {
    const match = entry.kind === 'file' ? TEMP_NAME.exec(entry.name) : null
    if (!match) continue
    const [, target, suffix] = match as unknown as [string, string, string]
    groups.set(target, [...(groups.get(target) ?? []), { name: entry.name, suffix }])
  }

  const settled: SettledTemps = { removed: [], restored: [] }
  const drop = async (name: string): Promise<void> => {
    try {
      await files.remove(at(name))
      settled.removed.push(at(name))
    } catch {
      // Left for the next start.
    }
  }

  for (const [target, temps] of groups) {
    const ordered = [...temps].sort(newestFirst)
    if (present.has(target) || target.includes('.tmp-')) {
      for (const temp of ordered) await drop(temp.name)
      continue
    }
    let keep: string | undefined
    let unsure = false
    for (const temp of ordered) {
      let text: string
      try {
        text = await files.readText(at(temp.name))
      } catch (error) {
        if (error instanceof PlatformError && error.code === 'not-found') continue
        unsure = true
        break
      }
      if (valid(target, text)) {
        keep = temp.name
        break
      }
    }
    if (unsure) continue
    if (keep !== undefined) {
      try {
        await files.rename(at(keep), at(target))
        settled.restored.push(at(target))
      } catch {
        continue
      }
    }
    for (const temp of ordered) if (temp.name !== keep) await drop(temp.name)
  }
  return settled
}

/** Whether [text] is JSON: what makes a temp of a `.json` file whole. */
export function isJson(text: string): boolean {
  try {
    JSON.parse(text)
    return true
  } catch {
    return false
  }
}
