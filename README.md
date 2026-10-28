# Chat to Video

Describe a video in chat. Get a rendered vertical MP4 (or a designed still) back in the same conversation.

Built as a hackathon preparation project and deployed for testing. It is **not** a generative video model: an LLM turns your chat into a storyboard, and a deterministic FFmpeg pipeline renders real scenes, captions, motion, and optional narration. Hard requests can be escalated to an autonomous `opencode` agent that works in a sandboxed job directory.

**Live demo:** https://testings.thetrillioniar.me  
**Repo:** https://github.com/Abdulhadi446/chat-to-video

## What works

- Email + password accounts, cookie sessions, per-user chat history (SQLite via `node:sqlite`)
- Chat-first UI with a live asset sidebar: status, progress, aspect, duration, voice, scenes
- Intent parsing: video or image, 10/30/60s, 9:16 / 16:9 / 1:1, silent or narrated
- Difficulty router via the Trillionir Verdict API (`easy` → deterministic render, `hard` → agent lane)
- OpenRouter storyboard generation with strict validation and safe fallbacks
- FFmpeg renderer: Openverse stock backgrounds with generated-gradient fallback, Ken Burns motion, transitions, captions, H.264/AAC MP4 + thumbnail
- Local Piper narration with a silent fallback
- Image mode: a designed PNG poster from the same storyboard
- Downloadable results, retry, and multiple chats

## Demo flow

1. Register (or log in) → land in `/chat`.
2. Click **VOICE** in the composer (silent is the default), then type: *"Make a 10 second vertical video about a coffee shop opening at sunrise, warm and cinematic, with a voiceover."*
3. Watch the asset card move through planning → voice → assets → rendering → done.
4. Play the MP4 in the chat, download it, or retry. Switch back to **SILENT** for a faster render.
5. Try *"Make a square poster for a synthwave music night"* for image mode.

## Stack

Next.js 16 (App Router) · React 19 · Tailwind v4 · TypeScript · `node:sqlite` · FFmpeg · Piper · OpenRouter · Trillionir Verdict

```text
chat ──► intent ──► difficulty ──► storyboard ──► job queue
                                          │
                          ┌───────────────┴───────────────┐
                    deterministic                      agent
              FFmpeg + Piper + images           opencode run --auto
                          └───────────────┬───────────────┘
                                    MP4 / PNG
```

## Run locally

```bash
npm install
cp .env.example .env    # fill keys
npm run dev             # http://localhost:3000
```

FFmpeg must be on `PATH` (or set `FFMPEG_PATH`). For narration:

```bash
./scripts/setup-piper.sh
```

### Environment

| Variable | Purpose |
| --- | --- |
| `OPENROUTER_API_KEY` | chat + storyboard model |
| `OPENROUTER_MODEL` | default free `nvidia/nemotron-3.5-super-vl:free` |
| `OPENROUTER_FALLBACK_MODEL` | used when the primary fails; default free `cohere/north-mini-code:free` |
| `THETRILLIONIAR_API_KEY` | difficulty decision |
| `THETRILLIONIAR_BASE_URL` | default `https://thetrillioniar.me` |
| `THETRILLIONIAR_TIMEOUT_MS` | decision timeout, default 15000; set 25000 for this API |
| `DATABASE_URL` | default `file:./data/app.db` |
| `FFMPEG_PATH` | optional binary override |
| `PIPER_PATH` | optional Piper binary override |
| `OPENCODE_MODEL` | optional model for the agent lane |
| `OPENCODE_BIN` | optional opencode binary override |
| `OPENCODE_TIMEOUT_MS` | agent timeout before deterministic fallback; default 180000 |

## Scripts

- `npm run dev` / `npm run build`
- `./scripts/setup-piper.sh` — local TTS binary + voice
- `node scripts/render-demo.mjs` — render a sample without the app
- `./scripts/smoke.sh` — end-to-end API smoke test against a running server
- `./scripts/stage-standalone.sh` — stage a deploy-like app root for production testing
- `./scripts/deploy-tests2.sh` — deploy the current standalone build to tests2

## Deploy

Deployed on tests2 behind a Cloudflare named tunnel at https://testings.thetrillioniar.me. Renders run at 720p on 2 vCPU. See `docs/deploy.md` for the runbook; `scripts/deploy-tests2.sh` redeploys the local standalone build.

## Notes / limitations

- Render queue is in-process; a server restart drops queued jobs (assets can be retried).
- Stock imagery comes from Openverse; attribution is stored with generated assets when available.
- The agent lane requires `opencode` and a configured provider; without it, jobs fall back to the deterministic renderer.
