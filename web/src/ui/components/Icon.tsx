import type { JSX } from 'preact'

/**
 * The icons of the frames, on a 24 x 24 grid, drawn in the current text colour. Each is the path of
 * the frame's own icon (play, library, settings, back, more, restart, pause, loop, metronome, search,
 * star, camera), moved onto the grid; fills are noted below. Decorative: the button that holds one
 * carries the accessible name.
 */
export type IconName =
  | 'play'
  | 'pause'
  | 'restart'
  | 'loop'
  | 'metronome'
  | 'library'
  | 'settings'
  | 'back'
  | 'more'
  | 'search'
  | 'star'
  | 'camera'
  | 'chevron-right'
  | 'chevron-down'
  | 'radio'
  | 'trash'
  | 'close'
  | 'notes'
  | 'check'
  | 'clock'
  | 'ring'

const STROKE = 1.8

// Each icon is a list of shapes; `fill` shapes are filled with the text colour.
const SHAPES: Record<IconName, JSX.Element> = {
  // The frames draw the triangle with a dark fill and a green outline; one colour here (see deviations).
  play: <path d="M9 5L20 12L9 19Z" fill="currentColor" />,
  pause: <path d="M8 5V19M16 5V19" stroke-width="4" />,
  restart: <path d="M5 5V19M19 5L8 12L19 19V5Z" />,
  loop: <path d="M4 10V7H18M15 10L18 7L15 4M20 14V17H6M9 14L6 17L9 20" />,
  metronome: (
    <>
      <path d="M7 16H17M12 14L18 4M8 3L4 21H20L16 3H8Z" />
      <circle cx="12" cy="14" r="1.5" />
    </>
  ),
  library: (
    <>
      <rect x="4" y="4" width="16" height="16" rx="3" />
      <path d="M9 4V20M12 9H17M12 13H17" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 22V19A8 8 0 0 1 20 19V22" />
    </>
  ),
  back: <path d="M14 6L8 12L14 18" />,
  more: (
    <>
      <circle cx="5" cy="12" r="1.4" fill="currentColor" />
      <circle cx="12" cy="12" r="1.4" fill="currentColor" />
      <circle cx="19" cy="12" r="1.4" fill="currentColor" />
    </>
  ),
  search: (
    <>
      <circle cx="10" cy="10" r="6" />
      <path d="M15 15L20 20" />
    </>
  ),
  star: <path d="M12 3L14.8 8.7L21 9.6L16.5 14L17.6 20.2L12 17.2L6.4 20.2L7.5 14L3 9.6L9.2 8.7Z" />,
  camera: (
    <>
      <path d="M8 6L10 3H14L16 6H21V20H3V6H8Z" />
      <circle cx="12" cy="12" r="3.5" />
    </>
  ),
  // The frames use the text glyphs › and ⌄; paths give the same shape in the text colour.
  'chevron-right': <path d="M10 6L16 12L10 18" />,
  'chevron-down': <path d="M7 10L12 15L17 10" />,
  radio: (
    <>
      <circle cx="12" cy="12" r="9" />
      <circle class="icon-radio-dot" cx="12" cy="12" r="4" fill="currentColor" />
    </>
  ),
  // Not in the frames: the bin of a library row (task 12.2) and the cross that clears the search field.
  trash: <path d="M4 7H20M9 7V4H15V7M6 7L7 20H17L18 7M10 11V16M14 11V16" />,
  close: <path d="M6 6L18 18M18 6L6 18" />,
  // The two joined notes of a score thumbnail (frames 03.1 and 03.2), redrawn here (two filled heads and a beam), not the frame's own path.
  notes: (
    <>
      <path d="M9 17V5L19 3V15" />
      <path d="M9 9L19 7" />
      <circle cx="6.5" cy="17.5" r="2.5" fill="currentColor" />
      <circle cx="16.5" cy="15.5" r="2.5" fill="currentColor" />
    </>
  ),
  // The three steps of frame 05 (a page read, being read, waiting), the frame's own paths moved onto the grid.
  check: <path d="M5 12L9 16L19 6" />,
  clock: (
    <>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 7V12L15 14" />
    </>
  ),
  ring: <circle cx="12" cy="12" r="4" />,
}

export interface IconProps {
  name: IconName
  /** Size in px; 24 by default. */
  size?: number
  class?: string
  /** Fill the shape too (a favourite star that is on). */
  filled?: boolean
}

export function Icon({ name, size = 24, class: className, filled = false }: IconProps) {
  return (
    <svg
      class={className ? `icon ${className}` : 'icon'}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      stroke-width={STROKE}
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {SHAPES[name]}
    </svg>
  )
}
