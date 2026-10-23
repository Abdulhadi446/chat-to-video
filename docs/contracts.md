# Build contracts (single source of truth)

Read `TASK.md`, `lib/types.ts`, `lib/db.ts` before coding. Do not edit files outside your lane.
No new npm dependencies. Tailwind v4 + React 19 + Next 16.4.2. Node 26, `node:sqlite`.

## Env
- `OPENROUTER_API_KEY`, `OPENROUTER_MODEL` (default `nvidia/nemotron-3.5-super-vl:free`; fallback `cohere/north-mini-code:free`), base `https://openrouter.ai/api/v1`
- `THETRILLIONIAR_API_KEY`, base `https://thetrillioniar.me`, decision `POST /v1/systemone`
- `OPENCODE_MODEL` (optional), `FFMPEG_PATH` (default `ffmpeg`), `PIPER_PATH` (default `tools/piper/piper`)
- Files: `data/outputs/<assetId>/final.mp4|final.png|thumb.jpg`, agent work: `$TMPDIR/chat-to-video-jobs/<jobId>/` (outside the repo so opencode cannot attach to the app project)
- Logs: `.agent-logs/`

## Lane ownership (do not write outside)
- **designer**: `app/page.tsx`, `app/login/**`, `app/register/**`, `app/chat/**`, `components/**`, `app/globals.css`, `app/layout.tsx`
- **auth/data**: `lib/auth.ts`, `app/api/auth/**`, `app/api/chats/route.ts`, `app/api/chats/[id]/route.ts`, `app/api/files/**`
- **ai/jobs**: `lib/ai/**`, `lib/jobs/**`, `app/api/chats/[id]/messages/route.ts`, `app/api/jobs/**`, `app/api/assets/**`; delete legacy `app/api/chat/route.ts`
- **renderer**: `lib/render/**`, `scripts/render-demo.mjs`
- **audio/setup**: `lib/audio/**`, `scripts/setup-piper.sh`
- **agent**: `lib/agent/**`, `scripts/test-agent.sh`
- **deploy**: remote tests2 only; report back, no repo files

## Auth
Cookie `ctv_session`, httpOnly, sameSite=lax, 30d, secure in production.
`lib/auth.ts` exports:
```ts
getSessionUser(): Promise<User | null>       // reads cookie + DB
requireUser(): Promise<User>                 // throws Response 401 helper
hashPassword(pw: string): Promise<string>    // scrypt, salt embedded
verifyPassword(pw: string, stored: string): Promise<boolean>
createSessionCookie(userId: string): Promise<void>
clearSessionCookie(): Promise<void>
```
Use `cookies()` from `next/headers` (async in Next 16). Register validates email + password >= 8.

## HTTP API
- `POST /api/auth/register {email,password}` → `{user}`; 409 if exists
- `POST /api/auth/login {email,password}` → `{user}`; 401 bad creds
- `POST /api/auth/logout` → `{ok:true}`
- `GET /api/auth/me` → `{user}` or 401
- `GET /api/chats` → `{chats}`; `POST /api/chats {title?}` → `{chat}`
- `GET /api/chats/:id` → `{chat, messages, assets}`; `PATCH {title}`; `DELETE`
- `POST /api/chats/:id/messages {content}` → `{userMessage, reply, asset?, job?}` (create + enqueue, return fast)
- `GET /api/jobs/:id` → `{job, asset}`
- `POST /api/assets/:id/retry` → `{job}`
- `GET /api/files/[...path]` → binary, auth required, path must resolve inside `data/`

All `/api/*` except auth return 401 JSON when no session. Dynamic route params are `Promise<{id:string}>` in Next 16.

## AI
```ts
parseIntent(text: string, history: Message[]): Promise<{
  kind: "video"|"image"; topic: string; duration: 10|30|60;
  aspect: "9:16"|"16:9"|"1:1"; voice: "silent"|"narrator"; style?: string;
  needsClarification?: string
}>
decideMode(intent): Promise<{ mode: "deterministic"|"agent"; reason: string }>
createStoryboard(intent): Promise<VideoSpec>
```
Decision: Trillionir `POST /v1/systemone` body `{state, questions:{difficulty:{type:"choice",instructions,criteria:{easy:"...",hard:"..."}}}}`; read `answers.difficulty.choice`; `hard` only when choice is hard and confidence >= 0.6; any abstain/error ⇒ deterministic.
Storyboard: OpenRouter JSON-only, validate with `lib/ai/storyboard.ts` (clamp scene durations to total, 3-6 scenes, fill captions). Never throw to the route: on failure return a safe 1-scene spec.

## Renderer
```ts
renderVideo(spec: VideoSpec, outDir: string, onProgress: (p:{progress:number;stage:string})=>void, opts?:{audioPath?:string|null; ffmpegPath?:string}): Promise<{filePath:string; thumbPath:string; duration:number}>
renderImage(spec: VideoSpec, outDir: string, opts?:{ffmpegPath?:string}): Promise<{filePath:string}>
```
- Write `final.mp4` (H.264 + AAC, yuv420p, faststart) / `final.png` / `thumb.jpg`.
- Resolve stock images via Openverse API (no key) inside renderer with generated-gradient fallback; never block on network.
- Use system fonts (`fc-match "DejaVu Sans"`), 2-line max captions, safe margins.
- Must work standalone: `node scripts/render-demo.mjs` renders a sample 10s 9:16 MP4 + PNG.

## Audio
```ts
piperAvailable(): Promise<boolean>
synthesizeNarration(text: string, outWav: string): Promise<{ok:boolean; wavPath?:string; error?:string}>
```
Local Piper only; download static linux x86_64 + `en_US-lessac-medium` voice into `tools/piper/` via `scripts/setup-piper.sh`. Never fail the render: return `{ok:false}` and jobs fall back to silent.

## Jobs
```ts
enqueueJob(jobId: string): void
```
Load job/asset via `lib/db.ts`; update `progress/stage`; deterministic = optional TTS + renderer; agent mode = try `lib/agent/opencode.ts` first, fallback deterministic. On success set asset `status:"done"`, `filePath` = repo-relative (`data/outputs/...`), thumbnail, duration. On failure `status:"failed"` + error. Never let the process crash.

## Agent
```ts
runOpencodeJob(input:{asset:Asset; spec:VideoSpec; outDir:string; onProgress:(p:{progress:number;stage:string})=>void}): Promise<{filePath:string; thumbPath?:string} | null>
```
`spawn("opencode", ["run","--standalone","--auto", prompt])` in a neutral temp workspace (`AGENT_WORKDIR_ROOT`, default `$TMPDIR/chat-to-video-jobs`), `cwd`/`PWD` set there, copy `video-generation.md` as `BRIEF.md`, timeout `OPENCODE_TIMEOUT_MS` (default 3 min), kill tree on timeout, return null on any failure. `opencode` may be missing — return null immediately.

## UI
- Dark studio theme, violet accent, sidebar 280px, mobile drawer, chat column max-w-3xl.
- Sidebar: brand, New chat, chat list, active asset card (kind/status/progress/aspect/duration/voice), "How it works" disclosure referencing the pipeline, account/logout.
- Chat: message stream, composer (Cmd/Ctrl+Enter), quick chips (10s/30s/60s, aspect, voice), generating card with progress bar and polling every 2s, result card with `<video controls>` or `<img>` + download.
- Empty state: 4 example prompts.
- Homepage: one hero, "Open chat" CTA, 3-step how it works, link to repo. Login/register clean cards.
