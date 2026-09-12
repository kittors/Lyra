#!/usr/bin/env bash
#
# Build the iPhone app and wrap it as an .ipa, without signing it.
#
# **Why unsigned.** Putting a signed build on someone's phone needs an Apple Developer account:
# $99 a year, and the device UDIDs enrolled in advance for anything short of TestFlight. Neither is
# something this repository has, and an .ipa nobody can install would be worse than no .ipa. So the
# release ships the app unsigned and the person installing it supplies the signature — Sideloadly,
# AltStore and Xcode's own "Devices" window all do exactly that, with a free Apple ID. The name
# says so: `-unsigned.ipa`.
#
# If an Apple account ever exists, this is where it goes: import the certificate and the profile
# the way `prepare-signing.sh` does for the desktop, drop `CODE_SIGNING_ALLOWED=NO`, and use
# `xcodebuild -exportArchive` instead of the zip at the bottom.
#
# **Why a script and not steps in the workflow.** So it can be run on a laptop. Everything here was
# arrived at by trying it: the scheme's name is not the slug, `-exportArchive` refuses to run
# without an identity, and `Payload/` has to be the archive's `.app` and nothing else. A workflow
# file cannot be rehearsed anywhere but on a runner; this can.
#
# Usage: bash .github/scripts/build-unsigned-ipa.sh <output-dir> <version>

set -euo pipefail

OUT_DIR="${1:?output directory}"
VERSION="${2:?version}"
MOBILE="packages/mobile"
IOS="$MOBILE/ios"

if [ ! -d "$IOS" ]; then
	echo "::error::$IOS does not exist — run \`expo prebuild --platform ios\` before this."
	exit 1
fi

# The workspace to build, and the scheme to build in it, both asked for rather than assumed.
#
# `expo prebuild` names the project after `expo.name` in app.json ("Lyra") — not the slug, not the
# bundle identifier — so a name hardcoded here would work until somebody renames the app and then
# fail in CI with "scheme not found" and nothing pointing at why.
#
# The scheme comes from the *project* and not from the workspace, which is the mistake this line
# is the fix for: a workspace lists every scheme CocoaPods generated into it as well, so asking it
# for "the first scheme" returns a Pod. It picked `EXConstants`, archived that, and then failed
# looking for an .app that a static library was never going to produce. `ios/*.xcodeproj` is the
# app's own project and nothing else — Pods keeps its project in `ios/Pods/`.
WORKSPACE=$(ls -d "$IOS"/*.xcworkspace | head -1)
PROJECT=$(ls -d "$IOS"/*.xcodeproj | head -1)
SCHEME=$(xcodebuild -list -json -project "$PROJECT" | node -e '
	let raw = "";
	process.stdin.on("data", (chunk) => (raw += chunk));
	process.stdin.on("end", () => {
		const project = JSON.parse(raw).project ?? {};
		const scheme = (project.schemes ?? [])[0] ?? project.name;
		if (!scheme) { console.error("no scheme in " + JSON.stringify(project)); process.exit(1); }
		process.stdout.write(scheme);
	});
')
echo "workspace: $WORKSPACE"
echo "scheme:    $SCHEME"

ARCHIVE="$OUT_DIR/$SCHEME.xcarchive"
mkdir -p "$OUT_DIR"

# What the build number should turn out to be. Only for checking: the value that reaches the build
# is `ios.buildNumber` in app.json, which prebuild writes into the generated Info.plist. iOS
# expects it to rise between builds of the same version string, and `Devices and Simulators` uses
# it to decide whether what you are installing is newer than what is on the phone.
#
# Same number Android's versionCode gets, and the same reason it is derived rather than stored —
# `scripts/versions.mjs` has that.
BUILD_NUMBER=$(node scripts/build-number.mjs)
echo "build number: $BUILD_NUMBER"

# `CODE_SIGNING_ALLOWED=NO` is the whole of "unsigned".
#
# The three settings are not redundant: `CODE_SIGNING_REQUIRED=NO` lets the build finish without an
# identity, `CODE_SIGN_IDENTITY=""` stops Xcode picking one out of the keychain anyway, and
# `CODE_SIGNING_ALLOWED=NO` is what makes it skip the step for the embedded frameworks too — miss
# it and the archive fails on the first Pod, not on the app.
#
# `-destination 'generic/platform=iOS'` rather than a device: there is no device, and without it
# xcodebuild picks a simulator and produces an archive that no phone will ever run.
xcodebuild archive \
	-workspace "$WORKSPACE" \
	-scheme "$SCHEME" \
	-configuration Release \
	-destination 'generic/platform=iOS' \
	-archivePath "$ARCHIVE" \
	-quiet \
	CODE_SIGNING_ALLOWED=NO \
	CODE_SIGNING_REQUIRED=NO \
	CODE_SIGN_IDENTITY="" \
	CODE_SIGN_ENTITLEMENTS=""

APP=$(ls -d "$ARCHIVE/Products/Applications"/*.app | head -1)

# An .ipa is a zip with the bundle inside a directory called `Payload`. That is the entire format,
# and it is why `-exportArchive` — which exists to sign, thin and re-sign — is not needed here.
STAGE="$OUT_DIR/stage"
rm -rf "$STAGE"
mkdir -p "$STAGE/Payload"
cp -R "$APP" "$STAGE/Payload/"

IPA="$OUT_DIR/Lyra-$VERSION-ios-unsigned.ipa"
rm -f "$IPA"
(cd "$STAGE" && zip -qry "$(basename "$IPA")" Payload && mv "$(basename "$IPA")" ..)
rm -rf "$STAGE"

# Say what is inside it, because "the zip exists" is not the same as "the app is in it": an archive
# whose `Applications` directory is empty produces a perfectly valid, perfectly useless 22-byte ipa.
echo
echo "$(basename "$IPA") — $(du -h "$IPA" | cut -f1)"
unzip -l "$IPA" | grep -E "Payload/[^/]+\.app/($SCHEME|Info\.plist|main\.jsbundle)$" || {
	echo "::error::the ipa has no application binary, Info.plist or JavaScript bundle inside Payload/"
	exit 1
}

# And what it says it is. Read back from the built app rather than from the file that was edited:
# the question is what the phone will see, and the two are the same only if Xcode copied what it
# was given.
BUILT_VERSION=$(/usr/libexec/PlistBuddy -c "Print :CFBundleShortVersionString" "$APP/Info.plist")
BUILT_BUILD=$(/usr/libexec/PlistBuddy -c "Print :CFBundleVersion" "$APP/Info.plist")
echo "CFBundleShortVersionString: $BUILT_VERSION (expected $VERSION)"
echo "CFBundleVersion:            $BUILT_BUILD (expected $BUILD_NUMBER)"

if [ "$BUILT_VERSION" != "$VERSION" ]; then
	echo "::error::the app carries version $BUILT_VERSION, not $VERSION — app.json and the root package.json have drifted."
	exit 1
fi
if [ "$BUILT_BUILD" != "$BUILD_NUMBER" ]; then
	echo "::error::the app carries build number $BUILT_BUILD, not $BUILD_NUMBER — app.json's ios.buildNumber did not reach the build."
	exit 1
fi
