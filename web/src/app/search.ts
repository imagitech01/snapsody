/*
 * Searching the library by name (practice-app design D11, spec `piece-library` "Search"): a name
 * matches when it contains what the user typed anywhere, ignoring case and accents. Both sides are
 * brought to the same plain form first (`searchKey`), so "ode" finds "Ode to Joy" and "ODE" finds
 * "Ödé", and "cafe" finds "Café".
 */

/** The letters that have no accent to strip but a plain spelling everywhere: "straße" is "strasse", "Ørsted" is "orsted". */
const PLAIN: Readonly<Record<string, string>> = { ß: 'ss', æ: 'ae', œ: 'oe', ø: 'o', đ: 'd', ð: 'd', ł: 'l', ı: 'i', þ: 'th' }

/**
 * The plain form a name or a search text is compared in: accents and other combining marks removed
 * (after a compatibility decomposition, so "ﬁ" is "fi" too), lower case, a few special letters
 * spelled plainly, and runs of white space made one space, with none at the ends. The lower-casing
 * does not depend on the phone's language.
 */
export function searchKey(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[ßæœøđðłıþ]/g, (letter) => PLAIN[letter]!)
    .replace(/\s+/g, ' ')
    .trim()
}

/** Whether a name matches a search text. An empty text (or one of only spaces) matches every name. */
export function matchesSearch(name: string, query: string): boolean {
  const wanted = searchKey(query)
  return wanted === '' || searchKey(name).includes(wanted)
}

/** The items whose `name` matches the search text, in their order. */
export function filterByName<T extends { readonly name: string }>(items: readonly T[], query: string): T[] {
  const wanted = searchKey(query)
  return wanted === '' ? [...items] : items.filter((item) => searchKey(item.name).includes(wanted))
}
