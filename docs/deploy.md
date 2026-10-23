# Deploy (tests2 + Cloudflare quick tunnel)

Target: `tests2` (Ubuntu 24.04, 2 vCPU, 952 MB RAM + 10 GB swap). Renders at 720p; builds happen **locally** because the remote build is memory-constrained.

## Remote layout (already provisioned)

| Thing | Path |
| --- | --- |
| ffmpeg / ffprobe | `/home/ubuntu/bin/ffmpeg`, `/home/ubuntu/bin/ffprobe` |
| Node 26 | `/home/ubuntu/tools/node/bin/node` (symlinked into `~/bin`) |
| Piper + voice | `/home/ubuntu/tools/piper/piper`, `voices/en_US-lessac-medium.onnx` |
| opencode | `/home/ubuntu/.opencode/bin/opencode` (v2.1.1) |
| App | `/home/ubuntu/apps/chat-to-video` |
| Data | `data/{uploads,outputs,jobs}` (persist across deploys) |
| Port | `3000` (3100 is occupied) |

Every remote command needs:

```bash
export PATH=$HOME/bin:$HOME/tools/node/bin:$PATH
```

## Deploy

```bash
# 1. Build locally (Node 26)
npm run build

# 2. Push the standalone server (protect remote data/tools/.env)
rsync -az --delete --exclude data --exclude tools --exclude .env \
  .next/standalone/ tests2:~/apps/chat-to-video/
rsync -az --delete .next/static/ tests2:~/apps/chat-to-video/.next/static/
rsync -az public/ tests2:~/apps/chat-to-video/public/
rsync -az video-generation.md tests2:~/apps/chat-to-video/

# 3. Secrets (never commit)
scp .env tests2:~/apps/chat-to-video/.env

# 4. Restart
ssh tests2 'cd ~/apps/chat-to-video && export PATH=$HOME/bin:$HOME/tools/node/bin:$PATH && \
  pkill -f "node server.js" 2>/dev/null || true; \
  PORT=3000 HOSTNAME=127.0.0.1 nohup node server.js > app.log 2>&1 &'

# 5. Tunnel (empty config avoids the catch-all 404 in ~/.cloudflared/config.yml)
ssh tests2 'cd ~/apps/chat-to-video && \
  nohup cloudflared tunnel --config /dev/null --url http://127.0.0.1:3000 --no-autoupdate > tunnel.log 2>&1 &'
sleep 6
ssh tests2 'grep -o "https://[a-z0-9-]*\.trycloudflare\.com" ~/apps/chat-to-video/tunnel.log | head -1'
```

Production `.env` additions:

```dotenv
NODE_ENV=production
FFMPEG_PATH=/home/ubuntu/bin/ffmpeg
FFPROBE_PATH=/home/ubuntu/bin/ffprobe
PIPER_PATH=/home/ubuntu/tools/piper/piper
PIPER_MODEL=/home/ubuntu/tools/piper/voices/en_US-lessac-medium.onnx
OPENCODE_BIN=/home/ubuntu/.opencode/bin/opencode
OPENCODE_TIMEOUT_MS=180000
DATABASE_URL=file:./data/app.db
```

## Verify

```bash
curl -fsS https://<tunnel>.trycloudflare.com/api/health
BASE=https://<tunnel>.trycloudflare.com ./scripts/smoke.sh
ssh tests2 'tail -50 ~/apps/chat-to-video/app.log'
```

## Notes

- `output: "standalone"` is enabled in `next.config.ts`; `server.js` is the entrypoint.
- `cacheComponents: true` forbids `export const runtime` / `export const dynamic` in route segments. Don't add them.
- Render jobs are serialized in-process; a restart drops queued jobs (retry from the UI).
- Quick-tunnel URLs change on every restart. Update the README after capturing one.
- The agent lane needs `opencode` configured with an OpenRouter provider; without it jobs fall back to the deterministic renderer.
