# Current Task

## Task
M8 — Deployed to tests2 for testing

## Description
Redeployed the standalone build to tests2 and recreated the stable Cloudflare tunnel
for `testings.thetrillioniar.me`. The previous hostname target was replaced; unrelated
tests2 apps (Fathom, AuraCounter, Mindcraft) were left running.

## Status
- [x] Done

## Notes
- Live: https://testings.thetrillioniar.me
- Verify: `curl -fsS https://testings.thetrillioniar.me/api/health`
- Smoke: register → chat → 10s 720x1280 H.264 MP4; log `.agent-logs/redeploy-smoke.log`
- Remote runtime: Node 22.23.4 via nvm, apt FFmpeg 6.1.1, Piper at `~/tools/piper`
- Tunnel: `chat-to-video` id `54ad66a4-3810-4938-8cea-7fee96803a1b`
- Redeploy: `./scripts/deploy-tests2.sh`
