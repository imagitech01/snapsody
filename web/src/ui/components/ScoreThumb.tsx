import { Icon } from './Icon.tsx'

/**
 * The picture before a piece in a list (frames 03.1 and 03.2): a small pale page with five staff lines
 * and two joined notes. It is not a picture of the piece (a piece has no thumbnail of its own, only
 * photos of pages that may be gone), so every piece gets the same one. Decorative: the row's text names
 * the piece.
 */
export function ScoreThumb() {
  return (
    <span class="score-thumb" aria-hidden="true">
      <Icon name="notes" size={20} />
    </span>
  )
}
