#!/usr/bin/env bash
#
# What the artifact will actually claim to be, read back off the bundle.
#
# The failure this catches is silent by nature: a certificate that did not import, or an identity
# that did not match, leaves a perfectly working ad-hoc build — and nobody finds out until the
# release is installed and the permissions are gone. `cdhash` in the requirement is the tell.
#
# See `packages/desktop/electron-builder.yml` for why a certificate-bound identity is what makes an
# update the same application rather than a stranger.

set -euo pipefail

APP=$(find packages/desktop/release -maxdepth 2 -name 'Lyra.app' -print -quit)
if [ -z "$APP" ]; then
	echo "::error::no Lyra.app in the release output"
	exit 1
fi

REQUIREMENT=$(codesign -d -r- "$APP" 2>&1 | tail -1)
echo "$REQUIREMENT"

case "$REQUIREMENT" in
	*"certificate leaf"*)
		echo "signed with a durable identity: updates keep their permissions"
		;;
	*cdhash*)
		# Ad-hoc. Whether that is a failure depends on whether a certificate was supposed to be here.
		if [ "${REQUIRE_SIGNING:-false}" = "true" ] || [ "${HAVE_CERT:-false}" = "true" ]; then
			echo "::error::ad-hoc signed despite a certificate being present — the import or the identity name is wrong, and this build would reset every permission"
			exit 1
		fi
		echo "::warning::ad-hoc signed, as expected without a certificate"
		;;
	*)
		echo "::error::unrecognised designated requirement — refusing to ship a build whose identity cannot be read"
		exit 1
		;;
esac
