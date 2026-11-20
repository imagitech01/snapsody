import type { Platform } from '../port.ts'
import { CapacitorDevice } from './device.ts'
import { CapacitorFiles, DataPaths } from './files.ts'
import type { CapacitorPlugins } from './plugins.ts'
import { CapacitorReader } from './reader.ts'
import { CapacitorScanner } from './scanner.ts'

/** The platform on the phone (practice-app design D2, task 10.5), over the given plugins (`index.ts` passes the real ones). */
export function createCapacitorPlatformWith(plugins: CapacitorPlugins): Platform {
  const paths = new DataPaths(plugins.filesystem)
  return {
    files: new CapacitorFiles(plugins.filesystem, plugins.atomicFiles, paths, plugins.convertFileSrc),
    scanner: new CapacitorScanner(plugins.scanner),
    reader: new CapacitorReader(plugins.reader, paths),
    device: new CapacitorDevice(plugins.app, plugins.keepAwake),
  }
}
