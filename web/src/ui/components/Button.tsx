import type { ComponentChildren } from 'preact'
import { Icon } from './Icon.tsx'
import type { IconName } from './Icon.tsx'

/**
 * Buttons (frames 01, 02.3, 03.1, 06.1): the primary button (filled green), the secondary one (a tint
 * of the surface), a danger one for "Delete note", a light one on the dark card, and a text link such
 * as "See all" or "Browse all music". The text comes from the caller; a button that shows only an
 * icon is an IconButton.
 */
export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'light' | 'link'

export interface ButtonProps {
  variant?: ButtonVariant
  /** `large` is the 52px primary button of the frames; `small` the 44px secondary one. Links ignore it. */
  size?: 'large' | 'small'
  /** An icon before the text (the camera on "Add music"). */
  icon?: IconName
  /** Stretch over the width of the container (the frames' big buttons). */
  block?: boolean
  disabled?: boolean
  onPress: () => void
  children: ComponentChildren
}

export function Button({ variant = 'primary', size, icon, block, disabled, onPress, children }: ButtonProps) {
  const large = size ? size === 'large' : variant === 'primary' || variant === 'light'
  const classes = ['button', `button--${variant}`, large ? 'button--large' : 'button--small']
  if (block) classes.push('button--block')
  return (
    <button type="button" class={classes.join(' ')} disabled={disabled} onClick={onPress}>
      {icon ? <Icon name={icon} size={20} /> : null}
      <span>{children}</span>
    </button>
  )
}

export interface IconButtonProps {
  /** The accessible name: what the button does ("Back", "More tools", "Add to favorites"). */
  label: string
  icon: IconName
  onPress: () => void
  /** `tonal` is the filled square or circle of the header buttons and the play button; `plain` has no background; `quiet` has none and is drawn in the muted text colour (the bin of a library row). */
  look?: 'tonal' | 'plain' | 'accent' | 'quiet'
  /** A button that switches something: it says whether it is on. */
  pressed?: boolean
  /** A star that is filled, without the button being a switch: its name already says what it does ("Remove from favorites"). */
  filled?: boolean
  /** The side of the button in px (44 by default; the play button of a rotation row is 46). */
  size?: number
  /** Round instead of a rounded square. */
  round?: boolean
  disabled?: boolean
}

export function IconButton({ label, icon, onPress, look = 'tonal', pressed, filled, size = 44, round, disabled }: IconButtonProps) {
  const classes = ['icon-button', `icon-button--${look}`]
  if (round) classes.push('icon-button--round')
  return (
    <button
      type="button"
      class={classes.join(' ')}
      style={{ '--size': `${size}px` }}
      aria-label={label}
      aria-pressed={pressed === undefined ? undefined : pressed}
      disabled={disabled}
      onClick={onPress}
    >
      <Icon name={icon} filled={(pressed === true || filled === true) && icon === 'star'} />
    </button>
  )
}
