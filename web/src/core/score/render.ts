import type { VerovioToolkit } from "verovio/esm";
import type { Score } from "./model.ts";
import { firstVoice, voiceView, voices } from "./model.ts";
import { beamScore } from "./beams.ts";
import type { BeamMark } from "./beams.ts";
import { serializeMusicXml } from "./musicxml.ts";
import type { MultiRests } from "./noteMap.ts";

/**
 * Renders the score model with Verovio (design D7): the model is serialised to MusicXML and
 * engraved to SVG in written pitch. The toolkit (a WebAssembly module bundled with the app)
 * is loaded once, lazily, on the first render.
 */

export interface RenderOptions {
  /** Available width in CSS pixels. */
  width: number;
  /** Verovio scale in percent; the page is laid out `width * 100 / scale` units wide. */
  scale?: number;
  /** A multi-measure rest that still holds: one symbol (`collapse`, practice) or bar by bar (`expand`, the editor). Default `collapse`. */
  multiRests?: MultiRests;
  /** The parts to draw, by id (`SerializeOptions.parts`): practice draws your part only, a two-staff part as a grand staff (change parts-and-accompaniment, D7). The first part when absent (the editor). */
  parts?: string[];
  /**
   * Lay the score out as one bar large in a box `width` x `height` (the editor's large bar, change redesign-score-editor
   * D2): the page is cropped to the music, and when the music alone is narrower than the box, it is laid out again
   * stretched to the box's proportions, so that it fills the width at the height it has. The SVG has a view box only,
   * so the page sizes it.
   */
  fit?: { height: number };
}

export const DEFAULT_SCALE = 40;

/** The widest page a fitted bar is laid out on, in Verovio's units at scale 100. */
const FIT_PAGE_WIDTH = 4000;

/** The width and height of an SVG page's view box, or zeros. */
function viewBox(svg: string): [number, number] {
  const m = /viewBox="[\d.-]+ [\d.-]+ ([\d.]+) ([\d.]+)"/.exec(svg);
  return m ? [Number(m[1]), Number(m[2])] : [0, 0];
}

let toolkit: Promise<VerovioToolkit> | undefined;

/** Loads the Verovio toolkit once. */
export function loadToolkit(): Promise<VerovioToolkit> {
  toolkit ??= (async () => {
    const [{ default: createVerovioModule }, { VerovioToolkit }] = await Promise.all([import("verovio/wasm"), import("verovio/esm")]);
    return new VerovioToolkit(await createVerovioModule());
  })();
  toolkit.catch(() => {
    toolkit = undefined;
  });
  return toolkit;
}

/** Engraves [score] as one or more SVG pages (one page for any normal exercise). */
export async function renderScore(score: Score, options: RenderOptions): Promise<string[]> {
  const tk = await loadToolkit();
  const scale = options.fit ? 100 : (options.scale ?? DEFAULT_SCALE);
  const pageWidth = options.fit ? FIT_PAGE_WIDTH : Math.max(300, Math.round((options.width * 100) / scale));
  tk.setOptions({
    scale,
    pageWidth,
    pageHeight: 60000,
    adjustPageHeight: true,
    adjustPageWidth: options.fit !== undefined,
    minLastJustification: 0.8,
    breaks: "auto",
    header: "none",
    footer: "none",
    svgViewBox: true,
    pageMarginLeft: 20,
    pageMarginRight: 20,
    pageMarginTop: 40,
    pageMarginBottom: 40,
  });
  // No part-name label or title: they only cost width on a phone (the app shows the name itself).
  // Beams are added for display only (homr writes none; see beams.ts), and so are the ids that let a
  // tap on a clef, slur, tie or hairpin be traced back to the model (elements.ts).
  const drawn = options.parts ?? [firstVoice(score).part];
  const first = { ...score, parts: score.parts.map((p) => ({ ...p, name: "" })) };
  delete first.title;
  const beams = new Map<string, BeamMark[]>();
  for (const ref of voices(score)) {
    if (!drawn.includes(ref.part)) continue;
    for (const [id, marks] of beamScore(voiceView(score, ref))) beams.set(id, marks);
  }
  if (!tk.loadData(serializeMusicXml(first, { beams, drawingIds: true, multiRests: options.multiRests ?? "collapse", parts: drawn }))) throw new Error("Verovio could not read the score");
  if (options.fit) {
    // The music at its own width first; narrower than the box, it is stretched to the box's proportions (the last, only
    // line justified to the page width).
    const [w, h] = viewBox(tk.renderToSVG(1));
    const box = options.width / Math.max(1, options.fit.height);
    if (w > 0 && h > 0 && w / h < box) {
      tk.setOptions({ pageWidth: Math.min(FIT_PAGE_WIDTH, Math.round(h * box)), adjustPageWidth: false, minLastJustification: 0 });
      tk.redoLayout();
    }
  }
  const pages: string[] = [];
  for (let page = 1; page <= tk.getPageCount(); page++) pages.push(tk.renderToSVG(page));
  return pages;
}
