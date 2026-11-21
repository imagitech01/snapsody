import type { EditorSession } from '../../../app/editorSession.ts'
import { deleteElement, setClef } from '../../../core/score/edit.ts'
import type { ElementInfo } from '../../../core/score/elements.ts'
import type { Score } from '../../../core/score/model.ts'
import { useShell } from '../../ShellContext.ts'
import { Chip, SelectField } from './controls.tsx'
import type { Failure } from './NoteTab.tsx'

/**
 * The panel for a selected element that is not a note or a bar (change select-and-delete-elements, design
 * D5): its name and bar, a Delete button where the element can be deleted, and for a clef the choice of
 * treble or bass. It sits above the tabs and uses their chip and select styles; frames 06.1 to 06.3 have
 * no such panel (a recorded deviation). Every edit is one undo step through the editor's `run`.
 */

export interface ElementPanelProps {
  session: EditorSession
  run: (edit: (score: Score) => unknown, failure?: Failure) => void
}

const CLEFS = ['treble', 'bass'] as const
type ClefChoice = (typeof CLEFS)[number]

const CLEF_OF: Readonly<Record<ClefChoice, { sign: string; line: number }>> = {
  treble: { sign: 'G', line: 2 },
  bass: { sign: 'F', line: 4 },
}

/** The clef as the choice offers it: anything that is not bass (a C clef) reads as treble in the list. */
const choiceOf = (info: ElementInfo): ClefChoice => (info.clef?.sign === 'F' ? 'bass' : 'treble')

export function ElementPanel({ session, run }: ElementPanelProps) {
  const { t } = useShell().i18n
  const selected = session.selectedElement.value
  if (!selected) return null
  const { ref, info } = selected
  const bar = info.bar + 1

  const name =
    info.kind === 'articulation'
      ? info.mark === 'breath' || info.mark === 'caesura'
        ? t(`element.${info.mark}`)
        : t(`mark.${info.mark === 'ornament' ? (info.ornament ?? 'trill') : (info.mark ?? 'staccato')}` as 'mark.staccato')
      : t(`element.${info.kind}` as 'element.clef')
  const detail = info.kind === 'clef' ? t(`element.clef.${choiceOf(info)}`) : info.kind === 'dynamic' ? info.text : undefined
  const title = detail ? t('element.titleDetail', { name, detail, bar }) : t('element.title', { name, bar })

  return (
    <div class="editor-element" role="region" aria-label={t('element.panel')}>
      <p class="editor-element-title">{title}</p>
      {info.kind === 'clef' ? (
        <SelectField
          label={t('element.clef.field')}
          value={choiceOf(info)}
          options={CLEFS.map((value) => ({ value, label: t(`element.clef.${value}`) }))}
          onChange={(value) => run((s) => setClef(s, { part: info.part ?? session.part.value, staff: info.staff ?? 0 }, info.bar, { ...CLEF_OF[value] }))}
        />
      ) : null}
      {info.deletable ? (
        <Chip tone="danger" onPress={() => run((s) => deleteElement(s, ref))}>
          {t('element.delete')}
        </Chip>
      ) : (
        <p class="editor-hint editor-element-hint">{t('element.firstHint')}</p>
      )}
    </div>
  )
}
