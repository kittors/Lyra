#!/usr/bin/env bash
#
# Take Gradle's `app-release.apk` and turn it into the file a release can carry.
#
# Two things happen here, and the second is the reason this is a script rather than a `mv`:
#
#   the name says which release it belongs to, and — when there was no keystore — that it is not
#   one. `app-release.apk` in a release's asset list is a file nobody can place.
#
#   the APK is read back and asked what it actually is. Everything that decides the identity of
#   this file is an input Gradle is free to ignore without saying so, and one of them already did:
#   `-Pandroid.injected.version.code=9011` was accepted, the build succeeded, and the APK came out
#   carrying versionCode 1 — the value the template wrote, the value that makes every release
#   unable to update any other. That is the check below, and it is the check that found it. The
#   signing properties fail the same way: falling back to the debug key looks exactly like success.
#
# So the digest of this step is: the artifact says what it is, and what it says was measured.
#
# Usage: bash .github/scripts/finish-android-apk.sh <version> <expected-version-code>

set -euo pipefail

VERSION="${1:?version}"
EXPECTED_CODE="${2:?expected versionCode}"
APK_IN=packages/mobile/android/app/build/outputs/apk/release/app-release.apk
OUT_DIR=packages/mobile/dist

if [ ! -f "$APK_IN" ]; then
	echo "::error::Gradle reported success but $APK_IN is not there."
	exit 1
fi

# `-debugkey` when nothing signed it but the template.
#
# `prepare-android-signing.sh` decides this and says so through the environment; a release cannot
# reach here unsigned, because that script exits first. This covers the rehearsal, whose APK is
# downloadable from the run and would otherwise look like a release build.
SUFFIX=""
if [ "${LYRA_ANDROID_SIGNED:-false}" != "true" ]; then
	SUFFIX="-debugkey"
fi

APK_OUT="$OUT_DIR/Lyra-$VERSION-android$SUFFIX.apk"
mkdir -p "$OUT_DIR"
cp "$APK_IN" "$APK_OUT"

# aapt2 for the manifest, apksigner for the certificate. Both live in the SDK's newest
# `build-tools`, which is not on `PATH` — the runner has several versions and no opinion.
SDK="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}"
if [ -z "$SDK" ]; then
	echo "::error::Neither ANDROID_HOME nor ANDROID_SDK_ROOT is set, so aapt2 and apksigner cannot be found."
	exit 1
fi
BUILD_TOOLS=$(ls -d "$SDK"/build-tools/* | sort -V | tail -1)
echo "build-tools: $BUILD_TOOLS"

CODE=$("$BUILD_TOOLS/aapt2" dump badging "$APK_OUT" | sed -n "s/.*versionCode='\([0-9]*\)'.*/\1/p" | head -1)
NAME=$("$BUILD_TOOLS/aapt2" dump badging "$APK_OUT" | sed -n "s/.*versionName='\([^']*\)'.*/\1/p" | head -1)
echo "versionCode: $CODE (expected $EXPECTED_CODE)"
echo "versionName: $NAME (expected $VERSION)"

if [ "$CODE" != "$EXPECTED_CODE" ]; then
	echo "::error::The APK carries versionCode $CODE, not $EXPECTED_CODE. app.json's android.versionCode did not reach the build, so this release could not update any other."
	exit 1
fi
if [ "$NAME" != "$VERSION" ]; then
	echo "::error::The APK carries versionName $NAME, not $VERSION. app.json and the root package.json have drifted; test/version-sync.test.ts should have caught that."
	exit 1
fi

# Which certificate signed it, printed in full either way and checked when it matters.
#
# React Native's template debug key is a known quantity — its certificate says `CN=Android Debug`,
# and that string is what tells the two cases apart from the outside. The subject rather than a
# fingerprint on purpose: a fingerprint pinned here would have to be updated the day a real key is
# rotated, which is the day nobody wants a second surprise.
#
# Printed whole, and searched whole, because the first version of this parsed one line out of it
# (`^Signer #1 certificate DN: `) and came back empty on the runner — apksigner 37.0.0 says it
# some other way than the 36.0.0 measured on a laptop. An empty answer then flowed straight into
# the `grep` below, which of course did not find "Android Debug" in it, which read as "not the
# debug key". A check that cannot see anything must not report agreement, so a missing
# `certificate DN:` is a failure here rather than a pass — and the output is in the log so the
# next person does not have to guess at the wording either.
CERTS=$("$BUILD_TOOLS/apksigner" verify --print-certs "$APK_OUT")
echo "$CERTS"

if ! printf '%s\n' "$CERTS" | grep -q "certificate DN:"; then
	echo "::error::apksigner named no signing certificate for this APK, so what signed it is unknown. Its output is above."
	exit 1
fi
if [ "${LYRA_ANDROID_SIGNED:-false}" = "true" ] && printf '%s\n' "$CERTS" | grep -q "Android Debug"; then
	echo "::error::A release key was configured, but the APK came out signed with React Native's debug key — the injected signing properties were ignored."
	exit 1
fi

ls -la "$OUT_DIR"
