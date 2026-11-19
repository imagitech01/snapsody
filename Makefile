# Test entry points (openspec test-pyramid, design T1). See docs/testing.md.
#
#   make test-quick    unit tests (web and Kotlin JVM), <= 30 s warm
#   make test-mac      quick, then the web UI tests in headless Chromium, <= 3 min warm
#   make test-device   the end-to-end smoke test on the emulator (DEVICE=phone for the S24)
#
# Each target prints its duration and exits non-zero when a test fails.
#
#   make bundle        the signed release bundle for Google Play (docs/release.md)

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

.PHONY: test-quick test-mac test-device bundle

GRADLE = cd android && ./gradlew --console=plain -q

test-quick:
	$(call timed,test-quick,(cd web && npm test) && ($(GRADLE) :app:testDebugUnitTest))

test-mac:
	$(call timed,test-mac,$(MAKE) --no-print-directory test-quick && (cd web && npm run -s test:ui))

test-device:
	$(call timed,test-device,DEVICE=$(DEVICE) tools/test/device.sh)

bundle:
	$(GRADLE) :app:bundleRelease
	@echo "android/app/build/outputs/bundle/release/app-release.aab"
