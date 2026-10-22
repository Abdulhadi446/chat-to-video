#!/usr/bin/env bash
#
# setup-piper.sh - install local Piper TTS for chat-to-video.
#
# Downloads the Piper 2023.11.14-2 static linux x86_64 release and the
# en_US-lessac-medium voice into tools/piper/. Idempotent; safe to re-run.
# No root/sudo required.
#
# Usage:
#   bash scripts/setup-piper.sh
#
# Env overrides:
#   PIPER_DIR   install directory (default: <repo>/tools/piper)
#   PIPER_LOG   log file (default: <repo>/.agent-logs/piper-setup.log)
#
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PIPER_DIR="${PIPER_DIR:-$ROOT_DIR/tools/piper}"
VOICES_DIR="$PIPER_DIR/voices"
LOG_DIR="$ROOT_DIR/.agent-logs"
LOG_FILE="${PIPER_LOG:-$LOG_DIR/piper-setup.log}"

PIPER_VERSION="2023.11.14-2"
PIPER_URL="https://github.com/rhasspy/piper/releases/download/${PIPER_VERSION}/piper_linux_x86_64.tar.gz"
VOICE_NAME="en_US-lessac-medium"
VOICE_URL_BASE="https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/en/en_US/lessac/medium"
VOICE_ONNX="$VOICES_DIR/${VOICE_NAME}.onnx"
VOICE_JSON="${VOICE_ONNX}.json"

# 61 MB model; anything much smaller is a failed/partial download.
VOICE_MIN_BYTES=$((1024 * 1024))
JSON_MIN_BYTES=100
TARBALL_MIN_BYTES=$((5 * 1024 * 1024))

TMP_DIR=""
CURL_OPTS=(
  -fL
  --silent
  --show-error
  --no-progress-meter
  --connect-timeout 20
  --max-time 900
  --retry 3
  --retry-delay 2
  --retry-connrefused
  --speed-limit 1024
  --speed-time 60
)

log() { printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*"; }
die() {
  trap - ERR
  printf '\nERROR: %s\n' "$*" >&2
  printf 'Log: %s\n' "$LOG_FILE" >&2
  exit 1
}

cleanup() {
  if [[ -n "$TMP_DIR" && -d "$TMP_DIR" ]]; then
    rm -rf "$TMP_DIR"
  fi
}
trap cleanup EXIT

mkdir -p "$LOG_DIR" "$PIPER_DIR" "$VOICES_DIR"
# Mirror output to the console and append to the log file.
exec > >(tee -a "$LOG_FILE") 2>&1

log "Piper setup starting (version $PIPER_VERSION, voice $VOICE_NAME)"
log "Install dir: $PIPER_DIR"

# --- preflight -------------------------------------------------------------

[[ "$(uname -s)" == "Linux" ]] || die "This script only supports Linux (found $(uname -s)). Install Piper manually."
case "$(uname -m)" in
  x86_64 | amd64) ;;
  *) die "This script only supports x86_64 Linux (found $(uname -m)). Install Piper manually." ;;
esac

for cmd in curl tar; do
  command -v "$cmd" >/dev/null 2>&1 || die "Required command not found: $cmd"
done
command -v node >/dev/null 2>&1 || die "Required command not found: node (needed to validate the voice config)"
[[ -w "$PIPER_DIR" ]] || die "No write permission for $PIPER_DIR"

# --- helpers ---------------------------------------------------------------

piper_binary_ok() {
  [[ -x "$PIPER_DIR/piper" ]] || return 1
  [[ -d "$PIPER_DIR/espeak-ng-data" ]] || return 1
  "$PIPER_DIR/piper" --help >/dev/null 2>&1
}

voice_files_ok() {
  [[ -f "$VOICE_ONNX" && -f "$VOICE_JSON" ]] || return 1
  local onnx_size json_size
  onnx_size="$(stat -c '%s' "$VOICE_ONNX" 2>/dev/null || echo 0)"
  json_size="$(stat -c '%s' "$VOICE_JSON" 2>/dev/null || echo 0)"
  ((onnx_size >= VOICE_MIN_BYTES)) || return 1
  ((json_size >= JSON_MIN_BYTES)) || return 1
  node -e '
    const fs = require("node:fs");
    const cfg = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    if (!cfg.audio || typeof cfg.audio.sample_rate !== "number") process.exit(1);
  ' "$VOICE_JSON" >/dev/null 2>&1
}

download() {
  local url="$1" dest="$2" min_bytes="$3" label="$4"
  local part="${dest}.part.$$"

  log "Downloading $label"
  log "  $url"
  rm -f "$part"
  if ! curl "${CURL_OPTS[@]}" -o "$part" "$url"; then
    rm -f "$part"
    die "curl failed while downloading $label (network/HTTP error). Re-run the script to retry."
  fi

  local size
  size="$(stat -c '%s' "$part" 2>/dev/null || echo 0)"
  if ((size < min_bytes)); then
    rm -f "$part"
    die "Downloaded $label is too small (${size} bytes, expected >= ${min_bytes}); treating it as corrupt."
  fi

  mv -f "$part" "$dest"
  log "  saved $dest ($(numfmt --to=iec-i --suffix=B "$size" 2>/dev/null || echo "${size} bytes"))"
}

# --- piper binary + runtime data ------------------------------------------

if piper_binary_ok; then
  log "Piper binary already installed and runnable; skipping download."
else
  log "Piper binary missing or broken; installing."

  # Keep the temp dir outside $PIPER_DIR: installing wipes everything there
  # except voices/.
  TMP_DIR="$(mktemp -d "$ROOT_DIR/tools/.piper-setup.XXXXXX")"

  download "$PIPER_URL" "$TMP_DIR/piper.tar.gz" "$TARBALL_MIN_BYTES" "Piper release tarball"

  log "Extracting Piper release..."
  if ! tar -xzf "$TMP_DIR/piper.tar.gz" -C "$TMP_DIR"; then
    die "Failed to extract the Piper tarball (corrupt download?). Re-run to retry."
  fi
  [[ -x "$TMP_DIR/piper/piper" ]] || die "Extracted archive does not contain an executable piper binary."

  if ! "$TMP_DIR/piper/piper" --help >/dev/null 2>&1; then
    die "Downloaded Piper binary cannot run on this machine (missing system libraries?)."
  fi

  # Replace the runtime files but keep the voices directory intact.
  log "Installing Piper into $PIPER_DIR ..."
  find "$PIPER_DIR" -mindepth 1 -maxdepth 1 ! -name voices -exec rm -rf {} +
  cp -a "$TMP_DIR/piper/." "$PIPER_DIR/"
  chmod +x "$PIPER_DIR/piper"
  rm -rf "$TMP_DIR"
  TMP_DIR=""

  piper_binary_ok || die "Piper installed but 'piper --help' failed. See log."
  log "Piper binary installed."
fi

# --- voice -----------------------------------------------------------------

if voice_files_ok; then
  log "Voice $VOICE_NAME already installed; skipping download."
else
  log "Voice $VOICE_NAME missing or incomplete; installing."
  download "$VOICE_URL_BASE/${VOICE_NAME}.onnx" "$VOICE_ONNX" "$VOICE_MIN_BYTES" "voice model (${VOICE_NAME}.onnx)"
  download "$VOICE_URL_BASE/${VOICE_NAME}.onnx.json" "$VOICE_JSON" "$JSON_MIN_BYTES" "voice config (${VOICE_NAME}.onnx.json)"
  voice_files_ok || die "Voice files downloaded but failed validation (bad JSON config or truncated model)."
  log "Voice installed."
fi

# --- verify ----------------------------------------------------------------

log "Verifying: $PIPER_DIR/piper --help"
if ! "$PIPER_DIR/piper" --help 2>&1 | head -n 2; then
  die "'$PIPER_DIR/piper --help' failed."
fi

log "Verifying voice files..."
log "  $(stat -c '%n %s bytes' "$VOICE_ONNX")"
log "  $(stat -c '%n %s bytes' "$VOICE_JSON")"

log "Piper setup complete."
log "  binary: $PIPER_DIR/piper"
log "  voice:  $VOICE_ONNX"
