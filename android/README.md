# EcoCypher Android (APK)

Native Android shell around the EcoCypher ESG web app. The built web app is bundled inside the APK
and served from `https://appassets.ecocypher.local/`, so it works offline in demo mode.

Bridged to Android: CSV/JSON export → "Save to…" dialog, "Save as PDF" → Android print dialog,
file pickers (evidence, CSV import), camera for QR scanning (asks permission once).

## Rebuild
```
npm ci && npm run build            # in the app root, with .env if using Supabase
rm -rf android/assets/www && cp -r dist android/assets/www && rm android/assets/www/sw.js
cp android/native-bridge.js android/assets/www/
# add <script src="/native-bridge.js"></script> right after <head> in android/assets/www/index.html
bash android/build.sh               # needs: apt install aapt android-sdk-platform-23 apksigner dalvik-exchange zipalign
```
Bump `versionCode` in AndroidManifest.xml for each update. Keep `ecocypher-release.keystore`
(password `ecocypher2026`, alias `ecocypher`) safe: updates must be signed with the same key.
