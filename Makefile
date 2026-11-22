# Test entry points (openspec test-pyramid, design T1). See docs/testing.md.
#
#   make test-quick     unit tests (web and Kotlin JVM), <= 30 s warm
#   make test-browser   quick, then the web UI tests in headless Chromium, <= 3 min warm
#   make test-device    the end-to-end smoke test on the emulator (DEVICE=phone for a connected phone)
#
# Each target prints its duration and exits non-zero when a test fails.
#
#   make bundle         the signed release bundle for Google Play (docs/release.md)
#
#   make dev-phone      builds the dev app (be.imagitech.snapsody.dev, next to the Play app) and installs it on the phone
#   make dev-log        follows its diagnostics in logcat (docs/testing.md "Dev build on the phone")

SHELL := /bin/bash
.SHELLFLAGS := -o pipefail -c

NOW = perl -MTime::HiRes=time -e 'printf "%.1f", time'

# $(call timed,<name>,<commands>): runs the commands, prints the duration, keeps the exit code.
define timed
	@start=$$($(NOW)); \
	( set -e; $(2) ); status=$$?; \
	end=$$($(NOW)); \
	printf '\n%s: %s in %.1f s\n' "$(1)" "$$([ $$status -eq 0 ] && echo passed || echo FAILED)" "$$(echo "$$end - $$start" | bc)"; \
	exit $$status
endef

.PHONY: test-quick test-browser test-device bundle dev-phone dev-log

GRADLE = cd android && ./gradlew --console=plain -q

test-quick:
	$(call timed,test-quick,(cd web && npm test) && ($(GRADLE) :app:testDebugUnitTest))

test-browser:
	$(call timed,test-browser,$(MAKE) --no-print-directory test-quick && (cd web && npm run -s test:ui))

test-device:
	$(call timed,test-device,DEVICE=$(DEVICE) tools/test/device.sh)

bundle:
	$(GRADLE) :app:bundleRelease
	@echo "android/app/build/outputs/bundle/release/app-release.aab"

# The SDK: ANDROID_HOME, else ANDROID_SDK_ROOT, else where Android Studio puts it (macOS or Linux).
SDK = $${ANDROID_HOME:-$${ANDROID_SDK_ROOT:-$$([ "$$(uname)" = Darwin ] && echo "$$HOME/Library/Android/sdk" || echo "$$HOME/Android/Sdk")}}
ADB = "$(SDK)/platform-tools/adb"
# The phone: ANDROID_SERIAL when set, else the first device adb lists that is not an emulator.
PHONE = $${ANDROID_SERIAL:-$$($(ADB) devices | awk 'NR > 1 && $$2 == "device" && $$1 !~ /^emulator-/ { print $$1; exit }')}
DEV_APP = be.imagitech.snapsody.dev

dev-phone:
	$(GRADLE) :app:assembleDev
	@serial=$(PHONE); [ -n "$$serial" ] || { echo "no phone connected (adb devices)" >&2; exit 1; }; \
	$(ADB) -s "$$serial" install -r android/app/build/outputs/apk/dev/app-dev.apk

# Follows the dev app's [diag] lines and console errors, also across restarts of the app (the Play app logs nothing:
# Capacitor forwards the console of debug builds only). Clears the old log first.
dev-log:
	@serial=$(PHONE); [ -n "$$serial" ] || { echo "no phone connected (adb devices)" >&2; exit 1; }; \
	$(ADB) -s "$$serial" logcat -c; \
	$(ADB) -s "$$serial" logcat -v time -s Capacitor/Console:V AndroidRuntime:E | grep --line-buffered -E '\[diag\]|/Console.*(Error|error|Uncaught)|AndroidRuntime'
