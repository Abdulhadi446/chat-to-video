# Hackathon project

## Goal

Ship a working, demo-able AI app in ~12 hours. Read TASK.md first for the challenge. Track current work in current-task.md.

## Rules

- Working demo beats perfect code. Build the core flow end to end first, polish later.
- Keep it simple: no new frameworks, no premature abstractions, no extra features not in TASK.md.
- Commit small and often. Run the build before saying something is done.
- Never commit .env or API keys. Use .env.example for placeholders.
- Use Context7 for library docs before writing code against an API.
- After UI changes, check the app with Playwright if it's running.
- Delegate independent work to subagents (explore/general) in parallel to move faster.
- Log all command/build/deploy output under ./.agent-logs/ (timestamped files).
- Keep current-task.md updated with the active task and description.
- If a TODO's mcp is available use it anf keep it updated.
- Use all the mcp's the second you need them.
- Run all the commands in background to save time and dont do work yourself use sub agents becuase multiple sub-agents are faster than a single dev.

## Stack

- Frontend: Next.js + Tailwind + shadcn/ui
- Backend: Next.js API routes
- LLM: OpenAI-compatible client, base URL and key from env
- DB: SQLite (swap to Supabase only if needed)

## Commands

- dev: `npm run dev`
- build: `npm run build`
- deploy: see .opencode/skills/deploy

## Definition of done

Deployed URL works, README explains the problem + demo steps, repo pushed.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

