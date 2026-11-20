import type { ComponentChildren } from 'preact'

/**
 * A surface that holds a group of content: the "continue practicing" card (frame 01, a white card since
 * design D1), a white card, or the muted note card of the settings (frame 07). The caller gives it a heading when it needs
 * a name for screen readers (`label`), which turns it into a labelled region.
 */
export interface CardProps {
  tone?: 'light' | 'muted'
  /** The name of the card for screen readers; the card is then a region. */
  label?: string
  children: ComponentChildren
}

export function Card({ tone = 'light', label, children }: CardProps) {
  return (
    <section class={`card card--${tone}`} aria-label={label}>
      {children}
    </section>
  )
}
