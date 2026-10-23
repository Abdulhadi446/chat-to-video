#!/usr/bin/env bash
# Deploy the locally built standalone app to tests2 and (re)start the quick tunnel.
# Usage: ./scripts/deploy-tests2.sh          (reuses .next/standalone)
#        SKIP_BUILD=0 ./scripts/deploy-tests2.sh  (rebuild first)
set -euo pipefail

cd "$(dirname "$0")/.."
APP=/home/ubuntu/apps/chat-to-video
TMP_ENV=$(mktemp)
trap 'rm -f "$TMP_ENV"' EXIT

if [ "${SKIP_BUILD:-1}" = "0" ]; then
  npm run build
fi

if [ ! -f .next/standalone/server.js ]; then
  echo "missing .next/standalone/server.js — run npm run build" >&2
  exit 1
fi
if [ ! -f .env ]; then
  echo "missing .env" >&2
  exit 1
fi

# Compose the remote env: app secrets + server-only paths. Never log contents.
cp .env "$TMP_ENV"
for line in \
  "NODE_ENV=production" \
  "FFMPEG_PATH=/home/ubuntu/bin/ffmpeg" \
  "FFPROBE_PATH=/home/ubuntu/bin/ffprobe" \
  "PIPER_PATH=/home/ubuntu/tools/piper/piper" \
  "PIPER_MODEL=/home/ubuntu/tools/piper/voices/en_US-lessac-medium.onnx" \
  "OPENCODE_BIN=/home/ubuntu/.opencode/bin/opencode" \
  "OPENCODE_TIMEOUT_MS=180000" \
  "DATABASE_URL=file:./data/app.db"
do
  key=${line%%=*}
  grep -q "^${key}=" "$TMP_ENV" || printf '\n%s\n' "$line" >> "$TMP_ENV"
done

echo "== sync app"
ssh tests2 "mkdir -p $APP"
rsync -az --delete --exclude /data --exclude /tools --exclude /.env \
  .next/standalone/ "tests2:$APP/"
rsync -az --delete .next/static/ "tests2:$APP/.next/static/"
if [ -d public ]; then rsync -az --delete public/ "tests2:$APP/public/"; fi
rsync -az video-generation.md "tests2:$APP/video-generation.md"
scp -q "$TMP_ENV" "tests2:$APP/.env"

echo "== restart server"
ssh tests2 "cd $APP && export PATH=\$HOME/bin:\$HOME/tools/node/bin:\$HOME/.opencode/bin:\$PATH && \
  fuser -k 3000/tcp 2>/dev/null || true; sleep 1; \
  setsid env PORT=3000 HOSTNAME=127.0.0.1 node server.js > app.log 2>&1 < /dev/null &"
sleep 3

echo "== restart tunnel"
ssh tests2 "pkill -x cloudflared 2>/dev/null || true; sleep 1; \
  cd $APP && setsid cloudflared tunnel --config /dev/null --url http://127.0.0.1:3000 --no-autoupdate > tunnel.log 2>&1 < /dev/null &"
sleep 6

URL=$(ssh tests2 "grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' $APP/tunnel.log | head -1" | tr -d '\r')
if [ -z "$URL" ]; then
  echo "tunnel URL not found; tail:" >&2
  ssh tests2 "tail -20 $APP/tunnel.log" >&2
  exit 1
fi
echo "LIVE_URL=$URL"
curl -fsS -m 10 "$URL/api/health" && echo
