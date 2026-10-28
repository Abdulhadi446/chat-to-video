#!/usr/bin/env bash
# Deploy the locally built standalone app to tests2 and (re)start the named tunnel.
# Public URL: https://testings.thetrillioniar.me
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
  "FFMPEG_PATH=/usr/bin/ffmpeg" \
  "FFPROBE_PATH=/usr/bin/ffprobe" \
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
ssh tests2 "cd $APP && export PATH=\$HOME/.nvm/versions/node/v22.23.4/bin:\$HOME/tools/piper:\$HOME/.opencode/bin:\$PATH && \
  fuser -k 3000/tcp 2>/dev/null || true; sleep 1; \
  setsid env PORT=3000 HOSTNAME=127.0.0.1 node server.js > app.log 2>&1 < /dev/null &"
sleep 3

echo "== ensure named tunnel"
# The named tunnel is independent of app code. Restarting it is unnecessary and
# can hang a non-interactive SSH session, so only start it when it is absent.
if ! ssh tests2 "ps -eo args | grep -q '^cloudflared tunnel --config /home/ubuntu/.cloudflared/chat-to-video.yml run'"; then
  echo "named tunnel not running; starting it"
  ssh tests2 "cd $APP && setsid cloudflared tunnel --config /home/ubuntu/.cloudflared/chat-to-video.yml run > named-tunnel.log 2>&1 < /dev/null &" || true
  sleep 6
fi

URL="https://testings.thetrillioniar.me"
if ! ssh tests2 "ps -eo args | grep -q '^cloudflared tunnel --config /home/ubuntu/.cloudflared/chat-to-video.yml run'"; then
  echo "named tunnel is not running; tail:" >&2
  ssh tests2 "tail -20 $APP/named-tunnel.log" >&2
  exit 1
fi
echo "LIVE_URL=$URL"
curl -fsS -m 15 "$URL/api/health" && echo
