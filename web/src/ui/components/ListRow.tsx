import type { ComponentChildren } from 'preact'
import { Icon } from './Icon.tsx'

/**
 * A row of a list (frames 01 rotation, 03.1 library, 02.4 tools, 07 instruments): an optional leading
 * picture, a title with a line under it, and what comes at the end. Three kinds:
 *  - a pressable row (`onPress`): the row is one button; `chevron` adds the "›" of a row that opens
 *    something;
 *  - a selectable row (`selected`): the row is a radio of a radio group, drawn with a tint and the radio
 *    mark; the caller wraps the rows in an element with `role="radiogroup"` and a name;
 *  - a link row (`href`): the row is one link to a web page, opened outside the app (`target="_blank"`;
 *    on the phone Capacitor hands it to the browser, add-privacy-policy design D4);
 *  - a plain row: text only.
 * `trailing` is a control of its own at the end of the row (the star, the play button): it is a sibling of
 * the row's button, never inside it, so each is a button of its own with its own name.
 */
export interface ListRowProps {
  title: string
  subtitle?: string
  /** What the row is set to, shown before the chevron (a settings line: "Default instrument · Tenor saxophone ›"). */
  value?: string
  /** A picture or thumbnail before the text. */
  leading?: ComponentChildren
  onPress?: () => void
  /** Makes the row a link to this web page instead of a button. Not combined with `onPress` or `selected`. */
  href?: string
  /** Makes the row a radio: whether it is the chosen one. */
  selected?: boolean
  chevron?: boolean
  /** A row that shows or hides more content below it (the credits): whether it is shown. The chevron turns down. */
  expanded?: boolean
  /** The id of the content `expanded` controls. */
  controls?: string
  trailing?: ComponentChildren
  disabled?: boolean
  /** `card` is the white rounded row of the lists; `inset` has no background of its own. */
  look?: 'card' | 'inset'
  /** `regular`: a row of a sheet (68px); `large`: the home's rotation (86px); `compact`: the library and the choice lists. */
  size?: 'regular' | 'large' | 'compact'
}

export function ListRow({ title, subtitle, value, leading, onPress, href, selected, chevron, expanded, controls, trailing, disabled, look = 'card', size = 'regular' }: ListRowProps) {
  const text = (
    <>
      {leading ? <span class="list-row-leading">{leading}</span> : null}
      <span class="list-row-text">
        <span class="list-row-title">{title}</span>
        {subtitle ? <span class="list-row-subtitle">{subtitle}</span> : null}
      </span>
    </>
  )
  const classes = ['list-row', `list-row--${look}`, `list-row--${size}`]
  if (selected !== undefined) classes.push('list-row--choice')
  if (selected) classes.push('is-selected')
  const interactive = onPress !== undefined || selected !== undefined || href !== undefined
  if (!interactive) classes.push('list-row--static')
  return (
    <div class={classes.join(' ')}>
      {href !== undefined ? (
        <a class="list-row-main" href={href} target="_blank" rel="noopener noreferrer">
          {text}
          {value ? <span class="list-row-value">{value}</span> : null}
          {chevron ? <Icon name="chevron-right" size={20} class="list-row-chevron" /> : null}
        </a>
      ) : interactive ? (
        <button
          type="button"
          class="list-row-main"
          role={selected === undefined ? undefined : 'radio'}
          aria-checked={selected === undefined ? undefined : selected}
          aria-expanded={expanded === undefined ? undefined : expanded}
          aria-controls={controls}
          disabled={disabled}
          onClick={onPress}
        >
          {text}
          {value ? <span class="list-row-value">{value}</span> : null}
          {selected !== undefined ? <Icon name="radio" class={selected ? 'radio-on' : 'radio-off'} /> : null}
          {chevron ? <Icon name="chevron-right" size={20} class={expanded ? 'list-row-chevron is-open' : 'list-row-chevron'} /> : null}
        </button>
      ) : (
        <div class="list-row-main">{text}</div>
      )}
      {trailing ? <div class="list-row-trailing">{trailing}</div> : null}
    </div>
  )
}
