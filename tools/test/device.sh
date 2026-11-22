#!/bin/bash
# The device layer (openspec test-pyramid design T7b, practice-app design D15): `make test-device`
# runs be.imagitech.snapsody.EndToEndSmokeTest (android/app/src/androidTest) on the ia_test_api36 emulator,
# which it starts headless and stops again; `make test-device DEVICE=phone` runs it on the connected
# phone instead. See docs/testing.md.
#
# 1. builds the debug and test APKs, then stops the Gradle daemon (8 GB of RAM: the daemon's heap and
#    the 4 GB emulator do not fit together);
# 2. boots the emulator from the clean snapshot "ia_test_clean" (made on the first run, after a cold
#    boot) and never saves over it, so every run starts from the same state;
# 3. installs both APKs, runs the smoke test, and shuts the emulator down, also when something fails.
set -uo pipefail

AVD=ia_test_api36
SNAPSHOT=ia_test_clean
PORT=5584
# The SDK: ANDROID_HOME, else ANDROID_SDK_ROOT, else where Android Studio puts it (macOS or Linux).
SDK=${ANDROID_HOME:-${ANDROID_SDK_ROOT:-$([ "$(uname)" = Darwin ] && echo "$HOME/Library/Android/sdk" || echo "$HOME/Android/Sdk")}}
ADB=$SDK/platform-tools/adb
EMULATOR=$SDK/emulator/emulator
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
DEVICE=${DEVICE:-emulator}

now() { perl -MTime::HiRes=time -e 'printf "%.0f", time'; }
step() { printf '\n== %s\n' "$*"; }

step "build"
(cd "$ROOT/android" && ./gradlew --console=plain -q assembleDebug assembleDebugAndroidTest) || exit 1
(cd "$ROOT/android" && ./gradlew --stop -q)

if [ "$DEVICE" = phone ]; then
  SERIAL=${ANDROID_SERIAL:-$($ADB devices | awk 'NR > 1 && $2 == "device" && $1 !~ /^emulator-/ { print $1; exit }')}
  [ -n "$SERIAL" ] || { echo "no phone connected (adb devices)" >&2; exit 1; }
else
  SERIAL=emulator-$PORT
  stop_emulator() {
    $ADB -s "$SERIAL" emu kill > /dev/null 2>&1
    for _ in $(seq 1 60); do $ADB devices | grep -q "^$SERIAL" || break; perl -e 'select(undef,undef,undef,1)'; done
  }
  trap stop_emulator EXIT
  if $ADB devices | grep -q "^$SERIAL"; then echo "$SERIAL is already running; stop it first" >&2; trap - EXIT; exit 1; fi
  # An AVD runs once at a time: the same AVD started by hand on another port would block the boot.
  for other in $($ADB devices | awk 'NR > 1 && $1 ~ /^emulator-/ { print $1 }'); do
    if [ "$($ADB -s "$other" emu avd name 2> /dev/null | head -1 | tr -d '\r')" = "$AVD" ]; then
      echo "$AVD is already running as $other; stop it first (adb -s $other emu kill)" >&2; trap - EXIT; exit 1
    fi
  done
  step "boot $AVD"
  started=$(now)
  if [ -d "$HOME/.android/avd/$AVD.avd/snapshots/$SNAPSHOT" ]; then
    "$EMULATOR" -avd "$AVD" -port $PORT -no-window -no-boot-anim -snapshot "$SNAPSHOT" -no-snapshot-save > /dev/null 2>&1 &
    fresh=0
  else
    echo "no snapshot $SNAPSHOT yet: cold boot, then save it"
    "$EMULATOR" -avd "$AVD" -port $PORT -no-window -no-boot-anim -no-snapshot-load -no-snapshot-save > /dev/null 2>&1 &
    fresh=1
  fi
  for _ in $(seq 1 180); do $ADB devices | grep -q "^$SERIAL" && break; perl -e 'select(undef,undef,undef,1)'; done
  $ADB -s "$SERIAL" wait-for-device shell 'while [ -z "$(getprop sys.boot_completed)" ]; do sleep 1; done' || exit 1
  echo "booted in $(( $(now) - started )) s"
  if [ $fresh = 1 ]; then
    # The AVD may hold the app from earlier use: the snapshot must be a device that never had it.
    $ADB -s "$SERIAL" uninstall be.imagitech.snapsody.test > /dev/null 2>&1
    $ADB -s "$SERIAL" uninstall be.imagitech.snapsody > /dev/null 2>&1
    $ADB -s "$SERIAL" shell rm -rf /storage/emulated/0/Android/data/be.imagitech.snapsody
    $ADB -s "$SERIAL" emu avd snapshot save "$SNAPSHOT" > /dev/null && echo "saved snapshot $SNAPSHOT"
  fi
fi

step "install on $SERIAL"
$ADB -s "$SERIAL" install -r -t "$ROOT/android/app/build/outputs/apk/debug/app-debug.apk" | tail -1
$ADB -s "$SERIAL" install -r -t "$ROOT/android/app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk" | tail -1

step "EndToEndSmokeTest"
$ADB -s "$SERIAL" logcat -c
output=$($ADB -s "$SERIAL" shell am instrument -w -e class be.imagitech.snapsody.EndToEndSmokeTest \
  be.imagitech.snapsody.test/androidx.test.runner.AndroidJUnitRunner)
echo "$output"
$ADB -s "$SERIAL" logcat -d -s EndToEndSmokeTest:I InferenceThread:I | grep -E "took|accelerator" || true
echo "$output" | grep -q '^OK (1 test)' || { echo "EndToEndSmokeTest FAILED" >&2; exit 1; }
