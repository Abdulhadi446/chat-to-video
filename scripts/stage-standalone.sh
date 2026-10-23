#!/usr/bin/env bash
# Stage the standalone build in a deploy-like app root for local production tests.
# Usage: scripts/stage-standalone.sh && (cd .run/app && PORT=3111 HOSTNAME=127.0.0.1 node server.js)
set -euo pipefail

cd "$(dirname "$0")/.."
STAGE="${STAGE:-.run/app}"

if [ ! -f .next/standalone/server.js ]; then
  echo "missing .next/standalone/server.js — run npm run build first" >&2
  exit 1
fi
if [ ! -f .env ]; then
  echo "missing .env — create it from .env.example first" >&2
  exit 1
fi

# Next copies .env / .env.production into standalone by design. Strip them so
# build artifacts never carry secrets; the app root gets .env explicitly below.
find .next/standalone -maxdepth 1 -name '.env*' -delete

rm -rf "$STAGE"
mkdir -p "$STAGE/.next"
cp -a .next/standalone/. "$STAGE"/
rm -rf "$STAGE/.next/static"
cp -a .next/static "$STAGE/.next/static"
rm -rf "$STAGE/public"
if [ -d public ]; then cp -a public "$STAGE/public"; fi
cp video-generation.md "$STAGE/video-generation.md"
cp .env "$STAGE/.env"
mkdir -p "$STAGE/data"
ln -sfn "$PWD/tools" "$STAGE/tools"

echo "staged $STAGE"
