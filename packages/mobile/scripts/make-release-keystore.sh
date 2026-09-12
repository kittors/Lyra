#!/usr/bin/env bash
#
# The one key every Android release is signed with, and the four secrets CI needs to use it.
#
# Android decides whether two APKs are "the same app" by their signing certificate. Change the key
# and the phone refuses the update: the user has to uninstall, which takes their pairing with it.
# So this key is generated once, kept forever, and belongs in a password manager — losing it means
# every installed copy is stranded on its last version.
#
# 27 years of validity because Google Play requires at least 25 from the upload key, and because a
# key that expires is a release that stops being possible on a date nobody wrote down.
#
# Run it once:
#
#     bash packages/mobile/scripts/make-release-keystore.sh
#
# It writes nothing into the repository — `signing/` is ignored, and the four values it prints are
# the whole of what CI needs.

set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)
OUT="$ROOT/signing/lyra-release.keystore"
ALIAS=lyra

if [ -f "$OUT" ]; then
	echo "已经有一个了：$OUT"
	echo "别覆盖它——换一把钥匙等于让所有装过的人先卸载。要看它的内容：keytool -list -v -keystore $OUT"
	exit 1
fi

# Hex, not base64, and not something a person typed.
#
# The password travels through a Java `.properties` file in CI, where a backslash is an escape
# character: a password containing one arrives at Gradle as a different password, and the build
# fails in the packaging task with a message about a keystore. Hex has no such character.
PASSWORD=$(openssl rand -hex 24)

mkdir -p "$(dirname "$OUT")"
keytool -genkeypair \
	-keystore "$OUT" \
	-storetype PKCS12 \
	-alias "$ALIAS" \
	-keyalg RSA -keysize 4096 \
	-validity 9999 \
	-storepass "$PASSWORD" \
	-keypass "$PASSWORD" \
	-dname "CN=Lyra, OU=Lyra, O=Lyra, C=CN"

echo
echo "写好了：$OUT"
echo "把它备份到密码管理器里。仓库里不会有第二份，`signing/` 在 .gitignore 里。"
echo
echo "把这四个设成仓库 secret（gh 已登录时直接粘贴下面四行）："
echo
echo "  gh secret set ANDROID_KEYSTORE_BASE64 --body \"$(base64 < "$OUT" | tr -d '\n')\""
echo "  gh secret set ANDROID_KEYSTORE_PASSWORD --body \"$PASSWORD\""
echo "  gh secret set ANDROID_KEY_ALIAS --body \"$ALIAS\""
echo "  gh secret set ANDROID_KEY_PASSWORD --body \"$PASSWORD\""
echo
echo "设完之后 Release dry run 会报「Release key ready」，发版时 APK 才带得上签名。"
