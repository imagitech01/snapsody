// Loads the plugin contract examples from fixtures/bridge/ (Node only).
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { CallExample, EventExample } from './contract.ts'

export const BRIDGE_DIR = fileURLToPath(new URL('../../fixtures/bridge/', import.meta.url))

export interface Examples {
  /** By file name without `.json`, e.g. "reader.read". */
  calls: Map<string, CallExample>
  /** By file name without `.json`, e.g. "reader.progress". */
  events: Map<string, EventExample>
}

export function loadExamples(): Examples {
  const calls = new Map<string, CallExample>()
  const events = new Map<string, EventExample>()
  for (const file of readdirSync(BRIDGE_DIR).filter((name) => name.endsWith('.json')).sort()) {
    const name = file.slice(0, -'.json'.length)
    const example = JSON.parse(readFileSync(BRIDGE_DIR + file, 'utf8')) as Record<string, unknown>
    if (typeof example.method === 'string') calls.set(name, example as unknown as CallExample)
    else if (typeof example.event === 'string') events.set(name, example as unknown as EventExample)
    else throw new Error(`${file}: neither a call (method) nor an event (event)`)
  }
  return { calls, events }
}

/** The call example `<name>`; throws when there is none. */
export function call(examples: Examples, name: string): CallExample {
  const example = examples.calls.get(name)
  if (!example) throw new Error(`no example fixtures/bridge/${name}.json`)
  return example
}

/** The event example `<name>`; throws when there is none. */
export function event(examples: Examples, name: string): EventExample {
  const example = examples.events.get(name)
  if (!example) throw new Error(`no example fixtures/bridge/${name}.json`)
  return example
}
