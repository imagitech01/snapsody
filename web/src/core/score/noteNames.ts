import type { Pitch, Step } from './model.ts'

/*
 * Note names as a person reads them (change redesign-score-editor, design D9; spec `app-shell` "Note names"):
 * with letters (C D E F G A B) or with do re mi (Do Re Mi Fa Sol La Si, Do = C). Both carry the accidental
 * after the name, as ♯ and ♭, and the same octave number, so C4 is Do4, B♭3 is Si♭3 and F♯5 is Fa♯5.
 *
 * The style only changes the name: never the music, how it is drawn or how it sounds. The English `message`
 * of a warning (warnings.ts) is always in letters; what the app shows takes the style from the settings.
 */

export type NoteNameStyle = 'letters' | 'solfege'

const SOLFEGE: Record<Step, string> = { C: 'Do', D: 'Re', E: 'Mi', F: 'Fa', G: 'Sol', A: 'La', B: 'Si' }

/** A step ("C" to "B") in the style: "C" or "Do". */
function stepName(step: Step, style: NoteNameStyle): string {
  return style === 'solfege' ? SOLFEGE[step] : step
}

/** "♯", "♭", "♯♯", or nothing for a natural. */
function sign(alter: number): string {
  return alter === 0 ? '' : alter > 0 ? '♯'.repeat(Math.round(alter)) : '♭'.repeat(Math.round(-alter))
}

/** A written pitch by name: "B♭3", or "Si♭3" in do re mi. */
export function noteName(p: Pitch, style: NoteNameStyle): string {
  return `${stepName(p.step, style)}${sign(p.alter ?? 0)}${p.octave}`
}

/** The spelling of each semitone above C: the one the instrument ranges are given in. */
const SEMITONES: readonly [step: Step, alter: number][] = [
  ['C', 0], ['C', 1], ['D', 0], ['E', -1], ['E', 0], ['F', 0], ['F', 1], ['G', 0], ['A', -1], ['A', 0], ['B', -1], ['B', 0],
]

/** A MIDI note by name: 58 is "B♭3" (or "Si♭3") and 90 is "F♯6" (or "Fa♯6"). */
export function midiNoteName(midi: number, style: NoteNameStyle): string {
  const [step, alter] = SEMITONES[((midi % 12) + 12) % 12]!
  return noteName({ step, alter, octave: Math.floor(midi / 12) - 1 }, style)
}
