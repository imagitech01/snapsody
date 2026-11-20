import type { VerovioToolkit } from "verovio/esm";
import type { Score } from "./model.ts";
import { beamScore } from "./beams.ts";
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
}

export const DEFAULT_SCALE = 40;

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
  const scale = options.scale ?? DEFAULT_SCALE;
  const pageWidth = Math.max(300, Math.round((options.width * 100) / scale));
  tk.setOptions({
    scale,
    pageWidth,
    pageHeight: 60000,
    adjustPageHeight: true,
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
  if (!tk.loadData(serializeMusicXml({ ...score, partName: "", title: undefined }, { beams: beamScore(score), drawingIds: true, multiRests: options.multiRests ?? "collapse" }))) throw new Error("Verovio could not read the score");
  const pages: string[] = [];
  for (let page = 1; page <= tk.getPageCount(); page++) pages.push(tk.renderToSVG(page));
  return pages;
}
