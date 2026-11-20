// Helpers shared by the journey tests for the rendered score. Elements are found by role and
// accessible name; score notes, which have none, by their model id (the SVG group of a note
// carries the id the app's parser gave it).

import assert from 'node:assert/strict'
import type { Page } from 'playwright'
import { notesOf } from '../../src/core/score/model.ts'
import { parseMusicXml } from '../../src/core/score/musicxml.ts'

/** The note ids of each bar of [musicxml], as the app's parser assigns them. */
export function noteIdsByBar(musicxml: string): string[][] {
  return parseMusicXml(musicxml).measures.map((m) => notesOf(m).filter((n) => !n.rest).map((n) => n.id))
}

/** Taps the centre of the rendered note [id] with the touchscreen, scrolling it into view first. */
export async function tapNote(page: Page, id: string): Promise<void> {
  const note = page.locator(`.score-view svg g.note[id="${id}"]`)
  await note.scrollIntoViewIfNeeded()
  const box = await note.boundingBox()
  assert.ok(box, `note ${id} is not rendered`)
  await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2)
}

/** The id of the note the playback cursor highlights, or null. */
export const highlighted = (page: Page): Promise<string | null> =>
  page.evaluate(() => document.querySelector('.score-view g.note.hl')?.id ?? null)

// ---- The shell: tabs ----------------------------------------------------------------------------

/** The tab bar, in English. */
export const tabBar = (page: Page, name = 'Main areas') => page.getByRole('navigation', { name })

/** One tab of the tab bar. */
export const tab = (page: Page, name: 'Practice' | 'Library' | 'Settings') => tabBar(page).getByRole('button', { name })

/** The page's text between two landmarks, for a check that the screens show what the specs say. */
export const textOf = async (locator: ReturnType<Page['locator']>): Promise<string> => ((await locator.innerText()) ?? '').replace(/\s+/g, ' ').trim()
