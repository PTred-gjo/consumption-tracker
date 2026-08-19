#!/usr/bin/env bash
#
# Creates the Google Play upload keystore and prints everything needed to
# configure local and CI signing.
#
# Run this yourself, on a machine you control. The key it produces is the
# permanent identity of the app on Play: if it is lost, no further update can
# ever be published under the same listing. Back it up before anything else.
#
#   ./scripts/create-keystore.sh
#
set -euo pipefail

KEYSTORE="${1:-upload.jks}"
ALIAS="${FUELPILOT_ALIAS:-fuelpilot}"

if [ -e "$KEYSTORE" ]; then
  echo "Refusing to overwrite the existing $KEYSTORE." >&2
  echo "Signing keys cannot be regenerated — move the old one aside first." >&2
  exit 1
fi

command -v keytool >/dev/null 2>&1 || {
  echo "keytool not found. Install a JDK 17 and try again." >&2
  exit 1
}

echo "Creating $KEYSTORE with alias '$ALIAS'."
echo "You will be asked for a password and some identifying details."
echo

keytool -genkeypair -v \
  -keystore "$KEYSTORE" \
  -alias "$ALIAS" \
  -keyalg RSA -keysize 2048 \
  -validity 10000

chmod 600 "$KEYSTORE"

ABS_PATH="$(cd "$(dirname "$KEYSTORE")" && pwd)/$(basename "$KEYSTORE")"

cat <<EOF

────────────────────────────────────────────────────────────────────
Done: $ABS_PATH

1. BACK IT UP NOW, together with the passwords, somewhere that is not
   this repository. Losing it ends your ability to update the app.

2. For local release builds, create android/keystore.properties
   (already gitignored):

       storeFile=$ABS_PATH
       storePassword=<the store password you just chose>
       keyAlias=$ALIAS
       keyPassword=<the key password you just chose>

3. For CI, add four repository secrets under
   Settings → Secrets and variables → Actions:

       ANDROID_KEYSTORE_BASE64     see the command below
       ANDROID_KEYSTORE_PASSWORD   the store password
       ANDROID_KEY_ALIAS           $ALIAS
       ANDROID_KEY_PASSWORD        the key password

   Generate the base64 value with:

       base64 -w0 "$ABS_PATH"        # Linux
       base64 -i "$ABS_PATH" | tr -d '\\n'   # macOS

   Paste the output as ANDROID_KEYSTORE_BASE64. Do not commit it and do
   not paste it into a chat or an issue.

4. Verify the fingerprint matches what Play shows after your first
   upload:

       keytool -list -v -keystore "$ABS_PATH" -alias $ALIAS
────────────────────────────────────────────────────────────────────
EOF
