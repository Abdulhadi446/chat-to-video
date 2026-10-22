import { spawn, type ChildProcess } from "node:child_process"
import { randomBytes } from "node:crypto"
import { createWriteStream } from "node:fs"
import { copyFile, mkdir, readdir, stat, writeFile } from "node:fs/promises"
import path from "node:path"
import type { Asset, VideoSpec } from "../types"

/**
 * Optional autonomous-agent renderer.
 *
 * Contract:
 *   runOpencodeJob({ asset, spec, outDir, onProgress })
 *     -> { filePath: string; thumbPath?: string } on success
 *        filePath is the absolute path of outDir/final.mp4; thumbPath is the
 *        absolute path of outDir/thumb.jpg when thumbnail generation worked.
 *     -> null on any failure (binary missing, spawn error, timeout, non-zero
 *        exit, no final.mp4, invalid MP4, copy failure). thumb.jpg failures
 *        are non-fatal and simply omit thumbPath.
 *
 * The caller (lib/jobs) treats null as "agent path unavailable" and falls back
 * to the deterministic renderer. The whole agent run is limited to 5 minutes;
 * on timeout SIGTERM is sent to the process group, followed by SIGKILL 5s
 * later. stdout/stderr go to data/jobs/agent-<assetId>-<runId>/agent.log,
 * with the last 4KB retained for agent-error.log.
 */

export const OPENCODE_TIMEOUT_MS = 5 * 60 * 1000

const VERSION_TIMEOUT_MS = 5_000
const KILL_GRACE_MS = 5_000
const FORCE_SETTLE_GRACE_MS = 2_000
const TAIL_BYTES = 4 * 1024
const MAX_USER_PROMPT_CHARS = 4_000
const MAX_BRIEF_CHARS = 64_000
const MAX_MODEL_CHARS = 120
const PROBE_TIMEOUT_MS = 20_000
const THUMB_TIMEOUT_MS = 30_000
const MAX_SCAN_ENTRIES = 5_000
const MAX_SCAN_DEPTH = 8

const ASPECT_DIMENSIONS: Record<VideoSpec["aspect"], string> = {
  "9:16": "720x1280 (portrait)",
  "16:9": "1280x720 (landscape)",
  "1:1": "1080x1080 (square)",
}

export interface AgentProgress {
  progress: number
  stage: string
}

export interface RunOpencodeJobInput {
  asset: Asset
  spec: VideoSpec
  outDir: string
  onProgress: (progress: AgentProgress) => void
}

export interface RunOpencodeJobResult {
  filePath: string
  thumbPath?: string
}

interface ProcessResult {
  code: number | null
  stdout: string
  stderr: string
  error: string | null
  timedOut: boolean
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Never let a caller-provided progress callback break a render. */
function emitProgress(
  onProgress: RunOpencodeJobInput["onProgress"],
  progress: number,
  stage: string,
): void {
  try {
    onProgress({ progress, stage })
  } catch {
    /* progress reporting is best-effort */
  }
}

/** One argv entry per argument; the caller's text is never handed to a shell. */
function safeSegment(value: string, fallback: string): string {
  const cleaned = value
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .replace(/^[.-]+/, "_")
    .slice(0, 80)
  return cleaned || fallback
}

/**
 * Check that the binary exists and responds. `spawn` emits ENOENT instead of
 * throwing for a missing executable, so this resolves false (never rejects).
 */
function probeBinary(bin: string): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false

    const finish = (ok: boolean) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(ok)
    }

    let child: ChildProcess
    try {
      child = spawn(bin, ["--version"], {
        stdio: ["ignore", "ignore", "ignore"],
        env: process.env,
        windowsHide: true,
      })
    } catch {
      resolve(false)
      return
    }

    child.once("error", () => finish(false))
    child.once("close", (code) => finish(code === 0))
    const timer = setTimeout(() => {
      try {
        child.kill("SIGKILL")
      } catch {
        /* already gone */
      }
      finish(false)
    }, VERSION_TIMEOUT_MS)
  })
}

async function resolveOpencodeBinary(): Promise<string | null> {
  const configured = process.env.OPENCODE_BIN?.trim()
  // A relative path with a slash would otherwise be resolved against the
  // agent workdir (the child's cwd), so anchor it to the project cwd.
  const bin =
    configured && !path.isAbsolute(configured) && /[\\/]/.test(configured)
      ? path.resolve(process.cwd(), configured)
      : configured || "opencode"
  return (await probeBinary(bin)) ? bin : null
}

/** Secrets are redacted from captured output before it reaches disk / errors. */
function collectSecretValues(): string[] {
  const keyPattern = /(_KEY|_TOKEN|_SECRET|_PASSWORD|_PASS)$/i
  const values: string[] = []
  for (const [key, value] of Object.entries(process.env)) {
    if (!value || value.length < 8 || !keyPattern.test(key)) continue
    values.push(value)
  }
  return values.sort((a, b) => b.length - a.length).slice(0, 40)
}

function redact(text: string, secrets: string[]): string {
  let out = text
  for (const secret of secrets) {
    if (out.includes(secret)) out = out.split(secret).join("[redacted]")
  }
  // Catch well-known token shapes even if they are not in our own env.
  out = out.replace(/\bsk-[A-Za-z0-9_-]{16,}\b/g, "[redacted]")
  return out
}

function buildAgentPrompt(spec: VideoSpec): string {
  return [
    "You are an autonomous video production agent working inside this job directory.",
    "First read BRIEF.md and video-generation.md in the current directory.",
    "Follow the brief and VideoSpec, build the video entirely inside this directory,",
    "and write the finished render to final.mp4 (output/final.mp4 is preferred).",
    "Validate the MP4 with ffprobe and fix any issue before exiting.",
    `Target: ${spec.duration}s, ${spec.aspect}, H.264 video with AAC audio when audio is present.`,
  ]
    .join(" ")
    .slice(0, 1_200)
}

function buildBrief(asset: Asset, spec: VideoSpec): string {
  const prompt = (asset.prompt || "").trim().slice(0, MAX_USER_PROMPT_CHARS)
  const dimensions = ASPECT_DIMENSIONS[spec.aspect] ?? "720x1280 (portrait)"
  const voice =
    spec.voice === "narrator"
      ? "Narrator requested. Add narration only if a local TTS engine is available; a silent video is acceptable if it is not."
      : "Silent video (no narration)."

  const brief = `# Video production brief

You are an autonomous video production agent. Read \`video-generation.md\` in this directory before starting. Build the video from the user request and VideoSpec below. Work only inside this directory. Do not ask questions; make reasonable production decisions and finish.

## User request

<user_prompt>
${prompt}
</user_prompt>

## Required output

- A single MP4 file named \`final.mp4\` at the workspace root, or preferably \`output/final.mp4\`.
- Container: MP4. Video: H.264 (yuv420p), reasonably high quality, faststart preferred.
- Audio: AAC when audio is present. No audio track is fine for silent videos.
- Aspect ratio: ${spec.aspect} — render at ${dimensions}.
- Duration: exactly ${spec.duration} seconds (the validator accepts 1–90 seconds).
- Captions: burn in the scene captions from the VideoSpec (or an equivalent synchronized caption track). Keep text readable and inside safe margins.
- Voice: ${voice}
- Do not publish, upload, or deploy anything. Do not print or write secrets.
- Validate the final file with ffprobe before exiting.

## VideoSpec (JSON)

\`\`\`json
${JSON.stringify(spec, null, 2)}
\`\`\`

## Production instructions

Read \`video-generation.md\` (copied into this directory next to this brief) for the full production workflow: scene design, animation, transitions, captions, optional TTS, rendering, and validation. Use FFmpeg or any already-available local tooling; do not spend time on unrelated research. When done, the only thing that matters is a valid \`final.mp4\`.
`

  return brief.slice(0, MAX_BRIEF_CHARS)
}

function resolveFfprobePath(): string {
  const configured = process.env.FFPROBE_PATH?.trim()
  if (configured) return configured

  const ffmpeg = process.env.FFMPEG_PATH?.trim()
  if (ffmpeg && (ffmpeg.includes("/") || ffmpeg.includes("\\"))) {
    return path.join(
      path.dirname(ffmpeg),
      process.platform === "win32" ? "ffprobe.exe" : "ffprobe",
    )
  }
  return "ffprobe"
}

function resolveFfmpegPath(): string {
  return process.env.FFMPEG_PATH?.trim() || "ffmpeg"
}

/** Short-lived helper process (ffprobe / thumbnail ffmpeg). Never uses a shell. */
function capture(
  command: string,
  args: string[],
  timeoutMs: number,
  cwd?: string,
): Promise<ProcessResult> {
  return new Promise((resolve) => {
    let child: ChildProcess
    try {
      child = spawn(command, args, {
        cwd,
        stdio: ["ignore", "pipe", "pipe"],
        env: process.env,
        windowsHide: true,
      })
    } catch (error) {
      resolve({ code: null, stdout: "", stderr: "", error: errorMessage(error), timedOut: false })
      return
    }

    let stdout = ""
    let stderr = ""
    let settled = false

    const finish = (code: number | null, error: string | null, timedOut: boolean) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({ code, stdout, stderr, error, timedOut })
    }

    child.stdout?.on("data", (chunk: Buffer) => {
      stdout = (stdout + chunk.toString("utf8")).slice(-1_000_000)
    })
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr = (stderr + chunk.toString("utf8")).slice(-100_000)
    })
    child.once("error", (error) => finish(null, error.message, false))
    child.once("close", (code) => finish(code, null, false))
    const timer = setTimeout(() => {
      try {
        child.kill("SIGKILL")
      } catch {
        /* already gone */
      }
      finish(null, "timeout", true)
    }, timeoutMs)
  })
}

function killProcessGroup(child: ChildProcess, signal: NodeJS.Signals): void {
  if (!child.pid) return
  try {
    // detached:true makes the child a process-group leader, so -pid kills the
    // agent plus every subprocess it spawned (ffmpeg, node, etc.).
    process.kill(-child.pid, signal)
  } catch {
    try {
      child.kill(signal)
    } catch {
      /* already gone */
    }
  }
}

interface AgentRunOutcome {
  code: number | null
  timedOut: boolean
  error: string | null
}

interface AgentRunState {
  outcome: Promise<AgentRunOutcome>
  getTail: () => string
}

/**
 * Spawn `opencode run --auto [--model ...] "<fixed prompt>"` with cwd=workdir.
 * Bounds the whole run to 5 minutes, then SIGTERM -> SIGKILL on the group.
 */
function startAgent(
  bin: string,
  args: string[],
  workdir: string,
  logPath: string,
): AgentRunState {
  const log = createWriteStream(logPath, { flags: "w" })
  log.on("error", () => {
    /* logging must never crash the job */
  })

  const secrets = collectSecretValues()
  let tail = ""

  const handleOutput = (chunk: Buffer) => {
    const text = redact(chunk.toString("utf8"), secrets)
    // Keep exactly the last 4KB (bytes, not UTF-16 code units) for errors.
    const combined = Buffer.from(tail + text, "utf8")
    tail =
      combined.length <= TAIL_BYTES
        ? combined.toString("utf8")
        : combined.subarray(combined.length - TAIL_BYTES).toString("utf8")
    if (!log.destroyed && !log.writableEnded) log.write(text)
  }

  let child: ChildProcess
  try {
    child = spawn(bin, args, {
      cwd: workdir,
      env: { ...process.env, CI: "1" },
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    })
  } catch (error) {
    log.end()
    return {
      outcome: Promise.resolve({ code: null, timedOut: false, error: errorMessage(error) }),
      getTail: () => tail,
    }
  }

  child.stdout?.on("data", handleOutput)
  child.stderr?.on("data", handleOutput)

  const outcome = new Promise<AgentRunOutcome>((resolve) => {
    let settled = false
    let timedOut = false
    let killTimer: NodeJS.Timeout | undefined
    let forceTimer: NodeJS.Timeout | undefined

    const finish = (code: number | null, error: string | null) => {
      if (settled) return
      settled = true
      clearTimeout(timeoutTimer)
      if (killTimer) clearTimeout(killTimer)
      if (forceTimer) clearTimeout(forceTimer)
      // Let pending log writes flush, but never wait on a broken stream.
      try {
        log.end()
      } catch {
        /* ignore */
      }
      resolve({ code, timedOut, error })
    }

    const timeoutTimer = setTimeout(() => {
      timedOut = true
      killProcessGroup(child, "SIGTERM")
      killTimer = setTimeout(() => {
        killProcessGroup(child, "SIGKILL")
      }, KILL_GRACE_MS)
      // Last-resort settle if the child never emits close (e.g. a stuck D-state
      // subprocess). The 5s SIGKILL above should make this unnecessary.
      forceTimer = setTimeout(() => {
        killProcessGroup(child, "SIGKILL")
        finish(null, `timed out after ${OPENCODE_TIMEOUT_MS}ms`)
      }, KILL_GRACE_MS + FORCE_SETTLE_GRACE_MS)
    }, OPENCODE_TIMEOUT_MS)

    child.once("error", (error) => finish(null, error.message))
    child.once("close", (code, signal) => {
      const suffix = signal ? ` (signal ${signal})` : ""
      finish(code, code === 0 ? null : `opencode exited with code ${code ?? "null"}${suffix}`)
    })
  })

  return { outcome, getTail: () => tail }
}

/** Find final.mp4 under the workspace, preferring root/output locations. */
async function findFinalMp4(root: string): Promise<string | null> {
  const queue: Array<{ dir: string; depth: number }> = [{ dir: root, depth: 0 }]
  const candidates: string[] = []
  let seen = 0

  while (queue.length > 0 && seen < MAX_SCAN_ENTRIES) {
    const current = queue.shift()
    if (!current) break
    if (current.depth > MAX_SCAN_DEPTH) continue

    let entries
    try {
      entries = await readdir(current.dir, { withFileTypes: true })
    } catch {
      continue
    }

    for (const entry of entries) {
      seen += 1
      if (seen > MAX_SCAN_ENTRIES) break
      const full = path.join(current.dir, entry.name)
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name === ".git" || entry.name === ".next") {
          continue
        }
        queue.push({ dir: full, depth: current.depth + 1 })
      } else if (entry.isFile() && entry.name === "final.mp4") {
        candidates.push(full)
      }
    }
  }

  if (candidates.length === 0) return null
  const priority = (file: string): number => {
    const rel = path.relative(root, file).split(path.sep)
    if (rel.length === 1) return 0
    if (rel.length === 2 && rel[0] === "output") return 1
    return 2
  }
  candidates.sort((a, b) => priority(a) - priority(b))
  return candidates[0] ?? null
}

async function probeVideo(
  filePath: string,
  ffprobePath: string,
): Promise<{ ok: boolean; duration: number; reason?: string }> {
  const result = await capture(
    ffprobePath,
    [
      "-v",
      "error",
      "-show_entries",
      "format=duration:stream=codec_type,duration",
      "-of",
      "json",
      filePath,
    ],
    PROBE_TIMEOUT_MS,
  )

  if (result.code !== 0) {
    return {
      ok: false,
      duration: 0,
      reason: result.error || result.stderr.trim().slice(0, 500) || "ffprobe failed",
    }
  }

  let parsed: {
    format?: { duration?: string | number }
    streams?: Array<{ codec_type?: string; duration?: string | number }>
  }
  try {
    parsed = JSON.parse(result.stdout)
  } catch {
    return { ok: false, duration: 0, reason: "ffprobe returned invalid JSON" }
  }

  const streams = Array.isArray(parsed.streams) ? parsed.streams : []
  const videoStreams = streams.filter((stream) => stream?.codec_type === "video")
  if (videoStreams.length === 0) {
    return { ok: false, duration: 0, reason: "no video stream" }
  }

  let duration = Number(parsed.format?.duration)
  if (!Number.isFinite(duration) || duration <= 0) {
    const streamDurations = videoStreams
      .map((stream) => Number(stream.duration))
      .filter((value) => Number.isFinite(value) && value > 0)
    duration = streamDurations.length > 0 ? Math.max(...streamDurations) : 0
  }

  if (!Number.isFinite(duration) || duration < 1 || duration > 90) {
    return {
      ok: false,
      duration,
      reason: `duration ${Number.isFinite(duration) ? duration.toFixed(2) : "unknown"}s is outside 1-90s`,
    }
  }

  return { ok: true, duration }
}

async function makeThumbnail(
  videoPath: string,
  outDir: string,
  ffmpegPath: string,
): Promise<string | undefined> {
  const thumbPath = path.join(outDir, "thumb.jpg")
  const result = await capture(
    ffmpegPath,
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-ss",
      "1",
      "-i",
      videoPath,
      "-frames:v",
      "1",
      "-q:v",
      "3",
      thumbPath,
    ],
    THUMB_TIMEOUT_MS,
    outDir,
  )
  if (result.code !== 0) return undefined
  try {
    const info = await stat(thumbPath)
    return info.size > 0 ? thumbPath : undefined
  } catch {
    return undefined
  }
}

async function recordFailure(workdir: string, reason: string, tail: string): Promise<void> {
  const body = `agent failed: ${reason}\n\n--- last ${TAIL_BYTES} bytes of agent output ---\n${tail}\n`
  try {
    await writeFile(path.join(workdir, "agent-error.log"), body, "utf8")
  } catch {
    /* diagnostics are best-effort */
  }
}

export async function runOpencodeJob({
  asset,
  spec,
  outDir,
  onProgress,
}: RunOpencodeJobInput): Promise<RunOpencodeJobResult | null> {
  // This module only produces agent videos. Image jobs must use the
  // deterministic image renderer rather than a mislabelled MP4.
  if (asset.kind !== "video" || spec.kind !== "video") return null

  // 1. Optional binary: absent means "not supported here", not an error.
  const binary = await resolveOpencodeBinary()
  if (!binary) return null

  const assetId = safeSegment(asset.id, "asset")
  const runId = `${Date.now().toString(36)}-${randomBytes(3).toString("hex")}`
  const workdir = path.resolve(process.cwd(), "data", "jobs", `agent-${assetId}-${runId}`)
  const logPath = path.join(workdir, "agent.log")

  let started = false
  let getTail: (() => string) | null = null

  try {
    emitProgress(onProgress, 5, "Preparing agent workspace")
    await mkdir(workdir, { recursive: true })

    // 2. Brief: user prompt + typed spec + hard output requirements.
    await writeFile(path.join(workdir, "BRIEF.md"), buildBrief(asset, spec), "utf8")

    // 3. Copy the production guide next to the brief (read-only source).
    const guideSource = path.resolve(process.cwd(), "video-generation.md")
    await copyFile(guideSource, path.join(workdir, "video-generation.md"))

    // 4. Spawn non-interactively. Args are an array; no shell interpolation.
    const model = process.env.OPENCODE_MODEL?.trim().slice(0, MAX_MODEL_CHARS)
    const args = ["run", "--auto"]
    if (model) args.push("--model", model)
    args.push(buildAgentPrompt(spec))

    emitProgress(onProgress, 15, "Agent is building the video")
    const run = startAgent(binary, args, workdir, logPath)
    started = true
    getTail = run.getTail

    const outcome = await run.outcome
    const tail = run.getTail()

    if (outcome.timedOut) {
      await recordFailure(workdir, outcome.error ?? "timeout", tail)
      return null
    }
    if (outcome.code !== 0 || outcome.error) {
      await recordFailure(workdir, outcome.error ?? `exit code ${outcome.code}`, tail)
      return null
    }

    // 5. Locate and validate the agent's render.
    emitProgress(onProgress, 70, "Checking rendered video")
    const candidate = await findFinalMp4(workdir)
    if (!candidate) {
      await recordFailure(workdir, "final.mp4 was not produced", tail)
      return null
    }

    const probe = await probeVideo(candidate, resolveFfprobePath())
    if (!probe.ok) {
      await recordFailure(workdir, probe.reason ?? "invalid video", tail)
      return null
    }

    // 6. Deliver to the caller's output directory.
    const destinationDir = path.resolve(outDir)
    await mkdir(destinationDir, { recursive: true })
    const filePath = path.join(destinationDir, "final.mp4")
    await copyFile(candidate, filePath)

    emitProgress(onProgress, 88, "Creating thumbnail")
    const thumbPath = await makeThumbnail(filePath, destinationDir, resolveFfmpegPath())

    emitProgress(onProgress, 92, "Agent render complete")
    return thumbPath ? { filePath, thumbPath } : { filePath }
  } catch (error) {
    if (started) {
      await recordFailure(workdir, errorMessage(error), getTail?.() ?? "")
    }
    return null
  }
}

export default runOpencodeJob
