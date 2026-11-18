// Small committed scores for the UI tests.

/** Two bars of 4/4 quarter notes at 60 beats per minute: one beat is one second. */
export function scaleScore(): string {
  const bar = (n: number, notes: [string, number][]) =>
    `<measure number="${n}">${n === 1 ? '<attributes><divisions>1</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes><direction placement="above"><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>60</per-minute></metronome></direction-type><sound tempo="60"/></direction>' : ''}${notes
      .map(([step, octave]) => `<note><pitch><step>${step}</step><octave>${octave}</octave></pitch><duration>1</duration><voice>1</voice><type>quarter</type></note>`)
      .join('')}</measure>`
  return (
    '<?xml version="1.0" encoding="UTF-8"?><score-partwise version="4.0"><part-list><score-part id="P1"><part-name>Tenor Saxophone</part-name></score-part></part-list><part id="P1">' +
    bar(1, [['C', 5], ['D', 5], ['E', 5], ['F', 5]]) +
    bar(2, [['G', 5], ['F', 5], ['E', 5], ['D', 5]]) +
    '</part></score-partwise>'
  )
}

/** [bars] bars of 4/4 quarter notes (C D E F), the first with a tempo marking of [tempo] beats per minute. For the pieces the seeds make. */
export function barsScore(bars: number, tempo = 60): string {
  const notes = [['C', 5], ['D', 5], ['E', 5], ['F', 5]]
    .map(([step, octave]) => `<note><pitch><step>${step}</step><octave>${octave}</octave></pitch><duration>1</duration><voice>1</voice><type>quarter</type></note>`)
    .join('')
  const first = `<attributes><divisions>1</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes><direction placement="above"><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>${tempo}</per-minute></metronome></direction-type><sound tempo="${tempo}"/></direction>`
  const measures = Array.from({ length: bars }, (_, i) => `<measure number="${i + 1}">${i === 0 ? first : ''}${notes}</measure>`).join('')
  return `<?xml version="1.0" encoding="UTF-8"?><score-partwise version="4.0"><part-list><score-part id="P1"><part-name>Tenor Saxophone</part-name></score-part></part-list><part id="P1">${measures}</part></score-partwise>`
}
