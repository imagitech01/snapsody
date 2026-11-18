import { type NoteIndex, type NoteInfo, indexScore, unmappedNotes } from "../core/score/noteMap.ts";
import type { Score } from "../core/score/model.ts";
import { renderScore } from "../core/score/render.ts";

/**
 * The rendered score in the page (tasks 9.1 and 9.2): one column of SVG, re-laid out when the width
 * changes. Offers the small API the score island (scoreIsland.ts, practice-app task 11.3) builds on:
 * note id to SVG elements (highlighting, cursor), the bar a note is in and the bar's drawing, and a tap
 * handler that resolves a tap to the model note.
 *
 * Nothing here is global and a tap changes nothing in the drawing: what a tap means (start here, select
 * this note) is the caller's, and the playback highlight is never cleared by this module.
 */

export interface TappedNote {
  id: string;
  bar: string;
  barIndex: number;
  /** "G4", "B♭4", "rest". */
  pitch: string;
  /** Printed value, e.g. "quarter" or "eighth.", and the exact length as a fraction of a whole note. */
  duration: string;
  fraction: string;
}

/** Persistent mark kinds: playback start, loop, a flagged note, the notes of a flagged bar, the edit selection. */
export type MarkKind = "start" | "loop" | "flag" | "flagbar" | "sel";
const MARK_KINDS: MarkKind[] = ["start", "loop", "flagbar", "flag", "sel"];

export interface ScoreView {
  readonly element: HTMLElement;
  /** The SVG groups drawing the note with this id (empty when unknown). */
  elementsFor(noteId: string): SVGGElement[];
  /** The model note for an element inside the score, or the nearest note within a finger's reach of a point. */
  noteAtPoint(clientX: number, clientY: number): NoteInfo | undefined;
  /** The index (from 0) of the bar a note is in, or undefined for an unknown id. */
  barOf(noteId: string): number | undefined;
  /** The number of bars of the score. */
  readonly barCount: number;
  /** The SVG group that draws a bar (from 0), once it is rendered: its staff, notes and bar lines. */
  barElement(barIndex: number): SVGGElement | undefined;
  /** The id of the first note (or rest) of a bar (from 0). */
  firstNoteOf(barIndex: number): string | undefined;
  highlight(noteIds: string[]): void;
  clearHighlight(): void;
  /**
   * Persistent marks (they survive a re-render): "start" for the note playback starts from, "loop" for
   * the notes of the looped bars. Replaces the earlier marks of that kind.
   */
  mark(kind: MarkKind, noteIds: string[]): void;
  /** Called for every tap that resolves to a note. */
  onTap: ((info: NoteInfo) => void) | undefined;
  /**
   * Called just before a new layout replaces the drawing (the width changed, or the score did), while the
   * old one can still be measured, and right after, when the new one is in place and has lost its
   * highlight. The caller keeps its view of the score across a re-layout with these two.
   */
  onBeforeRender: (() => void) | undefined;
  onRender: (() => void) | undefined;
  /** Replaces the score (e.g. after an edit) and re-renders. */
  setScore(score: Score): Promise<void>;
  /** Settles when the first layout is drawn (or was skipped because the view has no width yet). */
  readonly rendered: Promise<void>;
  /** Milliseconds the last render took, and its page count. */
  readonly lastRender: { ms: number; pages: number; width: number } | undefined;
  dispose(): void;
}

const REACH_PX = 28;

const NOTE_SELECTOR = "g.note, g.rest, g.mRest";

export function describeNote(info: NoteInfo): TappedNote {
  const { note } = info;
  let pitch = "rest";
  if (note.pitch) {
    const alter = note.pitch.alter ?? 0;
    pitch = `${note.pitch.step}${alter > 0 ? "♯".repeat(alter) : alter < 0 ? "♭".repeat(-alter) : ""}${note.pitch.octave}`;
  }
  return {
    id: note.id,
    bar: info.bar,
    barIndex: info.barIndex,
    pitch,
    duration: `${note.type ?? "?"}${".".repeat(note.dots)}`,
    fraction: `${note.duration.n}/${note.duration.d}`,
  };
}

/** The hooks a caller can give before the first layout, so it does not miss that one. */
export type ScoreViewHooks = Partial<Pick<ScoreView, "onTap" | "onBeforeRender" | "onRender">>;

/** Mounts the score in [container] and starts the first layout; `view.rendered` settles when it is drawn. */
export async function showScore(container: HTMLElement, initial: Score): Promise<ScoreView> {
  const view = createScoreView(container, initial);
  await view.rendered;
  return view;
}

/** Like `showScore`, but returns the view at once, with hooks in place before the first layout. */
export function createScoreView(container: HTMLElement, initial: Score, hooks: ScoreViewHooks = {}): ScoreView {
  let score = initial;
  let index: NoteIndex = indexScore(score);
  let renderedWidth = 0;
  let pendingWidth = 0;
  let generation = 0;
  let highlighted: SVGGElement[] = [];
  const marks = new Map<string, Set<string>>();
  let lastRender: ScoreView["lastRender"];

  const element = document.createElement("div");
  element.className = "score-view";
  container.replaceChildren(element);

  const elementsFor = (id: string): SVGGElement[] => {
    if (!index.has(id)) return [];
    const escaped = CSS.escape(id);
    return [...element.querySelectorAll<SVGGElement>(`g.note[id="${escaped}"], g.rest[id="${escaped}"], g.mRest[id="${escaped}"]`)];
  };

  const clearHighlight = () => {
    for (const g of highlighted) g.classList.remove("hl");
    highlighted = [];
  };

  const applyMarks = () => {
    const groups = [...element.querySelectorAll<SVGGElement>(NOTE_SELECTOR)];
    for (const g of groups) g.classList.remove(...MARK_KINDS.map((k) => `mk-${k}`));
    for (const [kind, ids] of marks) {
      for (const g of groups) if (ids.has(g.id)) g.classList.add(`mk-${kind}`);
    }
  };

  const render = async (force = false) => {
    const width = Math.floor(element.clientWidth);
    if (width <= 0) return;
    if (!force && (width === renderedWidth || width === pendingWidth)) return;
    pendingWidth = width;
    const mine = ++generation;
    const started = performance.now();
    const pages = await renderScore(score, { width });
    if (mine !== generation) return;
    const ms = Math.round(performance.now() - started);
    view.onBeforeRender?.();
    element.innerHTML = pages.join("");
    renderedWidth = width;
    pendingWidth = 0;
    lastRender = { ms, pages: pages.length, width };
    highlighted = [];
    applyMarks();
    element.dataset.rendered = "true";
    const missing = unmappedNotes(pages.join(""), index);
    element.dataset.unmapped = String(missing.length);
    if (missing.length > 0) console.warn(`score view: ${missing.length} model notes have no rendered element`, missing);
    view.onRender?.();
  };

  const noteAtPoint = (x: number, y: number): NoteInfo | undefined => {
    const direct = document.elementFromPoint(x, y)?.closest<SVGGElement>(NOTE_SELECTOR);
    if (direct && element.contains(direct)) {
      const info = index.get(direct.id);
      if (info) return info;
    }
    let best: NoteInfo | undefined;
    let bestDistance = REACH_PX;
    for (const g of element.querySelectorAll<SVGGElement>(NOTE_SELECTOR)) {
      const info = index.get(g.id);
      if (!info) continue;
      const r = g.getBoundingClientRect();
      const dx = Math.max(r.left - x, 0, x - r.right);
      const dy = Math.max(r.top - y, 0, y - r.bottom);
      const d = Math.hypot(dx, dy);
      if (d < bestDistance) {
        best = info;
        bestDistance = d;
      }
    }
    return best;
  };

  const firstNotes = (): string[] => {
    const first: string[] = [];
    for (const [id, info] of index) if (first[info.barIndex] === undefined) first[info.barIndex] = id;
    return first;
  };
  let firstOfBar = firstNotes();

  const view: ScoreView = {
    element,
    elementsFor,
    noteAtPoint,
    barOf: (id) => index.get(id)?.barIndex,
    get barCount() {
      return score.measures.length;
    },
    firstNoteOf: (barIndex) => firstOfBar[barIndex],
    barElement(barIndex) {
      const id = firstOfBar[barIndex];
      return id === undefined ? undefined : (elementsFor(id)[0]?.closest<SVGGElement>("g.measure") ?? undefined);
    },
    highlight(ids) {
      clearHighlight();
      highlighted = ids.flatMap(elementsFor);
      for (const g of highlighted) g.classList.add("hl");
    },
    clearHighlight,
    mark(kind, ids) {
      marks.set(kind, new Set(ids));
      applyMarks();
    },
    onTap: hooks.onTap,
    onBeforeRender: hooks.onBeforeRender,
    onRender: hooks.onRender,
    get rendered() {
      return firstRender;
    },
    async setScore(next) {
      score = next;
      index = indexScore(score);
      firstOfBar = firstNotes();
      await render(true);
    },
    get lastRender() {
      return lastRender;
    },
    dispose() {
      generation++;
      window.clearTimeout(resizeTimer);
      observer.disconnect();
    },
  };

  element.addEventListener("click", (event) => {
    const info = noteAtPoint(event.clientX, event.clientY);
    if (info) view.onTap?.(info);
  });

  // Re-lay out when the width changes (rotation, window resize), not for height changes.
  let resizeTimer: number | undefined;
  const observer = new ResizeObserver(() => {
    window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(() => {
      void render();
    }, 150);
  });
  observer.observe(element);

  const firstRender = render(true);
  return view;
}
