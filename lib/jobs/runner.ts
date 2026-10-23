import { existsSync } from "node:fs"
import { copyFile, mkdir, stat } from "node:fs/promises"
import path from "node:path"

import dbApi from "@/lib/db"
import type { Asset, VideoSpec } from "@/lib/types"
import { buildFallbackSpec } from "@/lib/ai/storyboard"
import type { Intent } from "@/lib/ai/intent"
import { synthesizeNarration } from "@/lib/audio/piper"
import { runOpencodeJob } from "@/lib/agent/opencode"
import { renderImage } from "@/lib/render/image"
import { renderVideo } from "@/lib/render/video"

const MAX_LOG_CHARS = 8_000
const PROGRESS_MIN_DELTA = 3

/** In-process fire-and-forget guards (the DB guard covers other processes). */
const activeJobs = new Set<string>()
const activeByAsset = new Map<string, string>()

const DATA_DIR = () => path.resolve(process.cwd(), "data")
const OUTPUT_DIR = (assetId: string) => path.join(DATA_DIR(), "outputs", assetId)
const JOB_DIR = (jobId: string) => path.join(DATA_DIR(), "jobs", jobId)

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function clampProgress(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(100, Math.round(value)))
}

/** Normalise a renderer progress value (0-1 or 0-100) to 0-100. */
function normaliseProgress(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0
  return clampProgress(value <= 1 ? value * 100 : value)
}

/** Repo-relative, forward-slash path for anything stored in the DB. */
export function repoRelativePath(filePath: string): string {
  const absolute = path.isAbsolute(filePath) ? filePath : path.resolve(process.cwd(), filePath)
  const relative = path.relative(process.cwd(), absolute).split(path.sep).join("/")
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) return filePath
  return relative
}

function normaliseDuration(value: number | null | undefined): 10 | 30 | 60 {
  const n = typeof value === "number" && Number.isFinite(value) ? value : 10
  if (n <= 15) return 10
  if (n <= 40) return 30
  return 60
}

function fallbackIntentFor(asset: Asset): Intent {
  const prompt = (asset.prompt || "A short cinematic story").trim()
  return {
    kind: asset.kind,
    topic: prompt.length > 120 ? `${prompt.slice(0, 117).trimEnd()}...` : prompt,
    duration: normaliseDuration(asset.duration),
    aspect: asset.aspect ?? "9:16",
    voice: "silent",
  }
}

/** Copy a renderer output into `data/outputs/<assetId>/` when it landed elsewhere. */
async function deliverFile(
  filePath: string | null | undefined,
  destinationDir: string,
  destinationName: string,
): Promise<string | null> {
  if (!filePath) return null
  try {
    const absolute = path.isAbsolute(filePath) ? filePath : path.resolve(process.cwd(), filePath)
    const destination = path.join(destinationDir, destinationName)
    const info = await stat(absolute)
    if (!info.isFile() || info.size === 0) return null
    if (path.resolve(absolute) !== path.resolve(destination)) {
      await mkdir(destinationDir, { recursive: true })
      await copyFile(absolute, destination)
    }
    return destination
  } catch {
    return null
  }
}

function narrationText(spec: VideoSpec): string {
  const explicit = spec.voiceScript?.trim()
  if (explicit) return explicit
  return spec.scenes
    .map((scene) => (scene.caption ?? scene.text ?? "").replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join(" ")
    .slice(0, 4_000)
}

function markJobFailed(jobId: string, message: string, log: string[] = []): void {
  try {
    const lines = [...log, `[${new Date().toISOString()}] failed: ${message}`]
    dbApi.updateJob(jobId, {
      status: "failed",
      stage: "failed",
      log: lines.join("\n").slice(-MAX_LOG_CHARS),
    })
  } catch {
    /* best-effort */
  }
}

/**
 * Execute a queued job. Never throws; all failures land on the job + asset rows.
 */
export async function runJob(jobId: string): Promise<void> {
  const job = dbApi.getJob(jobId)
  if (!job) return
  if (job.status === "done" || job.status === "failed") return

  const asset = dbApi.getAsset(job.assetId)
  if (!asset) {
    markJobFailed(jobId, `asset ${job.assetId} not found`)
    return
  }

  const running = activeByAsset.get(asset.id)
  if (running && running !== jobId) {
    markJobFailed(jobId, `another job (${running}) is already active for this asset`)
    return
  }

  // DB-level single-active-job guard: a running job, or an older queued job,
  // wins. Newer queued duplicates are superseded.
  try {
    const siblings = dbApi
      .listJobs(asset.id)
      .filter((j) => j.id !== jobId && (j.status === "queued" || j.status === "running"))
    const blocker = siblings.find(
      (j) =>
        j.status === "running" ||
        j.createdAt < job.createdAt ||
        (j.createdAt === job.createdAt && j.id < job.id),
    )
    if (blocker) {
      markJobFailed(jobId, `another job (${blocker.id}) is already active for this asset`)
      return
    }
    for (const sibling of siblings) {
      if (sibling.status === "queued") {
        markJobFailed(sibling.id, "superseded by a newer job for the same asset")
      }
    }
  } catch {
    /* guard is best-effort */
  }

  activeByAsset.set(asset.id, jobId)

  const startedAt = Date.now()
  const logLines: string[] = []
  let lastProgress = -1
  let lastStage = ""

  const addLog = (message: string) => {
    logLines.push(`[${new Date().toISOString()}] ${message}`)
    if (logLines.length > 200) logLines.shift()
  }

  const logText = () => logLines.join("\n").slice(-MAX_LOG_CHARS)

  const report = (value: number, stage: string, force = false) => {
    const progress = clampProgress(value)
    if (!force && stage === lastStage && progress - lastProgress < PROGRESS_MIN_DELTA) return
    lastProgress = progress
    lastStage = stage
    try {
      dbApi.updateJob(jobId, { progress, stage })
    } catch {
      /* progress updates must never break a render */
    }
  }

  const fail = (error: unknown) => {
    const message = errorMessage(error).slice(0, 800)
    addLog(`failed: ${message}`)
    markJobFailed(jobId, message, logLines)
    try {
      dbApi.updateAsset(asset.id, { status: "failed", error: message })
    } catch {
      /* best-effort */
    }
    console.error(`[jobs] job ${jobId} (asset ${asset.id}) failed: ${message}`)
  }

  try {
    const outDir = OUTPUT_DIR(asset.id)
    const workDir = JOB_DIR(jobId)
    await mkdir(outDir, { recursive: true })
    await mkdir(workDir, { recursive: true })

    let spec: VideoSpec = asset.spec ?? buildFallbackSpec(fallbackIntentFor(asset))
    if (!Array.isArray(spec.scenes) || spec.scenes.length === 0) {
      spec = buildFallbackSpec(fallbackIntentFor(asset))
    }
    if (spec.kind !== asset.kind) spec = { ...spec, kind: asset.kind }
    if (!asset.spec) {
      try {
        dbApi.updateAsset(asset.id, { spec })
      } catch {
        /* best-effort */
      }
    }

    addLog(`starting ${asset.kind} job mode=${job.mode} duration=${spec.duration}s aspect=${spec.aspect}`)
    try {
      dbApi.updateJob(jobId, {
        status: "running",
        progress: 3,
        stage: "planning",
        log: logText(),
      })
      dbApi.updateAsset(asset.id, { status: "running", error: null })
    } catch {
      /* DB hiccups should not prevent rendering */
    }
    report(5, "planning", true)

    // ---- Agent path (falls back to deterministic on null) ----
    if (job.mode === "agent") {
      addLog("agent mode: trying opencode")
      try {
        const agentResult = await runOpencodeJob({
          asset,
          spec,
          outDir,
          onProgress: (event) => {
            const stage = /voice|audio|narration/i.test(event.stage) ? "voice" : "rendering"
            report(8 + normaliseProgress(event.progress) * 0.8, stage)
          },
        })

        if (agentResult) {
          const finalFile = await deliverFile(
            agentResult.filePath,
            outDir,
            asset.kind === "image" ? "final.png" : "final.mp4",
          )
          if (finalFile) {
            const thumbPath =
              (await deliverFile(agentResult.thumbPath, outDir, "thumb.jpg")) ??
              (asset.kind === "image" ? finalFile : null)
            report(95, "finalizing", true)
            dbApi.updateAsset(asset.id, {
              status: "done",
              filePath: repoRelativePath(finalFile),
              thumbPath: thumbPath ? repoRelativePath(thumbPath) : null,
              duration: asset.kind === "image" ? null : spec.duration,
              aspect: spec.aspect,
              spec,
              error: null,
            })
            dbApi.updateJob(jobId, {
              status: "done",
              progress: 100,
              stage: "done",
              log: logText(),
            })
            addLog(`done in ${Date.now() - startedAt}ms (agent)`)
            return
          }
          addLog("agent returned a path but no usable file; falling back")
        } else {
          addLog("agent unavailable or failed; falling back to deterministic renderer")
        }
      } catch (error) {
        addLog(`agent error (${errorMessage(error)}); falling back to deterministic renderer`)
      }
    }

    // ---- Deterministic path ----
    if (asset.kind === "image") {
      report(20, "assets", true)
      const imageResult = await renderImage(spec, outDir)
      const finalFile = await deliverFile(imageResult.filePath, outDir, "final.png")
      if (!finalFile) throw new Error("image renderer did not produce a usable file")

      report(92, "finalizing", true)
      dbApi.updateAsset(asset.id, {
        status: "done",
        filePath: repoRelativePath(finalFile),
        thumbPath: repoRelativePath(finalFile),
        duration: null,
        aspect: spec.aspect,
        spec,
        error: null,
      })
      dbApi.updateJob(jobId, { status: "done", progress: 100, stage: "done", log: logText() })
      addLog(`done in ${Date.now() - startedAt}ms (image)`)
      return
    }

    let audioPath: string | null = null
    if (spec.voice === "narrator") {
      report(10, "voice", true)
      const text = narrationText(spec)
      if (text) {
        const wavPath = path.join(workDir, "narration.wav")
        try {
          const narration = await synthesizeNarration(text, wavPath)
          if (narration.ok) {
            const candidate = narration.wavPath ?? wavPath
            const absolute = path.isAbsolute(candidate) ? candidate : path.resolve(process.cwd(), candidate)
            if (existsSync(absolute)) {
              audioPath = absolute
              addLog(`narration ready: ${repoRelativePath(absolute)}`)
            } else if (existsSync(wavPath)) {
              audioPath = wavPath
              addLog(`narration ready: ${repoRelativePath(wavPath)}`)
            } else {
              addLog("narration returned ok but no wav file was found; rendering silent")
            }
          } else {
            addLog(`narration unavailable (${narration.error ?? "unknown"}); rendering silent`)
          }
        } catch (error) {
          addLog(`narration failed (${errorMessage(error)}); rendering silent`)
        }
      } else {
        addLog("narrator requested but no script/captions; rendering silent")
      }
    }

    report(25, "assets", true)
    addLog("deterministic renderer: starting")
    const renderResult = await renderVideo(
      spec,
      outDir,
      (event) => {
        const stage = /voice|audio|narrat/i.test(event.stage)
          ? "voice"
          : /asset|stock|background|image|visual|prepar/i.test(event.stage)
            ? "assets"
            : "rendering"
        const progress = 25 + normaliseProgress(event.progress) * 0.65
        report(progress, stage)
      },
      { audioPath },
    )

    const finalFile = await deliverFile(renderResult.filePath, outDir, "final.mp4")
    if (!finalFile) throw new Error("video renderer did not produce a usable file")
    const thumbPath = await deliverFile(renderResult.thumbPath, outDir, "thumb.jpg")

    const duration =
      Number.isFinite(renderResult.duration) && renderResult.duration > 0
        ? renderResult.duration
        : spec.duration

    report(92, "finalizing", true)
    dbApi.updateAsset(asset.id, {
      status: "done",
      filePath: repoRelativePath(finalFile),
      thumbPath: thumbPath ? repoRelativePath(thumbPath) : null,
      duration,
      aspect: spec.aspect,
      spec,
      error: null,
    })
    dbApi.updateJob(jobId, { status: "done", progress: 100, stage: "done", log: logText() })
    addLog(`done in ${Date.now() - startedAt}ms (deterministic)`)
  } catch (error) {
    fail(error)
  } finally {
    if (activeByAsset.get(asset.id) === jobId) activeByAsset.delete(asset.id)
  }
}

/**
 * Fire-and-forget enqueue. Returns immediately; duplicate calls for the same
 * job id in this process are ignored.
 */
export function enqueueJob(jobId: string): void {
  if (!jobId || activeJobs.has(jobId)) return
  activeJobs.add(jobId)
  void runJob(jobId)
    .catch((error) => {
      console.error(`[jobs] unhandled failure for job ${jobId}:`, error)
      markJobFailed(jobId, errorMessage(error))
    })
    .finally(() => {
      activeJobs.delete(jobId)
    })
}
