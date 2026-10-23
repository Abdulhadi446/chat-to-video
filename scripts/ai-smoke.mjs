#!/usr/bin/env node
/**
 * AI smoke test: parseIntent -> createStoryboard -> decideMode against the real
 * OpenRouter / Trillionir keys in .env. Compiles the small lib/ai surface with
 * the local TypeScript compiler (no dev server needed), then logs results to
 * .agent-logs/ai-smoke.log.
 *
 * Run: node scripts/ai-smoke.mjs
 */
import { spawnSync } from "node:child_process"
import fs from "node:fs"
import { createRequire } from "node:module"
import path from "node:path"

const require = createRequire(import.meta.url)

const ROOT = path.resolve(import.meta.dirname, "..")
const LOG_DIR = path.join(ROOT, ".agent-logs")
const BUILD_DIR = path.join(LOG_DIR, "ai-smoke-build")
const LOG_PATH = path.join(LOG_DIR, "ai-smoke.log")

fs.mkdirSync(LOG_DIR, { recursive: true })
fs.rmSync(BUILD_DIR, { recursive: true, force: true })
fs.mkdirSync(BUILD_DIR, { recursive: true })

function loadEnv(file) {
  if (!fs.existsSync(file)) return
  const text = fs.readFileSync(file, "utf8")
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/)
    if (!match) continue
    let value = match[2].trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    if (process.env[match[1]] === undefined) process.env[match[1]] = value
  }
}

for (const name of [".env", ".env.local"]) loadEnv(path.join(ROOT, name))

const logLines = []
function log(message) {
  const line = typeof message === "string" ? message : JSON.stringify(message, null, 2)
  logLines.push(line)
  console.log(line)
}
function flush() {
  fs.appendFileSync(LOG_PATH, `${logLines.join("\n")}\n`)
}

function compile() {
  const tsc = path.join(ROOT, "node_modules", "typescript", "bin", "tsc")
  if (!fs.existsSync(tsc)) throw new Error(`TypeScript compiler not found at ${tsc}`)
  const inputs = [
    "lib/types.ts",
    "lib/ai/openrouter.ts",
    "lib/ai/intent.ts",
    "lib/ai/decision.ts",
    "lib/ai/storyboard.ts",
  ]
  const args = [
    tsc,
    ...inputs,
    "--outDir",
    BUILD_DIR,
    "--module",
    "commonjs",
    "--moduleResolution",
    "node",
    "--target",
    "es2022",
    "--lib",
    "es2022,dom",
    "--types",
    "node",
    "--esModuleInterop",
    "--skipLibCheck",
    "--strict",
  ]
  const result = spawnSync(process.execPath, args, { cwd: ROOT, encoding: "utf8" })
  if (result.status !== 0) {
    throw new Error(`tsc failed:\n${result.stdout}\n${result.stderr}`)
  }
}

function summariseSpec(spec) {
  const total = spec.scenes.reduce((sum, scene) => sum + scene.duration, 0)
  return {
    title: spec.title,
    kind: spec.kind,
    duration: spec.duration,
    aspect: spec.aspect,
    voice: spec.voice,
    scenes: spec.scenes.map((scene) => ({
      text: scene.text,
      caption: scene.caption,
      duration: scene.duration,
      transition: scene.transition,
      assetQuery: scene.assetQuery ?? null,
    })),
    sceneDurationsSum: total,
    sumsToDuration: total === spec.duration,
    voiceScript: spec.voiceScript ?? null,
    palette: spec.palette,
  }
}

function validateSpec(spec) {
  const errors = []
  if (!Array.isArray(spec.scenes) || spec.scenes.length < 3 || spec.scenes.length > 6) {
    errors.push(`scene count ${spec.scenes?.length} outside 3-6`)
  }
  if (spec.scenes?.some((scene) => !(scene.duration > 0))) errors.push("non-positive scene duration")
  const total = spec.scenes?.reduce((sum, scene) => sum + scene.duration, 0) ?? 0
  if (total !== spec.duration) errors.push(`durations sum to ${total}, expected ${spec.duration}`)
  if (!spec.scenes?.every((scene) => scene.visual && scene.caption && scene.text)) {
    errors.push("scene missing text/caption/visual")
  }
  return errors
}

async function main() {
  log(`\n=== AI smoke ${new Date().toISOString()} ===`)
  log(`OpenRouter key: ${process.env.OPENROUTER_API_KEY ? "present" : "MISSING"}`)
  log(`Trillionir key: ${process.env.THETRILLIONIAR_API_KEY ? "present" : "MISSING"}`)

  compile()
  log(`Compiled lib/ai to ${path.relative(ROOT, BUILD_DIR)}`)

  const { parseIntent } = require(path.join(BUILD_DIR, "ai", "intent.js"))
  const { createStoryboard } = require(path.join(BUILD_DIR, "ai", "storyboard.js"))
  const { decideMode } = require(path.join(BUILD_DIR, "ai", "decision.js"))

  const failures = []
  const history = [
    { id: "m1", chatId: "c1", role: "user", content: "make a 10s vertical coffee ad with a calm voiceover", meta: null, createdAt: 1 },
    { id: "m2", chatId: "c1", role: "assistant", content: "Queued a 10s video.", meta: { assetId: "a1", jobId: "j1" }, createdAt: 2 },
  ]

  const cases = [
    {
      name: "video/voiceover",
      text: "Make a 10 second vertical coffee ad with a calm voiceover, warm and minimal",
      history: [],
      expect: { kind: "video", duration: 10, aspect: "9:16", voice: "narrator" },
    },
    {
      name: "image/square",
      text: "Generate a square poster image for a late-night jazz show, bold typography",
      history: [],
      expect: { kind: "image", aspect: "1:1" },
    },
    {
      name: "greeting/clarification",
      text: "hey, what can you do?",
      history: [],
      expect: { clarification: true },
    },
    {
      name: "follow-up",
      text: "make it 30 seconds and landscape please",
      history,
      expect: { duration: 30, aspect: "16:9" },
    },
    {
      name: "hyphen-duration",
      text: "Make a 30-second 16:9 trailer with narration",
      history: [],
      expect: { kind: "video", duration: 30, aspect: "16:9", voice: "narrator" },
    },
  ]

  const parsedIntents = []
  for (const testCase of cases) {
    try {
      const intent = await parseIntent(testCase.text, testCase.history)
      parsedIntents.push(intent)
      const errors = []
      for (const [key, expected] of Object.entries(testCase.expect)) {
        if (key === "clarification") {
          if (!intent.needsClarification) errors.push("expected needsClarification")
        } else if (intent[key] !== expected) {
          errors.push(`${key}: expected ${expected}, got ${intent[key]}`)
        }
      }
      log(`\n[parseIntent:${testCase.name}] ${testCase.text}`)
      log(JSON.stringify(intent, null, 2))
      if (errors.length) failures.push(`parseIntent/${testCase.name}: ${errors.join("; ")}`)
    } catch (error) {
      failures.push(`parseIntent/${testCase.name} threw: ${error.message}`)
      log(`[parseIntent:${testCase.name}] ERROR ${error.stack ?? error.message}`)
    }
  }

  const storyboardIntent = parsedIntents[0] ?? {
    kind: "video",
    topic: "A calm coffee ad",
    duration: 10,
    aspect: "9:16",
    voice: "narrator",
  }

  let storyboard = null
  try {
    storyboard = await createStoryboard(storyboardIntent)
    const errors = validateSpec(storyboard)
    log("\n[createStoryboard]")
    log(JSON.stringify(summariseSpec(storyboard), null, 2))
    if (errors.length) failures.push(`createStoryboard: ${errors.join("; ")}`)
  } catch (error) {
    failures.push(`createStoryboard threw: ${error.message}`)
    log(`[createStoryboard] ERROR ${error.stack ?? error.message}`)
  }

  const imageIntent = parsedIntents[1]
  if (imageIntent) {
    try {
      const imageSpec = await createStoryboard(imageIntent)
      const errors = validateSpec(imageSpec)
      log("\n[createStoryboard:image]")
      log(JSON.stringify(summariseSpec(imageSpec), null, 2))
      if (errors.length) failures.push(`createStoryboard/image: ${errors.join("; ")}`)
    } catch (error) {
      failures.push(`createStoryboard/image threw: ${error.message}`)
    }
  }

  const simpleIntent = parsedIntents[0] ?? storyboardIntent
  const complexIntent = {
    ...simpleIntent,
    duration: 60,
    topic: "A kinetic 3D brand launch with many product assets, precise beat-synced animation and custom code",
    style: "motion design, compositing, custom WebGL",
  }
  const decisionCases = [
    { name: "simple", intent: simpleIntent, text: "make a 10 second vertical coffee ad with a calm voiceover" },
    {
      name: "complex",
      intent: complexIntent,
      text: "build a kinetic 3D brand launch with multiple product assets, precise beat sync, custom animation and compositing code",
    },
  ]

  for (const decisionCase of decisionCases) {
    try {
      const decision = await decideMode(decisionCase.intent, decisionCase.text)
      log(`\n[decideMode:${decisionCase.name}]`)
      log(JSON.stringify(decision, null, 2))
    } catch (error) {
      failures.push(`decideMode/${decisionCase.name} threw: ${error.message}`)
      log(`[decideMode:${decisionCase.name}] ERROR ${error.stack ?? error.message}`)
    }
  }

  log("\n[summary]")
  if (failures.length) {
    log(`FAIL (${failures.length}):`)
    for (const failure of failures) log(` - ${failure}`)
  } else {
    log("PASS — all AI smoke checks completed without assertion failures")
  }
  log("")
  return failures
}

main()
  .then((failures) => {
    flush()
    process.exitCode = failures.length ? 1 : 0
  })
  .catch((error) => {
    log(`\nFATAL: ${error.stack ?? error.message}`)
    flush()
    process.exitCode = 1
  })
