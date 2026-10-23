# Current Task

## Task
Project cleanup — undeployed and tests2 cleaned

## Description
This is a hackathon preparation project, not a deployed app. The tests2 server was
torn down and all deployment artifacts created for this project were removed.

## Status
- [x] Done

## Notes
- No live URL. The `testings.thetrillioniar.me` CNAME and the `chat-to-video` Cloudflare tunnel were deleted.
- tests2 cleaned: app dir, data, temp job workspaces, app-specific Node/FFmpeg/Piper binaries, and the temporary tunnel config were removed; the pre-existing triage-desk tunnel was left untouched.
- Local verification remains in `.agent-logs/`: `tsc`, `build-hard-final.log`, `hard-e2e-pwd.log`, `live-hard-decision.log`.
- `docs/deploy.md` and `scripts/deploy-tests2.sh` are retained only as reference.
