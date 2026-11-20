import type { MultiRestRun, Note, VoiceScore } from "./model.ts";
import { isNote, multiRestRuns, partIndex, partMultiRestRuns } from "./model.ts";

/**
 * Maps rendered notes back to the score model (task 9.2, design D7).
 *
 * Verovio keeps the MusicXML `<note id>` as the `id` of the SVG `<g class="note">` (or
 * `<g class="rest">` or `<g class="mRest">`), and the model writes its stable note id on every `<note>`. So the
 * mapping is the identity on ids; this module indexes the model and checks that the
 * rendered SVG really contains an element for every model note. The one exception is a collapsed
 * multi-measure rest: Verovio draws the run as one `g.multiRest` with an id of its own, so every rest of
 * the run maps to that one group (`DrawnBars`).
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
export function indexScore(score: VoiceScore): NoteIndex {
  const index: NoteIndex = new Map();
  score.measures.forEach((measure, barIndex) => {
    for (const item of measure.items) {
      // A hidden rest (a `<forward>`) is not drawn, so it is not in the index (parts-and-accompaniment, design D10).
      if (isNote(item) && !item.hidden) index.set(item.id, { note: item, bar: measure.number, barIndex, index: index.size });
    }
  });
  return index;
}

/** Whether a multi-measure rest that still holds is drawn as one symbol (practice) or bar by bar (the editor). */
export type MultiRests = "collapse" | "expand";

/**
 * The one table from bars of the model to the measures Verovio draws (design D5). A collapsed run of n
 * bars is one drawn measure, so every bar after it is drawn one or more measures earlier than its
 * position says. Whatever looks up a bar by its position among the drawn `g.measure` groups (the line of
 * a bar, a bar's box, the bars of a line) asks this, and never counts measures as bars. Which runs hold is
 * `multiRestRuns`; when expanding, the table is the identity.
 */
export interface DrawnBars {
  /** The drawn measure (from 0, in drawing order) that draws each bar (from 0). */
  readonly measureOf: readonly number[];
  /** The bars (from 0) each drawn measure draws: the first, and how many. */
  readonly barsOf: readonly { first: number; count: number }[];
  /** The collapsed run that holds the bar, if it is in one. */
  runOf(barIndex: number): MultiRestRun | undefined;
  /** The collapsed runs, in score order. */
  readonly runs: readonly MultiRestRun[];
}

export function drawnBars(score: VoiceScore, multiRests: MultiRests): DrawnBars {
  // A run holds for the part: every staff and voice of it rests (`partMultiRestRuns`), as the writer decides.
  const runs = multiRests !== "collapse" ? [] : score.of ? partMultiRestRuns(score.of.score, partIndex(score.of.score, score.of.ref.part)) : multiRestRuns(score);
  const measureOf: number[] = [];
  const barsOf: { first: number; count: number }[] = [];
  let bar = 0;
  while (bar < score.measures.length) {
    const run = runs.find((r) => r.start === bar);
    const count = run ? run.length : 1;
    barsOf.push({ first: bar, count });
    for (let k = 0; k < count; k++) measureOf.push(barsOf.length - 1);
    bar += count;
  }
  return { measureOf, barsOf, runs, runOf: (barIndex) => runs.find((r) => r.start <= barIndex && barIndex < r.start + r.length) };
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
 * keeping their id) so they are looked up by id in any element class. With the table of a collapsed
 * drawing (`bars`), the rests of a run count as drawn when the run's `g.multiRest` is.
 */
export function unmappedNotes(svg: string, index: NoteIndex, bars?: DrawnBars): string[] {
  const present = new Set<string>();
  for (const m of svg.matchAll(/\bid="([^"]*)"/g)) present.add(m[1]!);
  const runs = bars?.runs ?? [];
  // The rests of a collapsed run have no id in the drawing: they map to the run's `g.multiRest`, in order.
  const drawnRuns = (svg.match(/<g\b[^>]*\bclass="multiRest"/g) ?? []).length;
  const inRun = (info: NoteInfo): boolean => {
    const run = bars?.runOf(info.barIndex);
    return run !== undefined && runs.indexOf(run) < drawnRuns;
  };
  return [...index.entries()].filter(([id, info]) => !present.has(id) && !inRun(info)).map(([id]) => id);
}
