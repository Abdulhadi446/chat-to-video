/**
 * Background asset resolver for the deterministic renderer.
 *
 * Strategy: try Openverse (keyless stock photos) with a hard 5s timeout, then
 * always fall back to a generated palette gradient. Results are cached per
 * scene inside the job's work directory, so a render never depends on network
 * access and repeated renders are stable.
 */

import { createHash } from "node:crypto"
import { stat, rename, rm, writeFile } from "node:fs/promises"
import path from "node:path"

import { ASPECTS, type Scene, type VideoSpec } from "../types"
import {
  cleanText,
  ensureDir,
  errorMessage,
  even,
  ffColor,
  paletteColors,
  probeMedia,
  runFfmpeg,
} from "./theme"

const OPENVERSE_ENDPOINT = "https://api.openverse.org/v1/images/"
const OPENVERSE_TIMEOUT_MS = 5_000
const DOWNLOAD_TIMEOUT_MS = 5_000
const MAX_IMAGE_BYTES = 12 * 1024 * 1024

// If the network is unreachable, don't pay the 5s timeout for every scene in
// the same render (and immediately following renders).
let openversePausedUntil = 0
const OPENVERSE_COOLDOWN_MS = 2 * 60_000

interface OpenverseImage {
  url?: string
  thumbnail?: string
  width?: number
  height?: number
  license?: string
}

interface OpenverseResponse {
  results?: OpenverseImage[]
}

function sceneKey(scene: Scene, spec: VideoSpec): string {
  const palette = paletteColors(spec.palette).join(",")
  const query = searchQuery(scene, spec)
  const seed = [query, spec.aspect, spec.style ?? "", palette, scene.visual].join("\u0000")
  return createHash("sha1").update(seed).digest("hex").slice(0, 16)
}

function searchQuery(scene: Scene, spec: VideoSpec): string {
  const raw =
    cleanText(scene.assetQuery) ||
    cleanText(scene.visual) ||
    cleanText(spec.style) ||
    cleanText(spec.title) ||
    "abstract gradient"
  return raw
    .replace(/["'`]/g, "")
    .replace(/[|/\\]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 100)
}

/** Background dimensions: 1.5x the render size so Ken Burns zooms stay sharp. */
export function backgroundSize(spec: VideoSpec): { width: number; height: number } {
  const aspect = spec.aspect in ASPECTS ? spec.aspect : "9:16"
  const base = ASPECTS[aspect]
  return {
    width: even(base.width * 1.5),
    height: even(base.height * 1.5),
  }
}

async function fileIsUsable(file: string, minBytes = 1500): Promise<boolean> {
  try {
    const info = await stat(file)
    return info.isFile() && info.size >= minBytes
  } catch {
    return false
  }
}

async function withAbort<T>(timeoutMs: number, task: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await task(controller.signal)
  } catch (error) {
    if (controller.signal.aborted) throw new Error(`network request timed out after ${timeoutMs}ms`)
    throw error
  } finally {
    clearTimeout(timer)
  }
}

async function findOpenverseImage(query: string): Promise<string | null> {
  const url = new URL(OPENVERSE_ENDPOINT)
  url.searchParams.set("q", query)
  url.searchParams.set("page_size", "1")
  url.searchParams.set("license_type", "commercial")
  url.searchParams.set("extension", "jpg")
  url.searchParams.set("mature", "false")

  const payload = await withAbort(OPENVERSE_TIMEOUT_MS, async (signal) => {
    const response = await fetch(url.toString(), {
      signal,
      redirect: "follow",
      headers: {
        accept: "application/json",
        "user-agent": "chat-to-video/1.0 (deterministic renderer)",
      },
    })
    if (!response.ok) throw new Error(`Openverse HTTP ${response.status}`)
    return (await response.json()) as OpenverseResponse
  })

  const candidate = payload.results?.find((item) => typeof item.url === "string" && item.url.length > 0)
  if (!candidate?.url) return null

  try {
    const imageUrl = new URL(candidate.url)
    if (imageUrl.protocol !== "http:" && imageUrl.protocol !== "https:") return null
    return imageUrl.toString()
  } catch {
    return null
  }
}

async function downloadImage(url: string): Promise<Buffer> {
  return withAbort(DOWNLOAD_TIMEOUT_MS, async (signal) => {
    const response = await fetch(url, {
      signal,
      redirect: "follow",
      headers: {
        accept: "image/*",
        "user-agent": "chat-to-video/1.0 (deterministic renderer)",
      },
    })
    if (!response.ok) throw new Error(`image download HTTP ${response.status}`)

    const contentType = response.headers.get("content-type") ?? ""
    if (contentType && /^(text\/|application\/(json|xml))/i.test(contentType)) {
      throw new Error(`unexpected content-type "${contentType}"`)
    }
    const declaredLength = Number(response.headers.get("content-length") ?? 0)
    if (Number.isFinite(declaredLength) && declaredLength > MAX_IMAGE_BYTES) {
      throw new Error("image is too large")
    }

    const buffer = Buffer.from(await response.arrayBuffer())
    if (buffer.length < 2048) throw new Error("image payload is empty")
    if (buffer.length > MAX_IMAGE_BYTES) throw new Error("image is too large")
    return buffer
  })
}

async function convertImage(rawPath: string, destPath: string, width: number, height: number): Promise<void> {
  const temporary = `${destPath}.tmp.jpg`
  try {
    await runFfmpeg([
      "-y",
      "-i",
      rawPath,
      "-frames:v",
      "1",
      "-vf",
      `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},eq=brightness=-0.04:saturation=1.04`,
      "-q:v",
      "2",
      "-update",
      "1",
      temporary,
    ])
    await rename(temporary, destPath)
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => undefined)
    throw error
  }
}

/** Deterministic palette gradient used whenever stock imagery is unavailable. */
async function generateGradient(
  destPath: string,
  width: number,
  height: number,
  palette: string[],
  seed: number,
): Promise<void> {
  const colors = [...palette]
  while (colors.length < 3) colors.push(colors[colors.length - 1] ?? "#0B1020")

  // Vary the gradient direction deterministically from the scene hash.
  const directions = [
    { x0: 0, y0: 0, x1: width, y1: height },
    { x0: width, y0: 0, x1: 0, y1: height },
    { x0: 0, y0: height, x1: width, y1: 0 },
    { x0: width / 2, y0: 0, x1: width / 2, y1: height },
  ]
  const direction = directions[Math.abs(seed) % directions.length]
  const numericSeed = Math.abs(seed) % 100_000

  const temporary = `${destPath}.tmp.png`
  const gradient =
    `gradients=s=${width}x${height}:c0=${ffColor(colors[0])}:c1=${ffColor(colors[1])}:` +
    `c2=${ffColor(colors[2])}:nb_colors=3:x0=${direction.x0}:y0=${direction.y0}:` +
    `x1=${direction.x1}:y1=${direction.y1}:d=1:r=1:seed=${numericSeed}`

  try {
    await runFfmpeg([
      "-y",
      "-f",
      "lavfi",
      "-i",
      gradient,
      "-frames:v",
      "1",
      "-vf",
      `noise=alls=3:allf=u:all_seed=${numericSeed},vignette=PI/4,eq=brightness=-0.05:saturation=1.08`,
      "-pix_fmt",
      "rgb24",
      "-update",
      "1",
      temporary,
    ])
    await rename(temporary, destPath)
    return
  } catch (error) {
    // Very old FFmpeg builds may lack `gradients`; a flat colour still works.
    await rm(temporary, { force: true }).catch(() => undefined)
    console.warn(`[render] gradient filter unavailable, using flat background: ${errorMessage(error)}`)
  }

  const flatTemporary = `${destPath}.flat.png`
  try {
    await runFfmpeg([
      "-y",
      "-f",
      "lavfi",
      "-i",
      `color=c=${ffColor(colors[0])}:s=${width}x${height}:r=1`,
      "-frames:v",
      "1",
      "-vf",
      `noise=alls=4:allf=u:all_seed=${numericSeed},vignette=PI/3`,
      "-pix_fmt",
      "rgb24",
      "-update",
      "1",
      flatTemporary,
    ])
    await rename(flatTemporary, destPath)
  } catch (error) {
    await rm(flatTemporary, { force: true }).catch(() => undefined)
    throw error
  }
}

async function fetchStockBackground(
  scene: Scene,
  spec: VideoSpec,
  destPath: string,
  width: number,
  height: number,
): Promise<boolean> {
  if (Date.now() < openversePausedUntil) return false
  const query = searchQuery(scene, spec)
  const imageUrl = await findOpenverseImage(query)
  if (!imageUrl) return false

  const buffer = await downloadImage(imageUrl)
  const rawPath = `${destPath}.source`
  await writeFile(rawPath, buffer)

  try {
    const probe = await probeMedia(rawPath)
    const video = (probe.streams ?? []).find((stream) => stream.codec_type === "video")
    const streamWidth = Number(video?.width ?? 0)
    const streamHeight = Number(video?.height ?? 0)
    if (!video || streamWidth < 480 || streamHeight < 480) {
      throw new Error(`unsuitable image (${streamWidth || "?"}x${streamHeight || "?"})`)
    }
    await convertImage(rawPath, destPath, width, height)
    if (!(await fileIsUsable(destPath))) throw new Error("converted image is empty")
    return true
  } finally {
    await rm(rawPath, { force: true }).catch(() => undefined)
  }
}

/**
 * Resolve a scene background. Never throws because of the network: Openverse is
 * best-effort, and a deterministic gradient is always available as a fallback.
 */
export async function ensureBackground(scene: Scene, spec: VideoSpec, destDir: string): Promise<string> {
  const { width, height } = backgroundSize(spec)
  const key = sceneKey(scene, spec)
  const stockPath = path.join(destDir, `bg-${key}.jpg`)
  const generatedPath = path.join(destDir, `bg-${key}.png`)

  if (await fileIsUsable(stockPath)) return stockPath
  if (await fileIsUsable(generatedPath)) return generatedPath
  await ensureDir(destDir)

  try {
    const usedStock = await fetchStockBackground(scene, spec, stockPath, width, height)
    if (usedStock) return stockPath
  } catch (error) {
    const message = errorMessage(error)
    if (/timed out|fetch failed|ENOTFOUND|EAI_AGAIN|ECONNREFUSED|network/i.test(message)) {
      openversePausedUntil = Date.now() + OPENVERSE_COOLDOWN_MS
    }
    console.warn(
      `[render] stock image unavailable for "${searchQuery(scene, spec)}", using generated background: ${message}`,
    )
  }

  const palette = paletteColors(spec.palette)
  const seed = Number.parseInt(key.slice(0, 8), 16)
  await generateGradient(generatedPath, width, height, palette, seed)
  if (!(await fileIsUsable(generatedPath, 500))) {
    throw new Error(`Could not generate a background image at ${generatedPath}`)
  }
  return generatedPath
}

/**
 * Pre-render a bottom-up dark scrim (transparent at `start`, dark at the
 * bottom) so captions stay readable over any photo without hard box edges.
 */
export async function ensureScrim(
  destDir: string,
  width: number,
  height: number,
  options: { strength?: number; start?: number; ffmpegPath?: string } = {},
): Promise<string> {
  const strength = Math.min(0.95, Math.max(0.1, options.strength ?? 0.74))
  const start = Math.min(0.9, Math.max(0.05, options.start ?? 0.42))
  const name = `scrim-${width}x${height}-${Math.round(strength * 100)}-${Math.round(start * 100)}.png`
  const destPath = path.join(destDir, name)
  if (await fileIsUsable(destPath, 200)) return destPath

  await ensureDir(destDir)
  const startPixel = Math.round(height * start)
  const span = Math.max(1, height - startPixel)
  const alpha = `255*clip((Y-${startPixel})/${span},0,1)*${strength.toFixed(3)}`
  const temporary = `${destPath}.tmp.png`

  try {
    await runFfmpeg(
      [
        "-y",
        "-f",
        "lavfi",
        "-i",
        `color=c=black@0.0:s=${width}x${height}:r=1`,
        "-frames:v",
        "1",
        "-vf",
        `format=rgba,geq=r=0:g=0:b=0:a='${alpha}'`,
        "-update",
        "1",
        temporary,
      ],
      { ffmpegPath: options.ffmpegPath },
    )
    await rename(temporary, destPath)
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => undefined)
    throw new Error(`Could not create caption scrim: ${errorMessage(error)}`)
  }
  return destPath
}
