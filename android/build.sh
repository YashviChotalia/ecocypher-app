#!/usr/bin/env bash
# Builds EcoCypher.apk from ../app/dist using Ubuntu's android-sdk packages:
#   apt-get install aapt android-sdk-platform-23 apksigner dalvik-exchange zipalign
set -euo pipefail
export JAVA_TOOL_OPTIONS=""
cd "$(dirname "$0")"
AJ=/usr/lib/android-sdk/platforms/android-23/android.jar
rm -rf out && mkdir -p out/classes out/gen
aapt package -f -m -J out/gen -M AndroidManifest.xml -S res -I $AJ
javac -nowarn -source 8 -target 8 -bootclasspath $AJ -Xlint:-options -d out/classes $(find src out/gen -name '*.java')
test -f out/classes/foo/nosus/ecocypher/MainActivity.class || { echo "MainActivity not compiled"; exit 1; }
dalvik-exchange --dex --min-sdk-version=24 --output=out/classes.dex out/classes
aapt package -f -M AndroidManifest.xml -S res -A assets -I $AJ -F out/unsigned.apk
(cd out && aapt add unsigned.apk classes.dex >/dev/null)
zipalign -f -p 4 out/unsigned.apk out/aligned.apk
[ -f ecocypher-release.keystore ] || keytool -genkeypair -keystore ecocypher-release.keystore -storepass ecocypher2026 -keypass ecocypher2026 -alias ecocypher -keyalg RSA -keysize 2048 -validity 10000 -dname "CN=EcoCypher, O=NOSUS CORE, C=IN"
apksigner sign --ks ecocypher-release.keystore --ks-pass pass:ecocypher2026 --ks-key-alias ecocypher --out out/EcoCypher.apk out/aligned.apk
apksigner verify out/EcoCypher.apk && echo "signature OK"
dexdump out/classes.dex | grep "Lfoo/nosus/ecocypher/MainActivity;" >/dev/null && echo "dex OK: MainActivity present"
