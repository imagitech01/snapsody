import { KeepAwake } from '@capacitor-community/keep-awake'
import { App } from '@capacitor/app'
import { Capacitor, registerPlugin } from '@capacitor/core'
import { Filesystem } from '@capacitor/filesystem'
import type { Platform } from '../port.ts'
import { createCapacitorPlatformWith } from './platform.ts'
import type { AtomicFilesPlugin, CapacitorPlugins, ReaderPlugin, ScannerPlugin } from './plugins.ts'

export { createCapacitorPlatformWith } from './platform.ts'

/** True in the Capacitor app on the phone, false in a browser. */
export function isNative(): boolean {
  return Capacitor.isNativePlatform()
}

/** True in the dev build on the phone (app id `be.imagitech.snapsody.dev`, docs/testing.md "Dev build on the phone"), which logs diagnostics. */
export async function isDevBuild(): Promise<boolean> {
  if (!isNative()) return false
  try {
    return (await App.getInfo()).id.endsWith('.dev')
  } catch {
    return false
  }
}

/**
 * The platform of the app on the phone, over the real plugins: Capacitor's Filesystem and App, the community KeepAwake, and our Scanner, Reader and AtomicFiles (android/app/src/main/
 * java/be/imagitech/snapsody/).
 */
export function createCapacitorPlatform(): Platform {
  const plugins: CapacitorPlugins = {
    filesystem: Filesystem,
    atomicFiles: registerPlugin<AtomicFilesPlugin>('AtomicFiles'),
    scanner: registerPlugin<ScannerPlugin>('Scanner'),
    reader: registerPlugin<ReaderPlugin>('Reader'),
    app: App,
    keepAwake: KeepAwake,
    convertFileSrc: (uri) => Capacitor.convertFileSrc(uri),
  }
  return createCapacitorPlatformWith(plugins)
}
