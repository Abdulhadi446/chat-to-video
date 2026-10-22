#!/usr/bin/env bash
# End-to-end smoke test: register -> chat -> generate -> poll -> download.
# Usage: BASE=http://localhost:3000 ./scripts/smoke.sh "a 10 second video about coffee"
set -euo pipefail

BASE="${BASE:-http://localhost:3000}"
PROMPT="${1:-a 10 second video about a coffee shop at sunrise, warm and cinematic}"
JAR="$(mktemp)"
EMAIL="smoke-$(date +%s)@example.com"
PASS="smoke-pass-1234"

j() { node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const v=JSON.parse(s);console.log(eval(process.argv[1]))}catch(e){console.error(s.slice(0,400));process.exit(1)}})' "$1"; }

echo "== health =="
curl -fsS "$BASE/api/health" | head -c 200; echo

echo "== register $EMAIL =="
curl -fsS -c "$JAR" -H 'content-type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASS\"}" "$BASE/api/auth/register" >/tmp/smoke-register.json
cat /tmp/smoke-register.json | head -c 200; echo

echo "== create chat =="
CHAT_ID=$(curl -fsS -b "$JAR" -H 'content-type: application/json' -d '{"title":"Smoke test"}' "$BASE/api/chats" | j 'v.chat.id')
echo "chat: $CHAT_ID"

echo "== send prompt =="
RESP=$(curl -fsS -b "$JAR" -H 'content-type: application/json' \
  -d "{\"content\":$(node -e 'console.log(JSON.stringify(process.argv[1]))' "$PROMPT")}" \
  "$BASE/api/chats/$CHAT_ID/messages")
echo "$RESP" | head -c 500; echo
JOB_ID=$(echo "$RESP" | j 'v.job?.id || ""')
ASSET_ID=$(echo "$RESP" | j 'v.asset?.id || ""')
if [ -z "$JOB_ID" ]; then echo "No job returned (clarification?)"; exit 2; fi
echo "job: $JOB_ID asset: $ASSET_ID"

echo "== poll job =="
for i in $(seq 1 120); do
  BODY=$(curl -fsS -b "$JAR" "$BASE/api/jobs/$JOB_ID")
  STATUS=$(echo "$BODY" | j 'v.job.status')
  PROG=$(echo "$BODY" | j 'v.job.progress')
  STAGE=$(echo "$BODY" | j 'v.job.stage')
  echo "  [$i] $STATUS $PROG% $STAGE"
  if [ "$STATUS" = "done" ]; then break; fi
  if [ "$STATUS" = "failed" ]; then echo "$BODY" | j 'v.asset.error'; exit 3; fi
  sleep 2
done

[ "$STATUS" = "done" ] || { echo "timed out"; exit 4; }

echo "== result =="
BODY=$(curl -fsS -b "$JAR" "$BASE/api/jobs/$JOB_ID")
FILE=$(echo "$BODY" | j 'v.asset.filePath')
echo "file: $FILE"
curl -fsS -b "$JAR" "$BASE/api/files/$FILE" -o /tmp/smoke-output.bin
ls -lh /tmp/smoke-output.bin
ffprobe -v error -show_entries format=duration,size:stream=codec_name,width,height -of default=nw=1 /tmp/smoke-output.bin

rm -f "$JAR"
echo "OK"
