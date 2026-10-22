# Chat-to-Video

## Problem summary

Users describe a video or image in chat ("make a 10s coffee ad, vertical, calm voice").
The app turns that conversation into a real, downloadable MP4 or PNG — no timeline editor,
no manual rendering steps. Accounts, chats, and outputs persist. A sidebar shows the
current asset, its status, and how the production pipeline works (see `video-generation.md`).

## Core flow (end-to-end)

1. **Register / login** → email + password, HTTP-only session cookie → land directly in chat.
2. **Chat** → sidebar (new chat, history, asset details). User describes what they want.
3. **Parse intent** → model extracts: video/image, topic, duration (10/30/60s), aspect
   (9:16 / 16:9 / 1:1), voice (silent / narration), style.
4. **Route difficulty** → Trillionir Decision API (`POST /v1/systemone`, `verdict-151m`,
   choice `easy|hard`). Abstain/error ⇒ **easy** (safe default).
5. **Storyboard** (OpenRouter chat model) → strict JSON: title, scenes, on-screen text,
   visual prompts, asset queries, timings, caption lines, voice script.
6. **Create job** → `queued → running → done|failed`, progress logged; UI polls.
7. **Render**
   - *easy*: deterministic FFmpeg — backgrounds/stock/generated visuals, scene transitions,
     captions, optional local Piper voice, MP4 (H.264/AAC) + thumbnail.
   - *hard*: spawn `opencode run --auto` in the job workspace with `video-generation.md`;
     validate output; on any failure fall back to the deterministic renderer.
   - *image*: one designed PNG still from the same scene/design system.
8. **Deliver** → player + download + "open folder"; asset persists in chat history.

## Milestones (ordered, small)

| # | Milestone | Done when |
|---|---|---|
| M0 | Foundation: `git init` + public repo, fix env names, SQLite (`node:sqlite`), schema (users, sessions, chats, messages, assets, jobs), app shell/theme | build passes, DB creates |
| M1 | Auth + persistence: register/login/logout, scrypt hashes, cookie sessions, protected `/chat`, multi-chat CRUD | reload keeps user + chats |
| M2 | Chat UI + sidebar: message stream, composer, model replies, intent chip (video/image), asset detail panel + "How it works" | chat round-trip works |
| M3 | Decision + storyboard: Trillionir router, OpenRouter JSON storyboard with validation/repair, job record + polling API | job reaches `running` with valid plan |
| M4 | Video renderer: FFmpeg scenes, captions (system fonts), transitions, 10/30/60s, 3 aspects, thumbnail, progress | 10s MP4 plays |
| M5 | Image renderer + audio: PNG still from same design; local Piper narration (download once) or silent toggle; graceful fallback | PNG + voiced MP4 |
| M6 | Hard path: install/configure opencode on tests2 (OpenRouter provider), spawn with timeout, capture logs, fallback | forced-hard request renders |
| M7 | Polish: homepage, empty/loading/error states, Playwright pass, copy pass | no broken states |
| M8 | Ship: README (problem, flow, demo), build, deploy tests2 + cloudflared, demo script | public URL works |

## Decisions locked in

- Chat/storyboard LLM: **OpenRouter** (`https://openrouter.ai/api/v1`, `openai/gpt-4o-mini`, env override).
- Decision LLM: **Trillionir** `POST https://thetrillioniar.me/v1/systemone`, model `verdict-151m`.
- Video: **FFmpeg** deterministic pipeline (HyperFrames optional, not required). Local **Piper** TTS.
- DB: built-in `node:sqlite`; files under `data/` (gitignored). No extra frameworks.
- Output presets: 10/30/60s; 9:16 (default), 16:9, 1:1; 720p on tests2, 1080p locally.
- Stock visuals: Openverse (no key) with generated-gradient fallback; uploads allowed.

## Out of scope

Real generative video models (Veo/Sora/Runway), social publishing, research/news generation,
frame/pixel RAG editing, agent "watching" rendered video via screenshots, caption editor,
OAuth/teams/billing, native apps, custom HyperFrames authoring UI.

## Definition of done

Built and deployed URL where a new user can register, create a chat, generate a 10s vertical
MP4 **and** a PNG, play/download both, reload and still see history, switch chat and generate a
30s video, choose silent vs voiced, and see the router decision. `npm run build` passes,
README explains problem + demo steps, repo is public and pushed.

## Known constraints / notes

- `.env` had `OPENROUTER-API_KEY` (invalid shell name) — renamed to `OPENROUTER_API_KEY`; `.env` stays ignored.
- tests2: 2 vCPU, no ffmpeg/opencode — install static ffmpeg + piper + opencode in `~/bin`, use `nohup`.
- Verdict model abstains easily; always have the deterministic fallback, never block the demo on it.
- Log all build/deploy output to `./.agent-logs/`; keep `current-task.md` current.
