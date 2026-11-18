import type { Note, Score } from "./model.ts";
import { isNote } from "./model.ts";

/**
 * Maps rendered notes back to the score model (task 9.2, design D7).
 *
 * Verovio keeps the MusicXML `<note id>` as the `id` of the SVG `<g class="note">` (or
 * `<g class="rest">` or `<g class="mRest">`), and the model writes its stable note id on every `<note>`. So the
 * mapping is the identity on ids; this module indexes the model and checks that the
 * rendered SVG really contains an element for every model note.
 */

export interface NoteInfo {
  note: Note;
  /** Printed measure number. */
  bar: string;
  /** Index of the measure in score.measures. */
  barIndex: number;
  /** Index of the note among the notes (and rests) of the whole score. */
  index: number;
}

export type NoteIndex = Map<string, NoteInfo>;

/** Every note and rest of the score by id. */
export function indexScore(score: Score): NoteIndex {
  const index: NoteIndex = new Map();
  score.measures.forEach((measure, barIndex) => {
    for (const item of measure.items) {
      if (isNote(item)) index.set(item.id, { note: item, bar: measure.number, barIndex, index: index.size });
    }
  });
  return index;
}

/** The ids of the note, rest and whole-measure-rest groups of a Verovio SVG, in document order. */
export function renderedNoteIds(svg: string): string[] {
  const ids: string[] = [];
  for (const m of svg.matchAll(/<g\b[^>]*>/g)) {
    const tag = m[0];
    const cls = /\bclass="([^"]*)"/.exec(tag)?.[1]?.split(/\s+/) ?? [];
    if (!cls.includes("note") && !cls.includes("rest") && !cls.includes("mRest")) continue;
    const id = /\bid="([^"]*)"/.exec(tag)?.[1];
    if (id) ids.push(id);
  }
  return ids;
}

/**
 * Model notes that have no rendered element. Whole-measure rests are drawn as `mRest` (also
 * keeping their id) so they are looked up by id in any element class.
 */
export function unmappedNotes(svg: string, index: NoteIndex): string[] {
  const present = new Set<string>();
  for (const m of svg.matchAll(/\bid="([^"]*)"/g)) present.add(m[1]!);
  return [...index.keys()].filter((id) => !present.has(id));
}
