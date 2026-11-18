// The plugin contract (fixtures/bridge/, see its README): the example types and the shape check.
// Used by the quick contract tests (pluginContract.test.ts, capacitorAdapter.test.ts); the Kotlin
// side has the same check (android/app/src/test/.../Contract.kt). No imports: pure functions only.

export interface Shape {
  optional?: string[]
  nullable?: string[]
  enum?: Record<string, unknown[]>
  any?: string[]
}

/** One way a call is rejected: the port's error code, and the request that gets it (none: a state, such as "busy"). */
export interface ErrorExample {
  code: string
  request?: unknown
  description: string
}

/** `<plugin>.<method>.json`: one plugin call. */
export interface CallExample {
  plugin: string
  method: string
  description: string
  request: unknown
  reply?: unknown
  replies?: unknown[]
  errors?: ErrorExample[]
  shape?: Shape
}

/** `<plugin>.<event type>.json`: one event (its `event` is the Capacitor event name). */
export interface EventExample {
  plugin: string
  event: string
  description: string
  payload: unknown
  shape?: Shape
}

function jsonType(value: unknown): string {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  return typeof value
}

/** Differences between [actual] and the shape of [example], as "path: problem" lines. Empty: it matches. */
export function shapeErrors(example: unknown, actual: unknown, path: string, shape: Shape = {}): string[] {
  if (shape.any?.includes(path)) return []
  if (actual === null && shape.nullable?.includes(path)) return []
  const want = jsonType(example)
  const got = jsonType(actual)
  if (want !== got) return [`${path}: expected ${want}, got ${got}`]
  const allowed = shape.enum?.[path]
  if (allowed && !allowed.includes(actual)) return [`${path}: ${JSON.stringify(actual)} is not one of ${JSON.stringify(allowed)}`]
  if (want === 'array') {
    const [first] = example as unknown[]
    if (first === undefined) return []
    return (actual as unknown[]).flatMap((item) => shapeErrors(first, item, `${path}[]`, shape))
  }
  if (want === 'object') {
    const e = example as Record<string, unknown>
    const a = actual as Record<string, unknown>
    const errors: string[] = []
    for (const key of Object.keys(e)) {
      const child = `${path}.${key}`
      if (!(key in a)) {
        if (!shape.optional?.includes(child)) errors.push(`${child}: missing`)
      } else {
        errors.push(...shapeErrors(e[key], a[key], child, shape))
      }
    }
    for (const key of Object.keys(a)) if (!(key in e)) errors.push(`${path}.${key}: not in the example`)
    return errors
  }
  return []
}

/** The reply's differences from the example's reply (or from every one of its alternatives). */
export function replyErrors(example: CallExample, reply: unknown): string[] {
  const alternatives = example.replies ?? [example.reply]
  const results = alternatives.map((alternative) => shapeErrors(alternative, reply, 'reply', example.shape))
  return results.some((errors) => errors.length === 0) ? [] : results.flat()
}

export function requestErrors(example: CallExample, payload: unknown): string[] {
  return shapeErrors(example.request, payload, 'request', example.shape)
}

export function eventErrors(example: EventExample, payload: unknown): string[] {
  return shapeErrors(example.payload, payload, 'payload', example.shape)
}
