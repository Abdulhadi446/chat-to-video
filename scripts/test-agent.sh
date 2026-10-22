#!/usr/bin/env bash
# Check the optional opencode agent path without running a model.
#
# This script ONLY:
#   1. locates the opencode binary (OPENCODE_BIN or $PATH),
#   2. prints its version (5s timeout),
#   3. checks the ffmpeg/ffprobe tools the validator needs,
#   4. prints manual smoke-test instructions.
#
# It never invokes `opencode run`, so it is safe for CI and costs nothing.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "chat-to-video · agent path check"
echo "repo: $ROOT"

BIN=""
if [[ -n "${OPENCODE_BIN:-}" ]]; then
  BIN="$OPENCODE_BIN"
  # Relative paths with a slash are resolved from the repo root, matching the
  # app (see lib/agent/opencode.ts).
  if [[ "$BIN" != /* && "$BIN" == */* ]]; then
    BIN="$ROOT/$BIN"
  fi
else
  BIN="$(command -v opencode || true)"
fi

if [[ -z "$BIN" ]]; then
  echo "opencode: NOT FOUND"
  echo
  echo "Agent mode is optional. Without opencode, runOpencodeJob() returns null"
  echo "immediately and the jobs runner falls back to the deterministic renderer."
  echo
  echo "To enable it, install opencode (https://opencode.ai) or point at it:"
  echo "  export OPENCODE_BIN=/absolute/path/to/opencode"
  echo "  export OPENCODE_MODEL=openrouter/<model>   # optional"
  exit 1
fi

if [[ "$BIN" != */* ]]; then
  # Bare command name (OPENCODE_BIN=opencode should still work).
  BIN="$(command -v "$BIN" || true)"
fi

if [[ -z "$BIN" || ! -x "$BIN" ]]; then
  echo "opencode: NOT FOUND (OPENCODE_BIN=$BIN)"
  echo "Agent mode will be skipped and the deterministic renderer used."
  exit 1
fi

echo "opencode: $BIN"
if command -v timeout >/dev/null 2>&1; then
  VERSION="$(timeout 5 "$BIN" --version 2>&1)" || {
    echo "opencode --version: FAILED or timed out after 5s"
    echo "The app treats this as 'agent unavailable' and falls back."
    exit 1
  }
else
  VERSION="$("$BIN" --version 2>&1)" || {
    echo "opencode --version: FAILED"
    exit 1
  }
fi
echo "version: $VERSION"

for tool in ffmpeg ffprobe; do
  if command -v "$tool" >/dev/null 2>&1; then
    echo "$tool: $(command -v "$tool")"
  else
    echo "$tool: NOT FOUND (required to validate/thumbnail agent output)"
  fi
done

if [[ -n "${OPENCODE_MODEL:-}" ]]; then
  echo "OPENCODE_MODEL: $OPENCODE_MODEL"
else
  echo "OPENCODE_MODEL: (unset — opencode uses its own configured default)"
fi

cat <<'EOF'

Manual smoke test (NOT executed by this script)
------------------------------------------------
This can take up to 5 minutes and may consume paid model credits.

1. Start the app in one terminal:            npm run dev
2. Make sure .env has the keys from .env.example (never commit it).
3. In the UI, ask for a genuinely complex video (multi-scene, 30s) so the
   router returns "agent". Confirm the job's mode is "agent":
       GET /api/jobs/<jobId>   ->   { job: { mode: "agent", ... } }
4. Follow the run:
       tail -f data/jobs/agent-<assetId>-*/agent.log
   The workspace also contains BRIEF.md (prompt + VideoSpec + requirements)
   and a copy of video-generation.md.
5. Success: data/outputs/<assetId>/final.mp4 and thumb.jpg exist, and the
   asset status becomes "done".
6. Failure/timeout: the module returns null, the jobs runner falls back to the
   deterministic renderer, and the workspace keeps agent.log plus
   agent-error.log (last 4KB of output, secrets redacted).

Runtime limit: 5 minutes. On timeout the whole process group is sent SIGTERM,
then SIGKILL after 5 seconds. Output must be a valid MP4 (video stream,
1–90s) named final.mp4 anywhere in the workspace.
EOF
