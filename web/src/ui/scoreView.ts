import { type DrawnBars, type MultiRests, type NoteIndex, type NoteInfo, drawnBars, indexScore, unmappedNotes } from "../core/score/noteMap.ts";
import type { Score } from "../core/score/model.ts";
import { firstVoice, voiceView, voices } from "../core/score/model.ts";
import { renderScore } from "../core/score/render.ts";
import { mapElements, sameElement } from "../core/score/elements.ts";
import type { ElementRef, SvgTree } from "../core/score/elements.ts";
import { linesOf } from "../core/score/lines.ts";
import type { LineBars } from "../core/score/lines.ts";

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
  /** The lines of the drawing, with the bars (from 0) each holds (`linesOf`); empty before the first layout. */
  readonly lines: readonly LineBars[];
  /** The SVG group that draws the line (Verovio's `g.system`) holding a bar (from 0), once it is rendered. */
  lineElement(barIndex: number): SVGGElement | undefined;
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
   * Opt-in element hit-testing (the editor; change select-and-delete-elements, design D2). When set, a tap
   * first looks for the element drawn under the finger (a clef, a dynamic, a slur, an articulation, a bar
   * line, ...) and calls this with its reference; a tap that finds no element but a note still calls `onTap`;
   * a tap that finds neither calls this with undefined. When unset, taps resolve to notes only, as in practice.
   */
  onTapElement: ((ref: ElementRef | undefined) => void) | undefined;
  /** The element drawn directly under a point (the smallest when several overlap), or undefined. */
  elementAtPoint(clientX: number, clientY: number): ElementRef | undefined;
  /** Highlights the drawing of an element (every node that draws it), or none for undefined. Survives a re-render. */
  markElement(ref: ElementRef | undefined): void;
  /**
   * Called just before a new layout replaces the drawing (the width changed, or the score did), while the
   * old one can still be measured, and right after, when the new one is in place and has lost its
   * highlight. The caller keeps its view of the score across a re-layout with these two.
   */
  onBeforeRender: (() => void) | undefined;
  onRender: (() => void) | undefined;
  /** Replaces the score (e.g. after an edit) and re-renders. */
  setScore(score: Score): Promise<void>;
  /** Draws another part (or the same part with another hand faded) and re-renders; the first part for undefined. */
  setPart(part: DrawnPart | undefined): Promise<void>;
  /** Settles when the first layout is drawn (or was skipped because the view has no width yet). */
  readonly rendered: Promise<void>;
  /** Milliseconds the last render took, and its page count. */
  readonly lastRender: { ms: number; pages: number; width: number } | undefined;
  dispose(): void;
}

const REACH_PX = 28;

const NOTE_SELECTOR = "g.note, g.rest, g.mRest, g.multiRest";

/** How far from a thin or tiny element (a bar line, a staccato dot) a tap still counts as on it. */
const ELEMENT_SLOP_PX = 6;
/** The elements whose box says nothing about where they are painted: a slur, tie or hairpin spans the notes under it. */
const SPANNERS = new Set(["slur", "tie", "wedge"]);

/** `mapElements` over the DOM: the first glyph is the SMuFL code point of the first `<use href="#E4A2-...">`. */
const DOM_TREE: SvgTree<Element> = {
  classes: (node) => [...node.classList],
  id: (node) => node.id,
  children: (node) => [...node.children],
  glyph: (node) => {
    const use = node.querySelector("use");
    const href = use?.getAttribute("href") ?? use?.getAttributeNS("http://www.w3.org/1999/xlink", "href") ?? "";
    return /^#([0-9A-Fa-f]+)-/.exec(href)?.[1]?.toUpperCase();
  },
};

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

/** The part the view draws, and the hand played (the other staff of a two-staff part is faded). */
export interface DrawnPart {
  id: string;
  hand?: "right" | "left";
}

/** The class on the `g.staff` that is not the hand played (practice, design D7); `score.css` fades it. */
export const FADED_STAFF = "staff-faded";

/** The hooks a caller can give before the first layout, so it does not miss that one. */
export type ScoreViewHooks = Partial<Pick<ScoreView, "onTap" | "onTapElement" | "onBeforeRender" | "onRender">> & {
  /** The part to draw (practice: your part): a part id, and for a two-staff part possibly the hand you play, the other staff is faded. Absent: the first part. */
  part?: DrawnPart;
  /** A multi-measure rest that still holds: one symbol (`collapse`, the default: practice) or bar by bar (`expand`: the editor). */
  multiRests?: MultiRests;
};

/** Mounts the score in [container] and starts the first layout; `view.rendered` settles when it is drawn. */
export async function showScore(container: HTMLElement, initial: Score): Promise<ScoreView> {
  const view = createScoreView(container, initial);
  await view.rendered;
  return view;
}

/** Like `showScore`, but returns the view at once, with hooks in place before the first layout. */
export function createScoreView(container: HTMLElement, initial: Score, hooks: ScoreViewHooks = {}): ScoreView {
  let score = initial;
  let part: DrawnPart | undefined = hooks.part;
  /** The voices that are drawn: every voice of the part shown (its two staves, its second voices), the first part when none is named or it is not in the score. */
  const drawnVoices = () => {
    const refs = part ? voices(score).filter((r) => r.part === part!.id) : [];
    return refs.length > 0 ? refs : [firstVoice(score)];
  };
  /** The voice the bars follow: the first of the drawn part (every voice has every bar). */
  const lineRef = () => drawnVoices()[0]!;
  // The first voice of the drawn part is what the bars follow (`drawnBars`, the editor's elements); the note map holds every drawn voice.
  let line = voiceView(score, lineRef());
  const indexOf = (): NoteIndex => {
    const merged: NoteIndex = new Map();
    for (const ref of drawnVoices()) for (const [id, info] of indexScore(voiceView(score, ref))) merged.set(id, { ...info, index: merged.size });
    return merged;
  };
  const multiRests: MultiRests = hooks.multiRests ?? "collapse";
  let index: NoteIndex = indexOf();
  /** Which drawn measure draws each bar (design D5); every bar looked up by its position goes through it. */
  let bars: DrawnBars = drawnBars(line, multiRests);
  let renderedWidth = 0;
  let pendingWidth = 0;
  let generation = 0;
  let highlighted: SVGGElement[] = [];
  /** What each drawn element is, rebuilt after every render: Verovio's own ids change each time. */
  let elementMap = new Map<Element, ElementRef>();
  let markedElement: ElementRef | undefined;
  /** The lines of the drawing, and each drawn measure in drawing order (a collapsed multi-measure rest is one for all its bars: `bars`). */
  let lines: LineBars[] = [];
  let measureNodes: SVGGElement[] = [];
  const marks = new Map<string, Set<string>>();
  let lastRender: ScoreView["lastRender"];

  const element = document.createElement("div");
  element.className = "score-view";
  container.replaceChildren(element);

  /** The `g.multiRest` that draws a collapsed run, found by its first bar's drawn measure. */
  const multiRestOf = (barIndex: number): SVGGElement[] => {
    const group = measureNodes[bars.measureOf[barIndex] ?? -1]?.querySelector<SVGGElement>("g.multiRest");
    return group ? [group] : [];
  };

  /** The note ids a drawn group stands for: its own, or every rest of the run for a `g.multiRest` (whose id is Verovio's). */
  const idsOfGroup = (g: Element): string[] => {
    if (!g.classList.contains("multiRest")) return [g.id];
    const first = bars.barsOf[measureNodes.indexOf(g.closest<SVGGElement>("g.measure")!)];
    if (!first) return [];
    return [...index.entries()].filter(([, info]) => first.first <= info.barIndex && info.barIndex < first.first + first.count).map(([id]) => id);
  };

  /** The model note a drawn group is: the first rest of the run for a `g.multiRest`. */
  const infoOfGroup = (g: Element): NoteInfo | undefined => {
    if (!g.classList.contains("multiRest")) return index.get(g.id);
    const id = firstOfBar[bars.barsOf[measureNodes.indexOf(g.closest<SVGGElement>("g.measure")!)]?.first ?? -1];
    return id === undefined ? undefined : index.get(id);
  };

  const elementsFor = (id: string): SVGGElement[] => {
    const info = index.get(id);
    if (!info) return [];
    if (bars.runOf(info.barIndex)) return multiRestOf(info.barIndex);
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
      for (const g of groups) if (idsOfGroup(g).some((id) => ids.has(id))) g.classList.add(`mk-${kind}`);
    }
  };

  const applyElementMark = () => {
    for (const el of element.querySelectorAll(".mk-el")) el.classList.remove("mk-el");
    if (!markedElement) return;
    for (const [node, ref] of elementMap) if (sameElement(ref, markedElement)) node.classList.add("mk-el");
  };

  /** With one hand of a two-staff part played, the other staff of each measure is faded, by its position in the measure (design D7). */
  const fadeOtherHand = () => {
    const hand = part?.hand;
    const two = score.parts.find((p) => p.id === drawnVoices()[0]!.part)?.staves === 2;
    for (const measure of element.querySelectorAll("g.measure")) {
      const staves = [...measure.children].filter((c) => c.matches("g.staff"));
      staves.forEach((staff, i) => staff.classList.toggle(FADED_STAFF, two && hand !== undefined && i !== (hand === "right" ? 0 : 1)));
    }
  };

  const render = async (force = false) => {
    const width = Math.floor(element.clientWidth);
    if (width <= 0) return;
    if (!force && (width === renderedWidth || width === pendingWidth)) return;
    pendingWidth = width;
    const mine = ++generation;
    const started = performance.now();
    const pages = await renderScore(score, { width, multiRests, ...(part ? { parts: [drawnVoices()[0]!.part] } : {}) });
    if (mine !== generation) return;
    const ms = Math.round(performance.now() - started);
    view.onBeforeRender?.();
    element.innerHTML = pages.join("");
    renderedWidth = width;
    pendingWidth = 0;
    lastRender = { ms, pages: pages.length, width };
    highlighted = [];
    applyMarks();
    // The elements of every staff and voice of the drawn part (change edit-parts): a left-hand clef is the left hand's.
    elementMap = view.onTapElement ? mapElements<Element>(element, DOM_TREE, { score, part: lineRef().part }, bars) : new Map();
    lines = linesOf<Element>(element, DOM_TREE, bars);
    measureNodes = [...element.querySelectorAll<SVGGElement>("g.measure")];
    fadeOtherHand();
    applyElementMark();
    element.dataset.rendered = "true";
    const missing = unmappedNotes(pages.join(""), index, bars);
    element.dataset.unmapped = String(missing.length);
    if (missing.length > 0) console.warn(`score view: ${missing.length} model notes have no rendered element`, missing);
    view.onRender?.();
  };

  const noteAtPoint = (x: number, y: number): NoteInfo | undefined => {
    const direct = document.elementFromPoint(x, y)?.closest<SVGGElement>(NOTE_SELECTOR);
    if (direct && element.contains(direct)) {
      const info = infoOfGroup(direct);
      if (info) return info;
    }
    let best: NoteInfo | undefined;
    let bestDistance = REACH_PX;
    for (const g of element.querySelectorAll<SVGGElement>(NOTE_SELECTOR)) {
      const info = infoOfGroup(g);
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

  /** The mapped element drawn at a point: painted geometry first (a slur's box over a note does not count), then a small slop for thin or tiny ones. */
  const elementAtPoint = (x: number, y: number): ElementRef | undefined => {
    if (elementMap.size === 0) return undefined;
    const painted = new Map<Element, DOMRect>();
    for (const hit of document.elementsFromPoint(x, y)) {
      if (!element.contains(hit)) continue;
      for (let node: Element | null = hit; node && node !== element; node = node.parentElement) {
        if (elementMap.has(node)) painted.set(node, node.getBoundingClientRect());
      }
    }
    const area = (r: DOMRect) => r.width * r.height;
    let best: Element | undefined;
    for (const [node, r] of painted) if (!best || area(r) < area(painted.get(best)!)) best = node;
    if (best) return elementMap.get(best);
    // A note under the finger beats the slop: a staccato dot next to a note head must not take the note's taps.
    const direct = document.elementFromPoint(x, y)?.closest(NOTE_SELECTOR);
    if (direct && element.contains(direct)) return undefined;
    // Then the box of a glyph or line, with a little slop: a clef's or a bar line's own painting is thin or has gaps.
    // A note that is as near or nearer keeps the tap, so that the slop never takes a note's taps (the middle of a note's
    // box is often empty, and a bar line or an articulation may be a few pixels away).
    const distance = (r: DOMRect) => Math.hypot(Math.max(r.left - x, 0, x - r.right), Math.max(r.top - y, 0, y - r.bottom));
    const nearest = (selector: string) => {
      let d = Infinity;
      for (const g of element.querySelectorAll<SVGGElement>(selector)) d = Math.min(d, distance(g.getBoundingClientRect()));
      return d;
    };
    const noteDistance = nearest(NOTE_SELECTOR);
    // An articulation is drawn inside its note, so the note's box always holds it: for one, only note heads and rests count.
    let headDistance: number | undefined;
    let near: Element | undefined;
    let nearDistance = ELEMENT_SLOP_PX;
    let nearArea = Infinity;
    for (const [node, ref] of elementMap) {
      if (SPANNERS.has(ref.kind)) continue;
      const r = node.getBoundingClientRect();
      const d = distance(r);
      if (d > ELEMENT_SLOP_PX) continue;
      const gate = ref.kind === "articulation" ? (headDistance ??= nearest("g.notehead, g.rest, g.mRest")) : noteDistance;
      if (d >= gate) continue;
      if (d < nearDistance || (d === nearDistance && near && area(r) < nearArea)) {
        near = node;
        nearDistance = d;
        nearArea = area(r);
      }
    }
    return near ? elementMap.get(near) : undefined;
  };

  const firstNotes = (): string[] => {
    const first: string[] = [];
    for (const [id, info] of index) if (first[info.barIndex] === undefined) first[info.barIndex] = id;
    return first;
  };
  let firstOfBar = firstNotes();

  /** What follows the score or the part shown: the lines, the note map and the bars, then the drawing. */
  const relayout = async () => {
    line = voiceView(score, lineRef());
    index = indexOf();
    bars = drawnBars(line, multiRests);
    firstOfBar = firstNotes();
    await render(true);
  };

  const view: ScoreView = {
    element,
    elementsFor,
    noteAtPoint,
    barOf: (id) => index.get(id)?.barIndex,
    get barCount() {
      return score.bars.length;
    },
    firstNoteOf: (barIndex) => firstOfBar[barIndex],
    get lines() {
      return lines;
    },
    lineElement: (barIndex) => measureNodes[bars.measureOf[barIndex] ?? -1]?.closest<SVGGElement>("g.system") ?? undefined,
    barElement: (barIndex) => measureNodes[bars.measureOf[barIndex] ?? -1],
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
    onTapElement: hooks.onTapElement,
    elementAtPoint,
    markElement(ref) {
      markedElement = ref;
      applyElementMark();
    },
    onBeforeRender: hooks.onBeforeRender,
    onRender: hooks.onRender,
    get rendered() {
      return firstRender;
    },
    async setScore(next) {
      score = next;
      await relayout();
    },
    async setPart(next) {
      if (next?.id === part?.id && next?.hand === part?.hand) return;
      part = next;
      await relayout();
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
    if (view.onTapElement) {
      const ref = elementAtPoint(event.clientX, event.clientY);
      if (ref) {
        view.onTapElement(ref);
        return;
      }
      const info = noteAtPoint(event.clientX, event.clientY);
      if (info) view.onTap?.(info);
      else view.onTapElement(undefined);
      return;
    }
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
