# Deploy (tests2 + Cloudflare named tunnel)

Target: `tests2` (Ubuntu 24.04, 2 vCPU, 952 MB RAM + 10 GB swap). Renders at 720p; builds happen **locally** because the remote build is memory-constrained.

Public URL: **https://testings.thetrillioniar.me** (stable named tunnel).

## Remote layout (already provisioned)

| Thing | Path |
| --- | --- |
| ffmpeg / ffprobe | `/usr/bin/ffmpeg`, `/usr/bin/ffprobe` (apt) |
| Node 22 | `/home/ubuntu/.nvm/versions/node/v22.23.4/bin/node` |
| Piper + voice | `/home/ubuntu/tools/piper/piper`, `voices/en_US-lessac-medium.onnx` |
| opencode | `/home/ubuntu/.opencode/bin/opencode` (v2.1.4) |
| App | `/home/ubuntu/apps/chat-to-video` |
| Data | `data/{uploads,outputs,jobs}` (persist across deploys) |
| Port | `3000` (3100 is occupied) |

Every remote command needs:

```bash
export PATH=$HOME/.nvm/versions/node/v22.23.4/bin:$HOME/tools/piper:$PATH
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
ssh tests2 'cd ~/apps/chat-to-video && export PATH=$HOME/.nvm/versions/node/v22.23.4/bin:$HOME/tools/piper:$PATH && \
  fuser -k 3000/tcp 2>/dev/null || true; \
  setsid env PORT=3000 HOSTNAME=127.0.0.1 node server.js > app.log 2>&1 < /dev/null &'

# 5. Named tunnel (stable hostname; already provisioned)
ssh tests2 'cd ~/apps/chat-to-video && \
  setsid cloudflared tunnel --config ~/.cloudflared/chat-to-video.yml run > named-tunnel.log 2>&1 < /dev/null &'
sleep 6
curl -fsS https://testings.thetrillioniar.me/api/health
```

Named-tunnel provisioning (done once):

```bash
cloudflared tunnel create chat-to-video
# /home/ubuntu/.cloudflared/chat-to-video.yml maps testings.thetrillioniar.me -> 127.0.0.1:3000
cloudflared tunnel route dns chat-to-video testings.thetrillioniar.me
```

If `route dns` attaches the hostname to the wrong tunnel, fix the CNAME target in the
Cloudflare dashboard to `<tunnel-id>.cfargotunnel.com`.

Production `.env` additions:

```dotenv
NODE_ENV=production
FFMPEG_PATH=/usr/bin/ffmpeg
FFPROBE_PATH=/usr/bin/ffprobe
PIPER_PATH=/home/ubuntu/tools/piper/piper
PIPER_MODEL=/home/ubuntu/tools/piper/voices/en_US-lessac-medium.onnx
OPENCODE_BIN=/home/ubuntu/.opencode/bin/opencode
OPENCODE_TIMEOUT_MS=180000
DATABASE_URL=file:./data/app.db
```

## Verify

```bash
curl -fsS https://testings.thetrillioniar.me/api/health
BASE=https://testings.thetrillioniar.me ./scripts/smoke.sh
ssh tests2 'tail -50 ~/apps/chat-to-video/app.log'
```

## Notes

- `output: "standalone"` is enabled in `next.config.ts`; `server.js` is the entrypoint.
- `cacheComponents: true` forbids `export const runtime` / `export const dynamic` in route segments. Don't add them.
- Render jobs are serialized in-process; a restart drops queued jobs (retry from the UI).
- The public hostname is stable: `testings.thetrillioniar.me` → named tunnel `chat-to-video`. It survives server/tunnel restarts; no URL rewrite needed.
- The agent lane needs `opencode` configured with a model provider; without it jobs fall back to the deterministic renderer.
