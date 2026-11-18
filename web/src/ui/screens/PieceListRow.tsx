import type { PieceRow } from '../../app/libraryView.ts'
import { IconButton, ListRow, ScoreThumb } from '../components/index.ts'
import { useShell } from '../ShellContext.ts'

/**
 * A piece in the library or the favorites (frames 03.1 and 03.2): a thumbnail, the name, the summary
 * line, and the star. Pressing the row opens the piece for practice. `onDelete` adds the bin of the
 * library (the frame has none: see deviations.md, 03.1).
 */
export function PieceListRow({ row, onDelete }: { row: PieceRow; onDelete?: () => void }) {
  const { i18n, router, view, run } = useShell()
  const { t } = i18n
  const { id, name, favorite } = row.info
  return (
    <ListRow
      size="compact"
      title={name}
      subtitle={row.summary}
      leading={<ScoreThumb />}
      onPress={() => router.push({ name: 'practice', pieceId: id })}
      trailing={
        <>
          {onDelete ? <IconButton label={t('library.deleteRow', { name })} icon="trash" look="quiet" onPress={onDelete} /> : null}
          <IconButton
            label={favorite ? t('library.unstar', { name }) : t('library.star', { name })}
            icon="star"
            look="plain"
            filled={favorite}
            onPress={() => void run(() => view.toggleFavorite(id))}
          />
        </>
      }
    />
  )
}
