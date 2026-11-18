// Minimal typings for the Node built-ins the tests use, so the project needs no
// @types/node dependency. Tests run with `node --test` (Node strips the types).
declare module 'node:test' {
  interface TestOptions {
    skip?: boolean | string
  }
  export function test(name: string, fn: () => void | Promise<void>): void
  export function test(name: string, options: TestOptions, fn: () => void | Promise<void>): void
  export function afterEach(fn: () => void | Promise<void>): void
}
declare module 'node:assert/strict' {
  const assert: {
    (value: unknown, message?: string): asserts value
    ok(value: unknown, message?: string): asserts value
    equal(actual: unknown, expected: unknown, message?: string): void
    notEqual(actual: unknown, expected: unknown, message?: string): void
    deepEqual(actual: unknown, expected: unknown, message?: string): void
    match(value: string, pattern: RegExp, message?: string): void
    throws(fn: () => unknown, expected?: RegExp | object): void
    rejects(promise: Promise<unknown>, expected?: RegExp | object): Promise<void>
    notDeepEqual(actual: unknown, expected: unknown, message?: string): void
  }
  export default assert
}
declare module 'node:fs' {
  export function existsSync(path: string): boolean
  export function readFileSync(path: string, encoding: 'utf8'): string
  export function readFileSync(path: string): Uint8Array & { readUInt32LE(offset: number): number; readUInt16LE(offset: number): number; toString(encoding: string, start?: number, end?: number): string }
  export function readdirSync(path: string, options?: { recursive?: boolean }): string[]
  export function statSync(path: string): { size: number; isFile(): boolean; isDirectory(): boolean }
  export function writeFileSync(path: string, data: string | Uint8Array): void
  export function mkdirSync(path: string, options?: { recursive?: boolean }): void
}
declare module 'node:util' {
  export function isDeepStrictEqual(a: unknown, b: unknown): boolean
}
declare module 'node:url' {
  export function fileURLToPath(url: string | URL): string
}
declare module 'node:child_process' {
  export function spawnSync(
    command: string,
    args: string[],
    options?: { stdio?: 'inherit' | 'pipe'; cwd?: string },
  ): { status: number | null; error?: Error }
}
declare const process: {
  argv: string[]
  execPath: string
  env: Record<string, string | undefined>
  exit(code?: number): never
}
