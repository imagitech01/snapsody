import { createBrowserDevPlatform } from './platform/browserDev/index.ts'
import { createCapacitorPlatform, isNative } from './platform/capacitor/index.ts'
import type { Platform } from './platform/port.ts'
import { mount } from './ui/mount.tsx'

// The composition root: it is the only place that may pick a platform adapter (platform/<adapter>/).
// In the Capacitor app on the phone, the Capacitor adapter; in a browser (`npm run dev`), browser-dev.
// Nothing here is for tests: the UI tests have their own entry (web/test/ui/seeded.tsx) that passes the
// fake platform to the same `mount`, and it is not part of this build.
export const platform: Platform = isNative() ? createCapacitorPlatform() : createBrowserDevPlatform()

void mount(platform, document.getElementById('app')!)
