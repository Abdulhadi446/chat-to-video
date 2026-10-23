#!/usr/bin/env bash
set -uo pipefail
BASE="${BASE:-http://127.0.0.1:3110}"
JAR="${JAR:-/tmp/opencode/ctv-cookies.txt}"
LOG="${LOG:-.agent-logs/e2e-local.log}"
: > "$LOG"
exec > >(tee -a "$LOG") 2>&1
EMAIL="demo$(date +%s)@example.com"
PASS="demo-password-123"
echo "== register $EMAIL"
curl -sS -c "$JAR" -H 'content-type: application/json' -d "{\"email\":\"$EMAIL\",\"password\":\"$PASS\"}" "$BASE/api/auth/register" | jq -c '{user:.user.email,error}'
echo "== create chat"
CHAT_JSON=$(curl -sS -b "$JAR" -H 'content-type: application/json' -d '{}' "$BASE/api/chats")
CHAT=$(echo "$CHAT_JSON" | jq -r '.chat.id // empty')
echo "chat=$CHAT"
[ -n "$CHAT" ] || { echo "FAIL no chat"; exit 1; }
echo "== send prompt"
SEND=$(curl -sS -m 90 -b "$JAR" -H 'content-type: application/json' \
  -d '{"content":"Make a 10 second vertical coffee ad with a calm narrator voice, warm and minimal"}' \
  "$BASE/api/chats/$CHAT/messages")
echo "$SEND" | jq -c '{reply:.reply.content,assetId:.asset.id,jobId:.job.id,mode:.decision.mode,reason:.decision.reason,intent}'
JOB=$(echo "$SEND" | jq -r '.job.id // empty')
ASSET=$(echo "$SEND" | jq -r '.asset.id // empty')
[ -n "$JOB" ] || { echo "FAIL no job"; exit 1; }
for i in $(seq 1 90); do
  J=$(curl -sS -b "$JAR" "$BASE/api/jobs/$JOB")
  STATUS=$(echo "$J" | jq -r '.job.status // "?"')
  PROG=$(echo "$J" | jq -r '.job.progress // 0')
  STAGE=$(echo "$J" | jq -r '.job.stage // ""')
  printf 'poll %02d status=%s progress=%s stage=%s\n' "$i" "$STATUS" "$PROG" "$STAGE"
  if [ "$STATUS" = "done" ]; then echo "$J" | jq -c '{job:{status:.job.status,mode:.job.mode,stage:.job.stage},asset:{id:.asset.id,filePath:.asset.filePath,thumbPath:.asset.thumbPath,status:.asset.status,kind:.asset.kind},log:(.job.log|.[-400:])}'; break; fi
  if [ "$STATUS" = "failed" ]; then echo "$J" | jq -c '{job,asset}'; echo FAIL; exit 1; fi
  sleep 2
done
echo "== chat detail"
curl -sS -b "$JAR" "$BASE/api/chats/$CHAT" | jq -c '{messages:(.messages|length),assets:[.assets[]|{id,status,filePath,thumbPath,job:(.job.status // null)}]}'
echo "== download"
FILE=$(curl -sS -b "$JAR" "$BASE/api/jobs/$JOB" | jq -r '.asset.filePath // empty')
URL="${FILE#data/}"
echo "file=$FILE"
if [ -n "$URL" ]; then curl -sS -b "$JAR" -o /tmp/opencode/e2e-final.mp4 "$BASE/api/files/$URL"; ffprobe -v error -show_entries format=duration,size:stream=codec_name,width,height -of json /tmp/opencode/e2e-final.mp4; fi
echo "== image prompt"
IMG=$(curl -sS -m 90 -b "$JAR" -H 'content-type: application/json' \
  -d '{"content":"Create a minimal 1:1 poster image titled Midnight Jazz Pulse for a late night radio show"}' \
  "$BASE/api/chats/$CHAT/messages")
IMGJOB=$(echo "$IMG" | jq -r '.job.id // empty')
for i in $(seq 1 60); do
  IJ=$(curl -sS -b "$JAR" "$BASE/api/jobs/$IMGJOB")
  ISTATUS=$(echo "$IJ" | jq -r '.job.status // "?"')
  printf 'image poll %02d status=%s progress=%s\n' "$i" "$ISTATUS" "$(echo "$IJ" | jq -r '.job.progress // 0')"
  [ "$ISTATUS" = "done" ] && break
  [ "$ISTATUS" = "failed" ] && { echo "$IJ" | jq -c '{job,asset}'; echo FAIL; exit 1; }
  sleep 2
done
IMGFILE=$(curl -sS -b "$JAR" "$BASE/api/jobs/$IMGJOB" | jq -r '.asset.filePath // empty')
echo "image=$IMGFILE"
if [ -n "$IMGFILE" ]; then curl -sS -b "$JAR" -o /tmp/opencode/e2e-final.png "$BASE/api/files/${IMGFILE#data/}"; file /tmp/opencode/e2e-final.png; fi
echo "DONE chat=$CHAT asset=$ASSET job=$JOB"
