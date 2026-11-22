# Design

## Context

`android/` is Capacitor 8's generated project with our additions. It uses Groovy build scripts and the spike's toolchain (`openspec/changes/archive/2026-11-18-practice-app/evidence/spike.md`, "Toolchain and versions"): AGP 8.13.2, Gradle 8.14.3, Kotlin 2.2.20 (`org.jetbrains.kotlin.android`), Chaquopy 17.2.0, Java 21, compileSdk/targetSdk 36 and minSdk 29.

The pre-Capacitor host (`android/` before the practice-app change) already ran on AGP 9.5.0 and Gradle 9.8.2 with built-in Kotlin, Chaquopy 17.2.0, LiteRT 1.4.2 and ONNX Runtime. So our own native and Python parts are known to work on AGP 9. What is new is Capacitor and its plugins.

Research done on 2026-11-22 (versions as of that day):

- **Capacitor 9.0.0-rc.0** (2026-11-12). Its `next` branch builds with AGP 9.4.1 and Gradle 9.8.2. It needs Node 24 or newer, JDK 21, compileSdk 37 and minSdk 26 or higher. Its docs say `android.builtInKotlin=false` breaks a Capacitor 9 build.
- **Plugins.**
  - `@capacitor/app` and `@capacitor/device` have 9.0.0-alpha.3.
  - `@capacitor/filesystem` has only `8.2.0-next.9`. That branch is on AGP 9.4.1 with `jvmToolchain(21)`.
  - `@capacitor-community/keep-awake` has no Capacitor 9 release.
- **Chaquopy 17.2.0** is the latest release and lists AGP 7.3–9.5.
- **Kotlin Gradle plugin compatibility** (kotlinlang.org). 2.4.20–2.4.21 are fully supported up to AGP 9.3.1 and Gradle 9.7.0. Newer combinations are allowed but may print deprecation warnings.
- **AGP 9 breaks these lines in `android/app/build.gradle`:**
  - `apply plugin: 'org.jetbrains.kotlin.android'`: built-in Kotlin is on by default, so applying the plugin fails.
  - `getDefaultProguardFile('proguard-android.txt')`: AGP 9 rejects it.
  - `assets.srcDirs += modelAssets`: very likely breaks, because AGP 9's source-directory set has no `getSrcDirs()`.
- **AGP 9 changes a default:** `android.onlyEnableUnitTestForTheTestedBuildType=true`. `make test-quick` runs `:app:testDebugUnitTest`, which stays.
- **Gradle 9.6 or newer deprecates looking up properties in parent projects implicitly.** It becomes an error in Gradle 10. `app/build.gradle` does this with `$androidxAppCompatVersion` and the other values from `variables.gradle`.

## Goals / Non-Goals

**Goals:**
- Run on stable Capacitor 9 with the AGP/Gradle/Kotlin versions it is built for, with no opt-out flags that AGP 10 removes.
- Build and test exactly as today: `make test-quick`, `make test-browser`, `make test-device`, `make dev-phone` and `make bundle`. The APK keeps the same permissions, uncompressed models and behaviour.

**Non-Goals:**
- LiteRT 2.x (CompiledModel port). LiteRT stays at 1.4.2 (proposal, "Not in this change").
- Raising `targetSdk` or `minSdk`. A `targetSdk` raise changes platform behaviour and follows Play's deadline on its own schedule.
- Clearing the Gradle 10 deprecations that come from Chaquopy or Capacitor themselves.

## Decisions

### D1. Start only when every piece is stable

Apply starts when all of these have stable releases on npm: `@capacitor/core`, `@capacitor/android` and `@capacitor/cli` 9.x, plus `@capacitor/app`, `@capacitor/device` and `@capacitor/filesystem` 9.x. Task 1.1 checks this. Until then, the change waits.

`@capacitor-community/keep-awake` is a community plugin and may lag behind. If it has no stable Capacitor 9 release when the rest are ready, we replace it with our own small plugin rather than wait. Keeping the screen on is `FLAG_KEEP_SCREEN_ON` on the activity window, about 20 lines of Kotlin, and the app already ships Kotlin plugins. Like any new plugin call, it comes with its contract example in `fixtures/bridge/`.

- Alternative: AGP 9 on Capacitor 8 now. Rejected (user decision, 2026-11-22). The combination is unsupported, and we would redo the Capacitor part later anyway.
- Alternative: Capacitor 9 release candidate. Rejected: we use stable dependencies only.

### D2. Versions follow Capacitor 9, capped by Chaquopy

Take the AGP and Gradle versions that Capacitor 9's own template and `cap migrate` use, not the newest available. Today those are AGP 9.4.1 and Gradle 9.8.2. Take the newest Kotlin whose compatibility table covers that AGP and Gradle, or the nearest. That is the combination the Capacitor plugins are tested on.

The cap is Chaquopy's documented AGP range: today 17.2.0 lists 7.3–9.5. If Capacitor 9 final needs a newer AGP than Chaquopy lists, wait for a Chaquopy release that covers it. Task 1.2 records the chosen versions in this section before any build file changes.

- Alternative: the newest of everything (AGP 9.5.2, Gradle 9.9.2, Kotlin 2.4.21). Rejected: that combination is outside what the vendors list, and it gains nothing.

### D3. Built-in Kotlin and the new DSL, with no opt-outs

- Remove `apply plugin: 'org.jetbrains.kotlin.android'`.
- Keep `kotlin-gradle-plugin` on the root classpath with `ext.kotlin_version`. That lets us pick the Kotlin version, and `@capacitor/filesystem` reads `ext.kotlin_version`. Drop them only if no plugin reads `kotlin_version` any more.
- Drop the `kotlin { compilerOptions { jvmTarget } }` block. With built-in Kotlin it defaults to `compileOptions.targetCompatibility`, which is 21.
- Use `proguard-android-optimize.txt`. R8 stays off (`minifyEnabled false`), so this changes nothing in the APK.
- Use `assets.srcDir(modelAssets)`.
- Read the `variables.gradle` values through `rootProject.ext` explicitly, as Capacitor 9's own migration guide does.

Rejected: `android.builtInKotlin=false` and `android.newDsl=false`. They break Capacitor 9 and are removed in AGP 10.

### D4. Migrate with Capacitor's tool, then review by hand

Run the Capacitor 9 CLI's `cap migrate` on `android/` on a branch and review its diff line by line. Keep our additions:
- Chaquopy and `syncHomrPython`
- `checkModelAssets` and `noCompress`
- the `dev` build type and the upload-key signing
- the manifest's removed `INTERNET` permission and the Reader's foreground service
- the root `subprojects` block that disables the libraries' androidTest variants

Rejected: regenerating `android/` from Capacitor's template and porting our additions again. That means more change for the same result.

### D5. Checks beyond the test layers

The test layers prove behaviour. Two checks prove the APK did not change in ways the tests do not see:
- The merged release manifest has the same permissions and features as before. Diff `processReleaseMainManifest` output before and after. This matters for Play's data-safety form.
- The `.tflite` and `.onnx` files are still stored uncompressed (`unzip -v` shows method "Stored"). LiteRT and ONNX Runtime memory-map them.

## Risks / Trade-offs

- [Capacitor 9 final changes something the rc did not, such as bridge or plugin behaviour.] → The fake bridge's contract fixtures and the device smoke test (`make test-device`) catch bridge changes. D4's diff review catches build changes.
- [Capacitor 9 final picks an AGP newer than Chaquopy lists.] → D2 caps at Chaquopy's range. Wait for Chaquopy, or stay on the newest AGP within its range if Capacitor builds with it.
- [The keep-awake plugin lags.] → Replace it with our own plugin (D1).
- [Build-script lines that the research could not confirm without a trial build: `noCompress +=`, `initWith debug`, `aaptOptions` inside `defaultConfig`, and the root `beforeVariants { androidTest.enable = false }` hook.] → Task 3.2 builds every variant, and the merged-APK checks of D5 catch silent changes.
- [Gradle 10 deprecation warnings from Chaquopy and Capacitor (multi-string dependency notation, parent-project lookups).] → Accepted. They are warnings on Gradle 9. Task 3.3 lists those left after our own fixes.
- [Wait time: Capacitor 9's plugins may take weeks to go stable.] → Nothing forces the upgrade now. Capacitor 8 on AGP 8.13 is supported and the app meets Play's current requirements.

## Migration Plan

This is a build-only change, released in the next app version like any other. To roll back, revert the change's commits. Stored pieces and preferences are untouched. The GPU self-test reruns once after the update because the app version changes; that is normal for every update.
