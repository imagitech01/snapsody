import type { Platform } from '../port.ts'
import { FakeDevice } from './device.ts'
import { FakeFiles } from './files.ts'
import { FakeReader } from './reader.ts'
import type { FakeReaderOptions } from './reader.ts'
import { FakeScanner } from './scanner.ts'

export { FakeDevice } from './device.ts'
export { FakeFiles } from './files.ts'
export { FakeReader } from './reader.ts'
export type { FakePageOutcome, FakeReaderJob, FakeReaderOptions } from './reader.ts'
export { FakeScanner } from './scanner.ts'
export type { FakeScannedPage } from './scanner.ts'

export type FakePlatformOptions = FakeReaderOptions

/** The platform of the quick and mac layers (practice-app design D2): in-memory files, a scripted scanner and a scripted reader. */
export interface FakePlatform extends Platform {
  files: FakeFiles
  scanner: FakeScanner
  reader: FakeReader
  device: FakeDevice
}

export function createFakePlatform(options: FakePlatformOptions = {}): FakePlatform {
  const files = new FakeFiles()
  return {
    files,
    scanner: new FakeScanner(files),
    reader: new FakeReader(options),
    device: new FakeDevice(),
  }
}
