import { KeyValueFiles, normalisePath } from '../keyValueFiles.ts'
import type { ByteStore, FileOperation } from '../keyValueFiles.ts'

class MemoryStore implements ByteStore {
  readonly data = new Map<string, Uint8Array>()

  async get(key: string): Promise<Uint8Array | undefined> {
    return this.data.get(key)?.slice()
  }

  async put(key: string, bytes: Uint8Array): Promise<void> {
    this.data.set(key, bytes.slice())
  }

  async remove(key: string): Promise<void> {
    this.data.delete(key)
  }

  async keys(prefix: string): Promise<string[]> {
    return [...this.data.keys()].filter((key) => key.startsWith(prefix))
  }
}

/**
 * The fake platform's files: in memory, with the behaviour the browser-dev adapter shares (both
 * are `KeyValueFiles`). Besides the port it has what a test needs to arrange and inspect.
 */
export class FakeFiles extends KeyValueFiles {
  private readonly memory: MemoryStore

  /**
   * Called before each operation with its paths; throw to make that operation fail, as a crash or
   * a full disk would. A test uses it to fail the rename of an atomic write (design D4).
   */
  fault: ((operation: FileOperation, paths: string[]) => void) | undefined

  constructor() {
    const memory = new MemoryStore()
    super(memory)
    this.memory = memory
  }

  protected override before(operation: FileOperation, paths: string[]): void {
    this.fault?.(operation, paths)
  }

  protected override async urlFor(path: string): Promise<string> {
    return `fake://image/${path}`
  }

  /** Puts a file in place without going through the port (text, or binary such as an image). */
  seed(path: string, content: string | Uint8Array): void {
    const bytes = typeof content === 'string' ? new TextEncoder().encode(content) : content
    this.memory.data.set(normalisePath(path), bytes.slice())
  }

  /** The bytes of a file, or undefined. */
  bytes(path: string): Uint8Array | undefined {
    return this.memory.data.get(normalisePath(path))?.slice()
  }

  /** The text of a file, or undefined. */
  text(path: string): string | undefined {
    const bytes = this.bytes(path)
    return bytes === undefined ? undefined : new TextDecoder().decode(bytes)
  }

  /** Every file path, sorted. */
  paths(): string[] {
    return [...this.memory.data.keys()].sort()
  }
}
