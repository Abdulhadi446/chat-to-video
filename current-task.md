# Current Task

## Task
Project cleanup — undeployed and tests2 cleaned

## Description
This is a hackathon preparation project, not a deployed app. The tests2 deployment was
torn down again: server stopped, `chat-to-video` tunnel deleted, the
`testings.thetrillioniar.me` DNS record removed, and all app-specific files deleted.

## Status
- [x] Done

## Notes
- No live URL. `https://testings.thetrillioniar.me` returns 404 and has no DNS record of its own.
- tests2 cleaned: `/home/ubuntu/apps/chat-to-video`, app data, temp job workspaces, `~/tools/piper`, and the tunnel config/credentials were removed.
- Left untouched on tests2: Fathom (`:3100`), AuraCounter (`:5000`), Mindcraft (`:8080`), and pre-existing tunnels (`triage-desk`, `hcm-lite`, …).
- Local verification remains in `.agent-logs/`: `redeploy-smoke.log`, `redeploy-voice.log`, plus earlier `tsc`/`build` logs.
- `docs/deploy.md` and `scripts/deploy-tests2.sh` are retained only as a reference runbook.
