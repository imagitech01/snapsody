# Releasing to Google Play

Snapsody ships on Google Play from the ImagiTech developer account as `be.imagitech.snapsody`.
Play gets a signed Android App Bundle (`.aab`), built with `make bundle`.

## The upload key (once)

Play uses **Play App Signing**: Google keeps the key that signs the APKs users install, and we
sign each upload with our own **upload key**. If the upload key is lost or leaks, Google can
reset it, but that takes a support request, so keep a backup.

Create the key outside the repository. `keytool` asks for a password; with the default PKCS12
keystore the key has the same password.

```sh
mkdir -p ~/keys/imagitech
keytool -genkeypair -v -keystore ~/keys/imagitech/snapsody-upload.jks -alias upload \
  -keyalg RSA -keysize 4096 -validity 10000 -dname "CN=ImagiTech, O=ImagiTech, C=BE"
```

Then tell Gradle where it is, in `~/.gradle/gradle.properties` (not in the repository):

```properties
snapsody.upload.storeFile=/Users/<you>/keys/imagitech/snapsody-upload.jks
snapsody.upload.storePassword=<password>
snapsody.upload.keyAlias=upload
snapsody.upload.keyPassword=<password>
```

Back up the keystore file and its password, for example in the company password manager.
`.gitignore` excludes `*.jks`, `*.keystore`, `*.p12` and `keystore.properties`.

Without these properties every other build works as before (debug APKs, `make test-*`); only
`bundleRelease` stops and prints the lines above.

## Building a release

1. Raise `versionCode` in `android/app/build.gradle` (every upload needs a higher one) and set
   `versionName`.
2. `make bundle`. It builds the web layer, packs the models and signs the bundle:
   `android/app/build/outputs/bundle/release/app-release.aab`.
3. Upload it in the Play Console, first to internal testing.

The first upload ties the package name `be.imagitech.snapsody` to the app for good.

Only the bundle is shipped. `assembleRelease` makes an APK that is signed the same way but is not
used.

## Size

The recognition models (about 157 MB) are part of the base module, like in debug builds. The
first bundle (2026-11-19) was about 176 MB compressed for an arm64 phone, under Play's 500 MB
limit for the base module (https://support.google.com/googleplay/android-developer/answer/9859372,
checked 2026-11-19: all limits are on the compressed download size). If the models ever push it near that limit, an install-time asset
pack (Play Asset Delivery) can carry them without code changes: `ModelStore` reads through
`AssetManager`, which also sees install-time packs.

The models must stay uncompressed in the APKs (`noCompress` in `android/app/build.gradle`): LiteRT
memory-maps segnet with `openFd`, which fails on compressed entries.

## Checking a release build on the emulator

A bundle can be cut into the split APKs Play would send to one device, without bundletool, by
the task Android Studio uses for "deploy from bundle":

```sh
echo '{"supportedAbis":["arm64-v8a"],"supportedLocales":["en-US"],"screenDensity":420,"sdkVersion":36}' > /tmp/spec.json
(cd android && ./gradlew :app:extractApksForRelease -Pandroid.inject.apkselect.config=/tmp/spec.json)
adb install-multiple android/app/build/intermediates/extracted_apks/release/extractApksFromBundleForRelease/*.apk
```

On a fresh install the app runs the accelerator self-test at start, which memory-maps segnet and
reads `models.json` and the self-test tile. `adb logcat | grep -E "AcceleratorSelector|PythonEngine"`
shows it: `decision: ...` and `selftest: python ...`. On the emulator the decision is CPU (it has
no OpenCL).
