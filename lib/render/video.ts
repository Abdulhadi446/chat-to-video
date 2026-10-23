/**
 * Deterministic FFmpeg video renderer.
 *
 * Takes a validated `VideoSpec` and produces a real MP4: one Ken Burns scene
 * per storyboard beat, wrapped captions with system fonts, xfade transitions,
 * optional narration audio, plus a JPG thumbnail.
 *
 * No external libraries, no network dependency (backgrounds fall back to
 * generated gradients), deterministic output for the same spec.
 */

import { rm, writeFile } from "node:fs/promises"
import path from "node:path"

import { ASPECTS, type Scene, type Transition, type VideoSpec } from "../types"
import { ensureBackground, ensureScrim } from "./assets"
import {
  accentColor,
  charsPerLine,
  clamp,
  cleanText,
  ensureDir,
  errorMessage,
  even,
  ffColor,
  filterPath,
  fontPath,
  paletteColors,
  probeMedia,
  runFfmpeg,
  wrapText,
} from "./theme"

const FPS = 30
const TRANSITION_SECONDS = 0.4
const MIN_DURATION = 5
const MAX_DURATION = 60
const MAX_SCENES = 12

export interface RenderVideoOptions {
  /** Optional narration / music track. Invalid files are ignored gracefully. */
  audioPath?: string | null
  ffmpegPath?: string
}

export interface RenderProgress {
  progress: number
  stage: string
}

export interface RenderVideoResult {
  filePath: string
  thumbPath: string
  duration: number
}

interface PlannedScene {
  text: string
  caption: string
  visual: string
  assetQuery?: string
  transition: Transition
  /** Scene clip length in frames, including the overlap consumed by xfade. */
  frames: number
  /** Clip length in seconds (frames / FPS). */
  duration: number
}

interface ScenePlan {
  scenes: PlannedScene[]
  /** xfade transition start times, one per scene boundary. */
  offsets: number[]
  /** xfade transition names, one per scene boundary. */
  transitions: string[]
  duration: number
  width: number
  height: number
}

function aspectSize(spec: VideoSpec): { width: number; height: number } {
  const aspect = spec.aspect in ASPECTS ? spec.aspect : "9:16"
  return ASPECTS[aspect]
}

export function clampDuration(value: unknown): number {
  const numeric = typeof value === "number" ? value : Number(value)
  if (!Number.isFinite(numeric) || numeric <= 0) return 10
  return Math.round(clamp(numeric, MIN_DURATION, MAX_DURATION))
}

function sanitizeTransition(value: unknown): Transition {
  if (value === "slide" || value === "zoom" || value === "fade") return value
  return "fade"
}

function normalizeScenes(spec: VideoSpec, total: number): PlannedScene[] {
  const raw = Array.isArray(spec.scenes) ? spec.scenes.filter((scene) => Boolean(scene)).slice(0, MAX_SCENES) : []

  const source: Scene[] = raw.length
    ? raw
    : [
        {
          text: cleanText(spec.title, "Untitled"),
          visual: cleanText(spec.style, "abstract gradient"),
          duration: total,
          transition: "fade",
        },
      ]

  return source.map((scene, index) => {
    const text = cleanText(scene.text) || cleanText(scene.caption) || `Scene ${index + 1}`
    const caption = cleanText(scene.caption) || text
    const visual = cleanText(scene.visual) || cleanText(spec.style) || cleanText(spec.title) || "abstract gradient"
    const durationValue = Number(scene.duration)
    const duration = Number.isFinite(durationValue) && durationValue > 0 ? durationValue : total / source.length
    return {
      text,
      caption,
      visual,
      assetQuery: cleanText(scene.assetQuery) || undefined,
      transition: sanitizeTransition(scene.transition),
      frames: 0,
      duration,
    }
  })
}

/**
 * Turn storyboard durations into exact frame counts that add up to the target
 * duration after all transition overlaps are accounted for. Frame-exact
 * planning keeps xfade offsets and the final MP4 duration deterministic.
 */
function planScenes(spec: VideoSpec, total: number): ScenePlan {
  const { width, height } = aspectSize(spec)
  const scenes = normalizeScenes(spec, total)
  const count = scenes.length
  const overlapFrames = count > 1 ? Math.round(TRANSITION_SECONDS * FPS) : 0
  const targetFrames = Math.round(total * FPS)
  const totalFrames = targetFrames + (count - 1) * overlapFrames

  const weights = scenes.map((scene) => (scene.duration > 0 ? scene.duration : 1))
  const weightSum = weights.reduce((sum, weight) => sum + weight, 0) || 1
  const minFrames = count === 1 ? targetFrames : overlapFrames + 4

  const frames = weights.map((weight) => Math.max(minFrames, Math.round((totalFrames * weight) / weightSum)))
  let difference = totalFrames - frames.reduce((sum, value) => sum + value, 0)

  // Rounding and minimums can leave a few frames over/under; rebalance without
  // dropping any scene below the transition overlap.
  let guard = 0
  while (difference !== 0 && guard < 10_000) {
    guard += 1
    if (difference > 0) {
      let index = 0
      for (let i = 1; i < frames.length; i += 1) {
        if (frames[i] > frames[index]) index = i
      }
      frames[index] += 1
      difference -= 1
    } else {
      let index = -1
      for (let i = 0; i < frames.length; i += 1) {
        if (frames[i] > minFrames && (index === -1 || frames[i] > frames[index])) index = i
      }
      if (index === -1) break
      frames[index] -= 1
      difference += 1
    }
  }

  const transitions: string[] = []
  const offsets: number[] = []
  let cumulative = 0
  for (let index = 0; index < count; index += 1) {
    scenes[index].frames = frames[index]
    scenes[index].duration = frames[index] / FPS
    cumulative += frames[index]
    if (index < count - 1) {
      transitions.push(xfadeName(scenes[index].transition))
      offsets.push((cumulative - (index + 1) * overlapFrames) / FPS)
    }
  }

  return {
    scenes,
    offsets,
    transitions,
    duration: Math.max(MIN_DURATION, cumulative / FPS - (count - 1) * (overlapFrames / FPS)),
    width,
    height,
  }
}

function xfadeName(transition: Transition): string {
  if (transition === "slide") return "slideleft"
  if (transition === "zoom") return "zoomin"
  return "fade"
}

function drawtext(options: {
  fontFile: string
  textFile: string
  fontSize: number
  fontColor: string
  x: string
  y: string
  lineSpacing?: number
  boxColor?: string
  boxBorder?: number
}): string {
  const parts = [
    `fontfile='${filterPath(options.fontFile)}'`,
    `textfile='${options.textFile}'`,
    "expansion=none",
    `fontcolor=${options.fontColor}`,
    `fontsize=${options.fontSize}`,
    `line_spacing=${options.lineSpacing ?? Math.round(options.fontSize * 0.28)}`,
    `x=${options.x}`,
    `y=${options.y}`,
  ]
  if (options.boxColor) {
    parts.push("box=1", `boxcolor=${options.boxColor}`, `boxborderw=${options.boxBorder ?? 16}`)
  }
  return `drawtext=${parts.join(":")}`
}

function drawLabel(options: {
  fontFile: string
  text: string
  fontSize: number
  fontColor: string
  x: string
  y: string
  shadow?: boolean
}): string {
  const parts = [
    `fontfile='${filterPath(options.fontFile)}'`,
    `text='${options.text.replace(/'/g, "")}'`,
    `fontcolor=${options.fontColor}`,
    `fontsize=${options.fontSize}`,
    `x=${options.x}`,
    `y=${options.y}`,
  ]
  if (options.shadow) {
    parts.push("shadowcolor=0x000000@0.65", "shadowx=1", "shadowy=2")
  }
  return `drawtext=${parts.join(":")}`
}

function motionExpression(index: number, frames: number): { z: string; x: string; y: string } {
  const progress = `(on+1)/${Math.max(1, frames)}`
  switch (index % 4) {
    case 1:
      return {
        z: "1.08",
        x: `(iw-iw/zoom)*${progress}`,
        y: "ih/2-(ih/zoom/2)",
      }
    case 2:
      return {
        z: `max(1.001,1.10-0.10*${progress})`,
        x: "iw/2-(iw/zoom/2)",
        y: "ih/2-(ih/zoom/2)",
      }
    case 3:
      return {
        z: "1.08",
        x: `(iw-iw/zoom)*(1-${progress})`,
        y: "ih/2-(ih/zoom/2)",
      }
    default:
      return {
        z: `1+0.10*${progress}`,
        x: "iw/2-(iw/zoom/2)",
        y: "ih/2-(ih/zoom/2)",
      }
  }
}

async function renderScene(options: {
  background: string
  scrim: string
  outDir: string
  sceneFile: string
  scene: PlannedScene
  index: number
  totalScenes: number
  titleText: string
  plan: ScenePlan
  accent: string
  ffmpegPath?: string
  mode: "motion" | "still"
}): Promise<void> {
  const { background, scrim, outDir, sceneFile, scene, index, totalScenes, titleText, plan, accent } = options
  const { width, height } = plan
  const minSide = Math.min(width, height)

  const captionFont = Math.round(clamp(minSide * 0.04, 20, 46))
  const titleFont = Math.round(clamp(minSide * 0.07, 32, 76))
  const labelFont = Math.round(clamp(minSide * 0.024, 14, 24))
  const titleLineHeight = Math.round(titleFont * 1.16)

  const margin = Math.round(width * 0.06)
  const captionBottom = Math.round(height * 0.11)
  const titleY = Math.round(height * 0.12)
  const barWidth = Math.round(minSide * 0.09)
  const barHeight = Math.max(3, Math.round(minSide * 0.006))
  const captionBlockHeight = Math.round(captionFont * 2.32) + 36
  const barY = Math.max(
    Math.round(height * 0.5),
    height - captionBottom - captionBlockHeight - Math.round(captionFont * 0.9),
  )

  const captionChars = charsPerLine(width * 0.84 - 40, captionFont)
  const titleChars = charsPerLine(width * 0.86 - 48, titleFont, 0.62)
  const captionText = wrapText(scene.caption, captionChars, 2)
  const titleWrapped = wrapText(titleText, titleChars, 2)

  const regularFont = fontPath(false)
  const boldFont = fontPath(true)

  const captionFile = `caption-${index}.txt`
  await writeFile(path.join(outDir, captionFile), `${captionText}\n`, "utf8")

  const filters: string[] = []
  filters.push(
    drawLabel({
      fontFile: boldFont,
      text: "chat-to-video",
      fontSize: labelFont,
      fontColor: `${ffColor(accent)}@0.85`,
      x: `${margin}`,
      y: `${Math.round(height * 0.055)}`,
      shadow: true,
    }),
    drawLabel({
      fontFile: regularFont,
      text: `${index + 1} / ${totalScenes}`,
      fontSize: labelFont,
      fontColor: "0xFFFFFF@0.65",
      x: `w-text_w-${margin}`,
      y: `${Math.round(height * 0.055)}`,
      shadow: true,
    }),
  )

  if (index === 0 && titleWrapped) {
    const titleFile = "title.txt"
    await writeFile(path.join(outDir, titleFile), `${titleWrapped}\n`, "utf8")
    filters.push(
      drawtext({
        fontFile: boldFont,
        textFile: titleFile,
        fontSize: titleFont,
        fontColor: "0xF8FAFC",
        x: "(w-text_w)/2",
        y: `${titleY}`,
        lineSpacing: Math.max(4, titleLineHeight - titleFont),
        boxColor: "0x000000@0.38",
        boxBorder: 20,
      }),
    )
  }

  const duplicateOfTitle =
    index === 0 && cleanText(scene.caption).toLowerCase() === cleanText(titleText).toLowerCase()
  if (captionText && !duplicateOfTitle) {
    filters.push(
      `drawbox=x=(iw-${barWidth})/2:y=${barY}:w=${barWidth}:h=${barHeight}:color=${ffColor(accent)}@0.95:t=fill`,
      drawtext({
        fontFile: regularFont,
        textFile: captionFile,
        fontSize: captionFont,
        fontColor: "0xFFFFFF",
        x: "(w-text_w)/2",
        y: `h-th-${captionBottom}`,
        lineSpacing: Math.max(4, Math.round(captionFont * 0.32)),
        boxColor: "0x000000@0.34",
        boxBorder: 18,
      }),
    )
  }

  const textChain = filters.join(",")

  let filterGraph: string
  if (options.mode === "motion") {
    const sourceWidth = even(width * 1.35)
    const sourceHeight = even(height * 1.35)
    const motion = motionExpression(index, scene.frames)
    filterGraph =
      `[0:v]scale=${sourceWidth}:${sourceHeight}:force_original_aspect_ratio=increase,` +
      `crop=${sourceWidth}:${sourceHeight},` +
      `zoompan=z='${motion.z}':x='${motion.x}':y='${motion.y}':d=${scene.frames}:s=${width}x${height}:fps=${FPS}[zoomed];` +
      `[zoomed][1:v]overlay=0:0,eq=brightness=-0.03:saturation=1.06,${textChain},` +
      `scale=iw:ih:in_range=full:out_range=tv,format=yuv420p,setrange=range=limited[v]`
  } else {
    filterGraph =
      `[0:v]scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height}[base];` +
      `[base][1:v]overlay=0:0,eq=brightness=-0.03:saturation=1.06,${textChain},` +
      `scale=iw:ih:in_range=full:out_range=tv,format=yuv420p,setrange=range=limited[v]`
  }

  const inputArgs =
    options.mode === "motion"
      ? ["-i", background, "-i", scrim]
      : ["-loop", "1", "-framerate", String(FPS), "-i", background, "-i", scrim]

  await runFfmpeg(
    [
      "-y",
      ...inputArgs,
      "-filter_complex",
      filterGraph,
      "-map",
      "[v]",
      "-frames:v",
      String(scene.frames),
      "-r",
      String(FPS),
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      "20",
      "-profile:v",
      "high",
      "-pix_fmt",
      "yuv420p",
      "-colorspace",
      "bt709",
      "-color_range",
      "tv",
      "-an",
      sceneFile,
    ],
    { cwd: outDir, ffmpegPath: options.ffmpegPath, timeoutMs: 300_000 },
  )
}

async function resolveAudio(input: string | null | undefined, ffmpegPath?: string): Promise<string | null> {
  if (!input) return null
  const resolved = path.resolve(input)
  try {
    const probe = await probeMedia(resolved, ffmpegPath)
    const hasAudio = (probe.streams ?? []).some((stream) => stream.codec_type === "audio")
    const duration = Number(probe.format?.duration ?? 0)
    if (!hasAudio) throw new Error("file has no audio stream")
    if (!Number.isFinite(duration) || duration <= 0.02) throw new Error("audio duration is zero")
    return resolved
  } catch (error) {
    console.warn(`[render] ignoring audio track "${input}": ${errorMessage(error)}`)
    return null
  }
}

async function composeFinal(options: {
  sceneFiles: string[]
  plan: ScenePlan
  outFile: string
  audioPath: string | null
  transitions: boolean
  ffmpegPath?: string
}): Promise<void> {
  const { sceneFiles, plan, outFile, audioPath, transitions } = options
  const count = sceneFiles.length
  const args: string[] = ["-y"]

  for (const file of sceneFiles) args.push("-i", file)
  if (audioPath) args.push("-i", audioPath)

  const graph: string[] = []
  if (count === 1) {
    graph.push("[0:v]format=yuv420p,setrange=range=limited[vout]")
  } else if (transitions) {
    let label = "[0:v]"
    for (let index = 1; index < count; index += 1) {
      const next = `[vx${index}]`
      graph.push(
        `${label}[${index}:v]xfade=transition=${plan.transitions[index - 1]}:` +
          `duration=${TRANSITION_SECONDS}:offset=${plan.offsets[index - 1].toFixed(3)}${next}`,
      )
      label = next
    }
    graph.push(`${label}format=yuv420p,setrange=range=limited[vout]`)
  } else {
    const inputs = sceneFiles.map((_, index) => `[${index}:v]`).join("")
    graph.push(
      `${inputs}concat=n=${count}:v=1:a=0,trim=duration=${plan.duration.toFixed(3)},` +
        "setpts=PTS-STARTPTS,format=yuv420p,setrange=range=limited[vout]",
    )
  }

  if (audioPath) {
    const fadeOut = Math.max(0, plan.duration - 0.8)
    graph.push(
      `[${count}:a]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,` +
        `atrim=0:${plan.duration.toFixed(3)},` +
        `afade=t=in:st=0:d=0.35,afade=t=out:st=${fadeOut.toFixed(3)}:d=0.8,apad[aout]`,
    )
  }

  args.push("-filter_complex", graph.join(";"), "-map", "[vout]")
  if (audioPath) {
    args.push("-map", "[aout]", "-c:a", "aac", "-b:a", "128k", "-ar", "48000", "-ac", "2")
  } else {
    args.push("-an")
  }

  args.push(
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "20",
    "-profile:v",
    "high",
    "-pix_fmt",
    "yuv420p",
    "-colorspace",
    "bt709",
    "-color_range",
    "tv",
    "-r",
    String(FPS),
    "-t",
    plan.duration.toFixed(3),
    "-movflags",
    "+faststart",
    outFile,
  )

  await runFfmpeg(args, { ffmpegPath: options.ffmpegPath, timeoutMs: 420_000 })
}

/**
 * Render a VideoSpec to `outDir/final.mp4` and `outDir/thumb.jpg`.
 */
export async function renderVideo(
  spec: VideoSpec,
  outDir: string,
  onProgress: (progress: RenderProgress) => void,
  options: RenderVideoOptions = {},
): Promise<RenderVideoResult> {
  if (!spec || typeof spec !== "object") {
    throw new Error("renderVideo: a VideoSpec is required")
  }

  const totalDuration = clampDuration(spec.duration)
  const plan = planScenes(spec, totalDuration)
  const { width, height, scenes } = plan

  await ensureDir(outDir)
  const assetsDir = path.join(outDir, "assets")
  await ensureDir(assetsDir)

  let lastProgress = 0
  const emit = (progress: number, stage: string) => {
    lastProgress = Math.max(lastProgress, clamp(progress, 0, 1))
    if (typeof onProgress !== "function") return
    try {
      onProgress({ progress: lastProgress, stage })
    } catch {
      // Progress reporting must never break a render.
    }
  }

  emit(0.01, "Planning storyboard")

  const palette = paletteColors(spec.palette)
  const accent = accentColor(palette)
  const titleText = cleanText(spec.title) || scenes[0]?.caption || "Untitled"

  // 1. Resolve backgrounds (network best-effort, generated fallback).
  const backgrounds: string[] = []
  for (let index = 0; index < scenes.length; index += 1) {
    const scene = scenes[index]
    emit(0.05 + (0.22 * index) / scenes.length, `Preparing visual ${index + 1}/${scenes.length}`)
    try {
      const background = await ensureBackground(
        {
          text: scene.text,
          caption: scene.caption,
          visual: scene.visual,
          assetQuery: scene.assetQuery,
          duration: scene.duration,
          transition: scene.transition,
        },
        spec,
        assetsDir,
      )
      backgrounds.push(background)
    } catch (error) {
      throw new Error(`Failed to prepare background for scene ${index + 1}: ${errorMessage(error)}`)
    }
  }

  const scrim = await ensureScrim(assetsDir, width, height, {
    strength: 0.74,
    start: 0.42,
    ffmpegPath: options.ffmpegPath,
  })

  // 2. Render each scene clip.
  emit(0.28, "Rendering scenes")
  const sceneFiles: string[] = []
  for (let index = 0; index < scenes.length; index += 1) {
    const scene = scenes[index]
    const sceneFile = path.join(outDir, `scene-${index}.mp4`)
    emit(0.28 + (0.42 * index) / scenes.length, `Rendering scene ${index + 1}/${scenes.length}`)
    try {
      await renderScene({
        background: backgrounds[index],
        scrim,
        outDir,
        sceneFile,
        scene,
        index,
        totalScenes: scenes.length,
        titleText,
        plan,
        accent,
        ffmpegPath: options.ffmpegPath,
        mode: "motion",
      })
    } catch (error) {
      // Older/limited FFmpeg builds can reject zoompan; a static cut still ships.
      console.warn(`[render] motion filter failed for scene ${index + 1}, falling back to a still: ${errorMessage(error)}`)
      await renderScene({
        background: backgrounds[index],
        scrim,
        outDir,
        sceneFile,
        scene,
        index,
        totalScenes: scenes.length,
        titleText,
        plan,
        accent,
        ffmpegPath: options.ffmpegPath,
        mode: "still",
      })
    }
    sceneFiles.push(sceneFile)
  }

  // 3. Resolve narration before composing, so an invalid track never fails the render.
  const audioPath = await resolveAudio(options.audioPath, options.ffmpegPath)
  emit(0.72, audioPath ? "Mixing scenes and audio" : "Mixing scenes")

  const finalPath = path.join(outDir, "final.mp4")
  const attempts: Array<{ transitions: boolean; audio: string | null }> = [
    { transitions: scenes.length > 1, audio: audioPath },
  ]
  if (scenes.length > 1) attempts.push({ transitions: false, audio: audioPath })
  if (audioPath) attempts.push({ transitions: scenes.length > 1, audio: null })
  if (scenes.length > 1 && audioPath) attempts.push({ transitions: false, audio: null })

  const compositionErrors: string[] = []
  let composed = false
  for (const attempt of attempts) {
    try {
      await composeFinal({
        sceneFiles,
        plan,
        outFile: finalPath,
        audioPath: attempt.audio,
        transitions: attempt.transitions,
        ffmpegPath: options.ffmpegPath,
      })
      composed = true
      if (attempt.audio !== audioPath) {
        console.warn("[render] audio could not be muxed; wrote a silent video instead")
      } else if (!attempt.transitions && scenes.length > 1) {
        console.warn("[render] xfade transitions unavailable; used clean cuts")
      }
      break
    } catch (error) {
      compositionErrors.push(errorMessage(error))
    }
  }

  if (!composed) {
    await rm(finalPath, { force: true }).catch(() => undefined)
    throw new Error(`Video composition failed: ${compositionErrors[compositionErrors.length - 1] ?? "unknown error"}`)
  }

  // 4. Validate the rendered file before handing it to the job.
  const probe = await probeMedia(finalPath, options.ffmpegPath)
  const videoStream = (probe.streams ?? []).find((stream) => stream.codec_type === "video")
  if (!videoStream || !videoStream.width || !videoStream.height) {
    throw new Error(`Rendered file has no usable video stream: ${finalPath}`)
  }

  emit(0.93, "Creating thumbnail")
  const thumbPath = path.join(outDir, "thumb.jpg")
  await runFfmpeg(
    [
      "-y",
      "-ss",
      "1",
      "-i",
      finalPath,
      "-frames:v",
      "1",
      "-vf",
      `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height}`,
      "-q:v",
      "2",
      "-update",
      "1",
      thumbPath,
    ],
    { ffmpegPath: options.ffmpegPath, timeoutMs: 60_000 },
  )

  emit(1, "Done")
  return {
    filePath: finalPath,
    thumbPath,
    duration: plan.duration,
  }
}
