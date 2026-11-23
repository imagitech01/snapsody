import assert from 'node:assert/strict'
import { test } from 'node:test'
import { TENOR_SAX } from '../src/core/instruments/instruments.ts'
import { EditSession } from '../src/core/score/editSession.ts'
import { firstVoice, isNote, voiceView } from '../src/core/score/model.ts'
import type { Score, VoiceRef } from '../src/core/score/model.ts'
import { parseMusicXml } from '../src/core/score/musicxml.ts'
import { suggestRepairs } from '../src/core/score/suggest.ts'
import type { Suggestion } from '../src/core/score/suggest.ts'
import { note, quarters, score, warningsFor } from './helpers.ts'
import { inVoice, n, partsOf } from './playbackHelpers.ts'

// Suggested repairs (change redesign-score-editor, design D6, spec "Suggested repairs", task 4.3).

/** A score from bar bodies; the bar under test is the second, so it is not a pickup. */
const piece = (bodies: string[], time: [number, number] = [4, 4]): Score => parseMusicXml(score(bodies, time))
const full44 = quarters(4)
/** A suggestion as a short text, for comparing lists: "length 1 quarter.", "addRest eighth", "barLine 3", "removeRest 1", "join". */
const brief = (s: Suggestion): string => {
  switch (s.kind) {
    case 'addRest':
      return `addRest ${s.length.type}${'.'.repeat(s.length.dots)}`
    case 'length':
      return `length ${s.place} ${s.length.type}${'.'.repeat(s.length.dots)}`
    case 'barLine':
    case 'removeRest':
      return `${s.kind} ${s.place}`
    case 'join':
      return 'join'
  }
}
const suggest = (s: Score, bar = 1, where: VoiceRef = firstVoice(s)): string[] => suggestRepairs(s, where, bar).map(brief)
const barFlags = (s: Score): string[] => warningsFor(s, TENOR_SAX).filter((w) => w.kind === 'bar-length').map((w) => w.bar!)

/** Applies a suggestion as the editor does: one edit in a session. Returns the session. */
function apply(s: Score, suggestion: Suggestion): EditSession {
  const session = new EditSession(s)
  session.apply(suggestion.run)
  return session
}

test('suggest: a missed dot (spec "A missed dot")', () => {
  // E4 quarter, an eighth and a half: 3½ beats.
  const s = piece([full44, note({ step: 'E', octave: 4, type: 'quarter' }) + note({ step: 'G', octave: 4, type: 'eighth' }) + note({ step: 'C', octave: 5, type: 'half' })])
  assert.deepEqual(barFlags(s), ['2'])
  const found = suggestRepairs(s, firstVoice(s), 1)
  assert.deepEqual(found.map(brief), ['addRest eighth', 'length 1 quarter.', 'length 2 quarter'])
  const dot = found[1]!
  assert.equal(dot.kind, 'length')
  if (dot.kind !== 'length') return
  assert.deepEqual([dot.pitch, dot.place, dot.length], [{ step: 'E', octave: 4 }, 1, { type: 'quarter', dots: 1 }])
  assert.equal(dot.noteId, voiceView(s, firstVoice(s)).measures[1]!.items.filter(isNote)[0]!.id)
  const session = apply(s, dot)
  assert.deepEqual(barFlags(session.score), [], 'the bar adds up to 4 beats')
  assert.deepEqual(barFlags(s), ['2'], 'the score it was offered for is unchanged')
  session.undo()
  assert.deepEqual(barFlags(session.score), ['2'], 'one undo step')
})

test('suggest: a missed bar line (spec "A missed bar line")', () => {
  const s = piece([quarters(3), quarters(6)], [3, 4])
  const found = suggestRepairs(s, firstVoice(s), 1)
  assert.deepEqual(found.map(brief), ['barLine 3'], 'a bar line after the third note, and nothing else')
  const session = apply(s, found[0]!)
  assert.equal(session.score.bars.length, 3)
  assert.deepEqual(barFlags(session.score), [], 'two bars of three beats')
})

test('suggest: short at the end (spec "Short at the end"), with "quarter → half" for each note', () => {
  const s = piece([full44, quarters(3)])
  assert.deepEqual(suggest(s), ['addRest quarter', 'length 1 half', 'length 2 half', 'length 3 half'])
  const session = apply(s, suggestRepairs(s, firstVoice(s), 1)[0]!)
  assert.deepEqual(voiceView(session.score, firstVoice(session.score)).measures[1]!.items.filter(isNote).map((x) => (x.rest ? `rest:${x.type}` : x.type)), ['quarter', 'quarter', 'quarter', 'rest:quarter'])
  assert.deepEqual(barFlags(session.score), [])
})

test('suggest: nothing simple helps (spec "Nothing simple helps")', () => {
  // A whole, a half and a sixteenth: 6¼ beats.
  const s = piece([full44, note({ type: 'whole' }) + note({ type: 'half' }) + note({ type: '16th' })])
  assert.deepEqual(barFlags(s), ['2'])
  assert.deepEqual(suggest(s), [])
})

test('suggest: the changes that touch no note come first, and at most four are offered (design D6)', () => {
  // Three quarters, and a next bar of one quarter: the rest, the join, then the notes from the left; the third note's "→ half" is the fifth.
  const s = piece([full44, quarters(3), quarters(1)])
  assert.deepEqual(suggest(s), ['addRest quarter', 'join', 'length 1 half', 'length 2 half'])
  const joined = apply(s, suggestRepairs(s, firstVoice(s), 1)[1]!)
  assert.equal(joined.score.bars.length, 2)
  assert.deepEqual(barFlags(joined.score), [])
  // The editor's own rule for the bar line can rule the join out.
  assert.deepEqual(suggestRepairs(s, firstVoice(s), 1, { canJoin: () => false }).map(brief), ['addRest quarter', 'length 1 half', 'length 2 half', 'length 3 half'])
})

test('suggest: one pass from the left, a rest removed in its place among the notes (design D6, not the mock\'s order)', () => {
  // An eighth rest, then four quarters: 4½ beats. The rest comes first, so its removal is offered before the notes are halved.
  const s = piece([full44, note({ rest: true, type: 'eighth' }) + quarters(4)])
  assert.deepEqual(suggest(s), ['removeRest 1', 'length 2 eighth', 'length 3 eighth', 'length 4 eighth'])
  const removed = apply(s, suggestRepairs(s, firstVoice(s), 1)[0]!)
  assert.deepEqual(barFlags(removed.score), [])
})

test('suggest: none for a bar that adds up, a pickup bar, a short later voice or a bar without a time signature (design D11)', () => {
  assert.deepEqual(suggest(piece([full44, full44])), [])
  const pickup = piece([quarters(3), full44])
  assert.deepEqual(barFlags(pickup), [], 'a short first bar has no warning')
  assert.deepEqual(suggest(pickup, 0), [])
  // A first bar that is too long has the warning, and its suggestions.
  assert.deepEqual(suggest(piece([quarters(8), full44]), 0), ['barLine 4'])
  assert.deepEqual(suggest(parseMusicXml(score([full44, quarters(3)]))), [], 'no time signature')
  // A second voice of one quarter note is not flagged, so it gets nothing.
  const voices = partsOf([{ id: 'P1', bars: [quarters(4), n({ type: 'whole' }) + `<backup><duration>48</duration></backup>` + inVoice(n({ id: 'v' }), 2)] }])
  const second: VoiceRef = { part: 'P1', staff: 0, voice: 1 }
  assert.deepEqual(suggestRepairs(voices, second, 1), [])
})

test('suggest: a triplet is not changed', () => {
  const triplet = (step: string): string => note({ step, type: 'eighth', triplet: true })
  // A triplet and two quarters in 4/4: 3 beats; only the rest at the end and the quarters' changes.
  const s = piece([full44, triplet('C') + triplet('D') + triplet('E') + quarters(2)])
  for (const found of suggestRepairs(s, firstVoice(s), 1)) if (found.kind === 'length') assert.ok(found.place > 3, `${brief(found)} does not touch the triplet`)
  assert.deepEqual(suggest(s), ['addRest quarter', 'length 4 half', 'length 5 half'])
})
