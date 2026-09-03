#!/usr/bin/env bash
#
# Put the macOS signing identity where codesign will find it.
#
# Every line here was arrived at by something failing in a way that did not name itself. The
# comments are the record of that; do not condense them.
#
# `REQUIRE_SIGNING` is the one thing that differs between a real release and a rehearsal:
#
#   true   a missing certificate is fatal. Shipping an ad-hoc build to people already running a
#          signed one revokes every permission they have granted, on every machine, and a published
#          release cannot be taken back. A secret that expires, gets renamed, or is lost with the
#          repository settings would otherwise produce exactly that — as a yellow warning in a job
#          that goes green, which is the shape of a mistake nobody catches.
#   false  a missing certificate is a warning. A rehearsal without secrets should still rehearse
#          the packaging.
#
# The absence of the secret is handled here rather than in the step's `if:` — the `secrets` context
# is not available to a step condition, so `secrets.X != ''` there is not false when the secret is
# missing, it is a workflow that does not do what it reads as doing.

set -euo pipefail

if [ -z "${MAC_CERTIFICATE_P12:-}" ]; then
	if [ "${REQUIRE_SIGNING:-false}" = "true" ]; then
		echo "::error::MAC_CERTIFICATE_P12 is not set. An ad-hoc signed release resets every permission on every machine that installs it, and cannot be withdrawn. Set MAC_CERTIFICATE_P12 and MAC_CERTIFICATE_PASSWORD in the repository secrets — see packages/desktop/scripts/make-signing-cert.sh."
		exit 1
	fi
	echo "::warning::MAC_CERTIFICATE_P12 is not set — this build will be ad-hoc signed"
	exit 0
fi

KEYCHAIN="$RUNNER_TEMP/lyra-signing.keychain"
# Local to this runner and thrown away with it, so its password protects nothing that outlives the job.
KEYCHAIN_PASSWORD=$(openssl rand -base64 24)

echo "$MAC_CERTIFICATE_P12" | base64 --decode > "$RUNNER_TEMP/certificate.p12"

security create-keychain -p "$KEYCHAIN_PASSWORD" "$KEYCHAIN"
# Without this the keychain relocks on a timer and a long build signs nothing.
security set-keychain-settings -lut 21600 "$KEYCHAIN"
security unlock-keychain -p "$KEYCHAIN_PASSWORD" "$KEYCHAIN"
security import "$RUNNER_TEMP/certificate.p12" -k "$KEYCHAIN" -P "$MAC_CERTIFICATE_PASSWORD" -T /usr/bin/codesign

# A self-signed certificate is listed by `find-identity` but reported CSSMERR_TP_NOT_TRUSTED, and
# codesign then answers "no identity found" — so it has to be trusted explicitly, which takes the
# certificate on its own rather than the .p12.
openssl pkcs12 -legacy -in "$RUNNER_TEMP/certificate.p12" -passin "pass:$MAC_CERTIFICATE_PASSWORD" \
	-clcerts -nokeys -out "$RUNNER_TEMP/certificate.pem"

# `sudo` and the system keychain, not the user domain.
#
# Writing a trust setting into the *user* domain asks for authorisation through the window server —
# a dialog nobody is there to click, so the step does not fail, it hangs until the job's time limit.
# Observed: 15 minutes and still spinning. The admin domain takes the same decision through sudo,
# which a runner has without a password.
sudo security add-trusted-cert -d -r trustRoot \
	-k /Library/Keychains/System.keychain "$RUNNER_TEMP/certificate.pem"

# `codesign:` in the partition list, or reaching the private key waits on a GUI prompt that no one
# will ever click.
security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k "$KEYCHAIN_PASSWORD" "$KEYCHAIN" > /dev/null

# codesign searches the user's keychain list, not a keychain it has never been told about.
security list-keychains -d user -s "$KEYCHAIN" $(security list-keychains -d user | tr -d '"')

rm -f "$RUNNER_TEMP/certificate.p12" "$RUNNER_TEMP/certificate.pem"
security find-identity -v -p codesigning "$KEYCHAIN"
