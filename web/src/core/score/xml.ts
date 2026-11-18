/**
 * A small XML reader/writer for well-formed documents, so MusicXML can be
 * parsed identically in the WebView and in Node tests (Node has no DOMParser).
 *
 * Supported: elements, attributes, text, comments (dropped), processing
 * instructions (dropped), DOCTYPE (skipped, including an internal subset),
 * CDATA, the five standard entities and numeric character references.
 * Not supported: custom entities, validation. Mixed content is flattened to
 * the concatenated text of an element.
 */
export interface XmlElement {
  name: string
  attrs: Record<string, string>
  children: XmlElement[]
  /** Concatenated character data directly inside this element, trimmed. */
  text: string
}

export class XmlParseError extends Error {
  constructor(message: string, position: number) {
    super(`${message} (at offset ${position})`)
    this.name = 'XmlParseError'
  }
}

const NAMED_ENTITIES: Record<string, string> = {
  lt: '<',
  gt: '>',
  amp: '&',
  quot: '"',
  apos: "'",
}

function decodeEntities(raw: string, position: number): string {
  if (!raw.includes('&')) return raw
  return raw.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[A-Za-z][A-Za-z0-9]*);/g, (whole, body: string) => {
    if (body.startsWith('#x')) return String.fromCodePoint(parseInt(body.slice(2), 16))
    if (body.startsWith('#')) return String.fromCodePoint(parseInt(body.slice(1), 10))
    const named = NAMED_ENTITIES[body]
    if (named === undefined) throw new XmlParseError(`Unknown entity ${whole}`, position)
    return named
  })
}

const NAME_CHAR = /[^\s/>=<"'&]/

export function parseXml(source: string): XmlElement {
  let i = source.charCodeAt(0) === 0xfeff ? 1 : 0
  const len = source.length

  const fail = (msg: string): never => {
    throw new XmlParseError(msg, i)
  }
  const skipUntil = (terminator: string, what: string): void => {
    const end = source.indexOf(terminator, i)
    if (end < 0) fail(`Unterminated ${what}`)
    i = end + terminator.length
  }
  const skipSpace = (): void => {
    while (i < len && /\s/.test(source[i] as string)) i++
  }
  const readName = (): string => {
    const start = i
    while (i < len && NAME_CHAR.test(source[i] as string)) i++
    if (i === start) fail('Expected a name')
    return source.slice(start, i)
  }

  /** Skips prolog/misc constructs at the current position; true if something was skipped. */
  const skipMisc = (): boolean => {
    if (source.startsWith('<?', i)) {
      skipUntil('?>', 'processing instruction')
      return true
    }
    if (source.startsWith('<!--', i)) {
      skipUntil('-->', 'comment')
      return true
    }
    if (source.startsWith('<!DOCTYPE', i)) {
      let depth = 0
      while (i < len) {
        const c = source[i]
        if (c === '[') depth++
        else if (c === ']') depth--
        else if (c === '>' && depth <= 0) break
        i++
      }
      if (i >= len) fail('Unterminated DOCTYPE')
      i++
      return true
    }
    return false
  }

  const parseElement = (): XmlElement => {
    // at '<'
    i++
    const name = readName()
    const attrs: Record<string, string> = {}
    for (;;) {
      skipSpace()
      if (i >= len) fail(`Unterminated start tag <${name}>`)
      if (source[i] === '/') {
        if (source[i + 1] !== '>') fail('Expected ">" after "/"')
        i += 2
        return { name, attrs, children: [], text: '' }
      }
      if (source[i] === '>') {
        i++
        break
      }
      const attrName = readName()
      skipSpace()
      if (source[i] !== '=') fail(`Expected "=" after attribute ${attrName}`)
      i++
      skipSpace()
      const quote = source[i]
      if (quote !== '"' && quote !== "'") fail('Expected a quoted attribute value')
      const end = source.indexOf(quote as string, i + 1)
      if (end < 0) fail('Unterminated attribute value')
      attrs[attrName] = decodeEntities(source.slice(i + 1, end), i)
      i = end + 1
    }

    const children: XmlElement[] = []
    let text = ''
    for (;;) {
      if (i >= len) fail(`Unterminated element <${name}>`)
      if (source[i] !== '<') {
        const end = source.indexOf('<', i)
        const stop = end < 0 ? len : end
        text += decodeEntities(source.slice(i, stop), i)
        i = stop
        continue
      }
      if (source.startsWith('</', i)) {
        i += 2
        const closing = readName()
        if (closing !== name) fail(`Mismatched closing tag </${closing}> for <${name}>`)
        skipSpace()
        if (source[i] !== '>') fail('Expected ">" in closing tag')
        i++
        return { name, attrs, children, text: text.trim() }
      }
      if (source.startsWith('<![CDATA[', i)) {
        const end = source.indexOf(']]>', i)
        if (end < 0) fail('Unterminated CDATA section')
        text += source.slice(i + 9, end)
        i = end + 3
        continue
      }
      if (skipMisc()) continue
      children.push(parseElement())
    }
  }

  while (skipMisc() || (i < len && /\s/.test(source[i] as string) && ++i)) {
    /* skip prolog */
  }
  if (source[i] !== '<') fail('Expected a root element')
  const root = parseElement()
  while (skipMisc() || (i < len && /\s/.test(source[i] as string) && ++i)) {
    /* skip epilog */
  }
  if (i < len) fail('Unexpected content after the root element')
  return root
}

function escapeText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function escapeAttr(s: string): string {
  return escapeText(s).replace(/"/g, '&quot;')
}

/** Builds an element tree node; `text` and `children` are both optional. */
export function el(
  name: string,
  attrs: Record<string, string> = {},
  children: XmlElement[] | string = [],
): XmlElement {
  return typeof children === 'string'
    ? { name, attrs, children: [], text: children }
    : { name, attrs, children, text: '' }
}

export function serializeXml(root: XmlElement, declaration = true): string {
  const out: string[] = []
  if (declaration) out.push('<?xml version="1.0" encoding="UTF-8"?>\n')
  const write = (node: XmlElement, depth: number): void => {
    const indent = '  '.repeat(depth)
    const attrs = Object.entries(node.attrs)
      .map(([k, v]) => ` ${k}="${escapeAttr(v)}"`)
      .join('')
    if (node.children.length === 0) {
      out.push(
        node.text === ''
          ? `${indent}<${node.name}${attrs}/>\n`
          : `${indent}<${node.name}${attrs}>${escapeText(node.text)}</${node.name}>\n`,
      )
      return
    }
    out.push(`${indent}<${node.name}${attrs}>\n`)
    for (const child of node.children) write(child, depth + 1)
    out.push(`${indent}</${node.name}>\n`)
  }
  write(root, 0)
  return out.join('')
}
