/**
 * Exact rational numbers for note durations. All durations in the score model
 * are fractions of a whole note, so triplets (1/12) and dotted values add up
 * exactly with no floating point drift.
 */
export interface Frac {
  readonly n: number
  readonly d: number
}

function gcd(a: number, b: number): number {
  a = Math.abs(a)
  b = Math.abs(b)
  while (b !== 0) {
    ;[a, b] = [b, a % b]
  }
  return a
}

export function frac(n: number, d = 1): Frac {
  if (!Number.isInteger(n) || !Number.isInteger(d) || d === 0) {
    throw new RangeError(`Invalid fraction ${n}/${d}`)
  }
  const g = gcd(n, d) || 1
  const sign = d < 0 ? -1 : 1
  return { n: (sign * n) / g, d: (sign * d) / g }
}

export const ZERO: Frac = frac(0)

export function add(a: Frac, b: Frac): Frac {
  return frac(a.n * b.d + b.n * a.d, a.d * b.d)
}

export function sub(a: Frac, b: Frac): Frac {
  return frac(a.n * b.d - b.n * a.d, a.d * b.d)
}

export function mul(a: Frac, b: Frac): Frac {
  return frac(a.n * b.n, a.d * b.d)
}

export function div(a: Frac, b: Frac): Frac {
  return frac(a.n * b.d, a.d * b.n)
}

export function eq(a: Frac, b: Frac): boolean {
  return a.n === b.n && a.d === b.d
}

export function cmp(a: Frac, b: Frac): number {
  return a.n * b.d - b.n * a.d
}

export function lcm(a: number, b: number): number {
  return (a / gcd(a, b)) * b
}

export function toString(a: Frac): string {
  return a.d === 1 ? `${a.n}` : `${a.n}/${a.d}`
}
