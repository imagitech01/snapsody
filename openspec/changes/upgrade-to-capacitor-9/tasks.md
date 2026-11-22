# Tasks

## 1. Start check (design D1, D2)

- [ ] 1.1 Check that Capacitor 9 is ready. Run `npm view <pkg> version dist-tags` for `@capacitor/core`, `@capacitor/android`, `@capacitor/cli`, `@capacitor/app`, `@capacitor/device`, `@capacitor/filesystem` and `@capacitor-community/keep-awake`. Verify: each Capacitor package has a stable 9.x `latest`. If any of them does not, stop here; the change waits. For keep-awake, note whether it has a stable Capacitor 9 release (decides task 2.2).
- [ ] 1.2 Pick the versions and write them into design D2:
  - AGP and Gradle: from Capacitor 9's `android/capacitor/build.gradle` and its `cap migrate` wrapper version.
  - Kotlin: from the kotlinlang.org compatibility table.
  - Chaquopy: from its versions page.
  - Also capture the "before" state for D5: save the merged release manifest (`./gradlew :app:processReleaseMainManifest`, copied out of `android/app/build/intermediates/merged_manifest/release/`) and `unzip -v` of the release APK into the scratchpad.

  Verify: the chosen AGP is inside Chaquopy's documented range, and D2 names every version.

## 2. Capacitor 9 packages

- [ ] 2.1 Pin the Capacitor packages and plugins to their stable 9.x versions, exactly, in `web/package.json`; pin the CLI the same way in `tools/capacitor/package.json`; then run `npm install` in both. Update the credits entries, `web/public/licences/` sources and `NOTICE` for each changed package. Verify: quick layer, `make test-quick`. `web/test/credits.test.ts` "every dependency in the build files is credited with the same version" passes, and so does `web/test/pluginContract.test.ts` (the fake bridge still matches `fixtures/bridge/`).
- [ ] 2.2 Keep-awake, depending on task 1.1:
  - **If a stable Capacitor 9 release exists:** pin it and update its credit. Verify as in 2.1.
  - **If not:** replace it with our own plugin that sets `FLAG_KEEP_SCREEN_ON` on the activity window (design D1). Wire it in `web/src/platform/capacitor/device.ts` and `plugins.ts`, add its contract example to `fixtures/bridge/`, and remove the package and its credit. Verify, in the quick layer:
    - `web/test/pluginContract.test.ts` covers the new call;
    - a Kotlin JVM test in `android/app/src/test` checks the plugin's on/off logic;
    - `web/test/credits.test.ts` passes.

## 3. Android toolchain (design D2, D3, D4)

- [ ] 3.1 Run the Capacitor 9 CLI's `cap migrate` on `android/` (`npm run -s cap -- migrate` from `web/`), with Gradle 8 still in place. Review the diff line by line and keep our additions listed in design D4. Set the Gradle wrapper, AGP and Kotlin to the versions from D2, and `compileSdkVersion` to 37 in `variables.gradle`, leaving `targetSdkVersion` at 36 and `minSdkVersion` at 29. Verify: `cd android && ./gradlew :app:assembleDebug` builds.
- [ ] 3.2 Make the AGP 9 script changes from design D3 in `android/app/build.gradle`:
  - remove the `kotlin-android` plugin and the `kotlin { compilerOptions }` block;
  - use `proguard-android-optimize.txt`;
  - use `assets.srcDir(modelAssets)`;
  - read the `variables.gradle` values through `rootProject.ext`.

  Use no `android.builtInKotlin` or `android.newDsl` opt-outs in `gradle.properties`. Verify that these all build: `./gradlew :app:assembleDebug :app:assembleDev :app:assembleRelease :app:assembleDebugAndroidTest`. Also verify that `./gradlew :app:tasks --all` lists `assembleDebugAndroidTest` for `:app` only, so the libraries' androidTest variants stay disabled.
- [ ] 3.3 Run `./gradlew :app:assembleDebug --warning-mode all` and fix the warnings that come from our own scripts. List the remaining ones (from Chaquopy and Capacitor) under design "Risks / Trade-offs". Verify: none of the remaining warnings point to a file in `android/app/` or `android/build.gradle`.
- [ ] 3.4 Update the credits for the changed Maven coordinates (Kotlin, Cordova, and any AndroidX versions in `variables.gradle`), and update the toolchain paragraph in `docs/testing.md` ("`android/` is the Capacitor 8 Android project …"). Verify: quick layer, `make test-quick` (`web/test/credits.test.ts` and `:app:testDebugUnitTest`).

## 4. Integration checks

- [ ] 4.1 Run the browser layer, `make test-browser`. Verify: it passes, including the journey tests in `web/test/ui/`.
- [ ] 4.2 Run the APK checks from design D5, against the "before" captures from task 1.2. Verify:
  - the merged release manifest has the same `uses-permission` and `uses-feature` entries;
  - `unzip -v` on the release APK shows every `.tflite` and `.onnx` asset as "Stored".
- [ ] 4.3 Run the device layer once, before archive, on the emulator with `make test-device`. Verify: the smoke test passes (Capacitor bridge, Scanner page source, Reader foreground service, recognition).
- [ ] 4.4 Manual check on a real phone with `make dev-phone`: scan a two-page score with the ML Kit scanner and let it be read. Verify by eye: the scanner opens and returns the pages, and the piece opens with its notes.

## Workflow follow-up

- Archive the change once tasks 1–4 are done.
