#!/usr/bin/env bash
# Builds the EcoCypher web app and bundles it into the AppSail service, so one Catalyst
# AppSail URL serves the full app (incl. the Microgrid module) and the /api/* forecasting backend.
set -euo pipefail
cd "$(dirname "$0")/.."
npm ci
npm run build
rm -rf microgrid/appsail/static
cp -r dist microgrid/appsail/static
echo "Bundled dist/ into microgrid/appsail/static. Now: cd microgrid && catalyst deploy"
