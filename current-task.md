# Current Task

## Task
M8 — Deploy and final verification (see TASK.md) — COMPLETE

## Description
Shipped the verified standalone build to tests2 behind a Cloudflare quick tunnel and confirmed
the public URL end to end: register → chat → 10s video, 1:1 PNG, and narrated 10s MP4 with AAC.

## Status
- [x] Done

## Notes
- Live: https://assigned-call-camcorders-nevertheless.trycloudflare.com
- Verification logs: `.agent-logs/remote-smoke.log`, `remote-image.log`, `remote-voice.log`
- Local checks: `npx tsc --noEmit`, `npm run build`, `scripts/e2e-local.sh`, UI smoke
- Deploy guide: `docs/deploy.md`; one-command redeploy: `scripts/deploy-tests2.sh`
- Quick-tunnel URL changes if the tunnel restarts.
