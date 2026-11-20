/*
 * Licence texts for the Licence screen (change paper-and-ink-and-about, "Decisions made during apply": the
 * screen scrolls as a whole and the texts are reflowed). The files in `public/licences/` keep their authors'
 * hard line breaks at about 78 columns, which wrap badly on a 360px phone. A blank line separates paragraphs;
 * the lines inside a paragraph are joined with one space, and runs of spaces become one. The words are untouched.
 */

/** The paragraphs of a licence text, in order, each on one line. */
export function reflowLicence(text: string): string[] {
  return text
    .replace(/\r\n?/g, '\n')
    .split(/\n[ \t]*\n/)
    .map((paragraph) => paragraph.replace(/\s+/g, ' ').trim())
    .filter((paragraph) => paragraph !== '')
}

/** Where a component's licence file is served from: its own origin, next to the app, so it works offline. */
export const licenceUrl = (file: string, base: string = document.baseURI): string => new URL(`licences/${file}`, base).href
