# Proposal

## Why

The Android build runs on the toolchain the spike settled for Capacitor 8: AGP 8.13.2, Gradle 8.14.3 and Kotlin 2.2.20. The current versions are AGP 9.5, Gradle 9.9 and Kotlin 2.4. Capacitor 8 does not officially support AGP 9 (its maintainers say so); Capacitor 9 is built for it. Capacitor 9 is still a release candidate (9.0.0-rc.0, 2026-11-12), and `@capacitor/filesystem` and `@capacitor-community/keep-awake` have no Capacitor 9 release yet. So this change moves the shell and the build toolchain together, but **only once Capacitor 9 and those plugins have stable releases**. The project uses stable dependencies only.

## What Changes

- Capacitor 8.6.2 → 9.x: `@capacitor/core`, `@capacitor/android` and `@capacitor/cli`, plus the plugins `@capacitor/app`, `@capacitor/device`, `@capacitor/filesystem` and `@capacitor-community/keep-awake`.
- Android Gradle plugin 8.13.2 → 9.x, Gradle 8.14.3 → 9.x and Kotlin 2.2.20 → 2.3 or 2.4. The versions are the ones Capacitor 9 is built for, within what Chaquopy supports (design D2).
- AGP 9 build-script changes in `android/`:
  - Kotlin comes built into AGP, so `org.jetbrains.kotlin.android` is no longer applied.
  - `proguard-android.txt` becomes `proguard-android-optimize.txt`.
  - The model assets are added with `srcDir`.
  - The values from `variables.gradle` are read explicitly from `rootProject.ext`.
- `compileSdk` 36 → 37, as Capacitor 9 asks. `targetSdk` (36) and `minSdk` (29) stay the same.
- Credits, NOTICE and `docs/testing.md` follow the new versions.
- No user-visible behaviour changes. The app, its stored pieces, its permissions and its recognition results stay the same.

Not in this change:
- **LiteRT 2.x.** LiteRT 2.x drops the Interpreter GPU delegate we use. Moving to it means rewriting segnet inference onto the CompiledModel API. We stay on 1.4.2 (decided 2026-11-22): segnet on the GPU takes 1.9–2.5 s of an 8–12 s page read on the S24, most of it the one-time GPU start-up, so the port gains too little. 1.4.2 already meets Play's 16 KB page-size rule.
- The Python toolchains: Chaquopy's Python 3.10, and the model build on 3.12.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

None. This is a dependency and build-toolchain upgrade with no change to spec-level behaviour, so `.openspec.yaml` sets `skip_specs: true`.

## Impact

- `web/package.json` and `package-lock.json`, `tools/capacitor/package.json` (the Capacitor CLI).
- `android/build.gradle`, `android/app/build.gradle`, `android/variables.gradle`, `android/gradle/wrapper/gradle-wrapper.properties`, and the Capacitor-generated Gradle files (`capacitor.build.gradle`, `capacitor.settings.gradle`, `capacitor-cordova-android-plugins/`).
- `web/src/app/credits.ts`, `web/public/licences/`, `NOTICE`, and `docs/testing.md` (the toolchain paragraph).
- Build machine: Capacitor 9 needs Node 24 or newer and JDK 21. This machine has Node 26 and JDK 21.0.13.
