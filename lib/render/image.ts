/**
 * Single-frame poster renderer.
 *
 * Reuses the video renderer's palette, background resolution and caption font
 * logic to produce one designed PNG (`final.png`) from the same VideoSpec.
 */

import { writeFile } from "node:fs/promises"
import path from "node:path"

import type { Aspect, Scene, VideoSpec } from "../types"
import { ensureBackground, ensureScrim } from "./assets"
import {
  accentColor,
  charsPerLine,
  clamp,
  cleanText,
  ensureDir,
  errorMessage,
  ffColor,
  filterPath,
  fontPath,
  lineCount,
  paletteColors,
  runFfmpeg,
  wrapText,
} from "./theme"

export interface RenderImageOptions {
  ffmpegPath?: string
}

export interface RenderImageResult {
  filePath: string
}

const IMAGE_SIZES: Record<Aspect, { width: number; height: number }> = {
  "9:16": { width: 1080, height: 1920 },
  "1:1": { width: 1080, height: 1080 },
  "16:9": { width: 1920, height: 1080 },
}

function imageSize(spec: VideoSpec): { width: number; height: number; aspect: Aspect } {
  const aspect: Aspect = spec.aspect in IMAGE_SIZES ? spec.aspect : "9:16"
  return { ...IMAGE_SIZES[aspect], aspect }
}

function drawtext(options: {
  fontFile: string
  textFile: string
  fontSize: number
  fontColor: string
  x: string
  y: string
  lineSpacing?: number
  shadow?: boolean
  borderWidth?: number
  borderColor?: string
}): string {
  const parts = [
    `fontfile='${filterPath(options.fontFile)}'`,
    `textfile='${options.textFile}'`,
    "expansion=none",
    `fontcolor=${options.fontColor}`,
    `fontsize=${options.fontSize}`,
    `line_spacing=${options.lineSpacing ?? Math.round(options.fontSize * 0.3)}`,
    `x=${options.x}`,
    `y=${options.y}`,
  ]
  if (options.borderWidth) {
    parts.push(`borderw=${options.borderWidth}`, `bordercolor=${options.borderColor ?? "0x000000@0.55"}`)
  }
  if (options.shadow) {
    parts.push("shadowcolor=0x000000@0.7", "shadowx=0", "shadowy=3")
  }
  return `drawtext=${parts.join(":")}`
}

/**
 * Render a polished still (`outDir/final.png`) at 1080x1920, 1080x1080 or
 * 1920x1080 depending on the spec aspect.
 */
export async function renderImage(
  spec: VideoSpec,
  outDir: string,
  options: RenderImageOptions = {},
): Promise<RenderImageResult> {
  if (!spec || typeof spec !== "object") {
    throw new Error("renderImage: a VideoSpec is required")
  }

  const { width, height, aspect } = imageSize(spec)
  const minSide = Math.min(width, height)
  const palette = paletteColors(spec.palette)
  const accent = accentColor(palette)

  await ensureDir(outDir)
  const assetsDir = path.join(outDir, "assets")
  await ensureDir(assetsDir)

  const rawScenes = Array.isArray(spec.scenes) ? spec.scenes.filter(Boolean) : []
  const firstScene: Scene =
    rawScenes[0] ??
    ({
      text: cleanText(spec.title, "Untitled"),
      visual: cleanText(spec.style, "abstract gradient"),
      duration: Number(spec.duration) || 10,
      transition: "fade",
    } satisfies Scene)

  let background: string
  try {
    background = await ensureBackground(firstScene, spec, assetsDir)
  } catch (error) {
    throw new Error(`renderImage: could not prepare a background: ${errorMessage(error)}`)
  }

  const scrim = await ensureScrim(assetsDir, width, height, {
    strength: 0.84,
    start: 0.14,
    ffmpegPath: options.ffmpegPath,
  })

  const margin = Math.round(minSide * 0.085)
  const titleFont = Math.round(clamp(minSide * 0.072, 40, 112))
  const bodyFont = Math.round(clamp(minSide * 0.028, 20, 40))
  const labelFont = Math.round(clamp(minSide * 0.019, 14, 26))
  const titleLineHeight = Math.round(titleFont * 1.12)
  const bodyLineHeight = Math.round(bodyFont * 1.34)

  const titleSource = cleanText(spec.title) || cleanText(firstScene.caption) || cleanText(firstScene.text) || "Untitled"
  const titleChars = charsPerLine(width - margin * 2, titleFont, 0.6)
  const titleText = wrapText(titleSource, titleChars, 3)
  const titleY = Math.round(height * 0.18)
  const accentY = titleY - Math.round(titleFont * 0.85)
  const bodyY = titleY + lineCount(titleText) * titleLineHeight + Math.round(bodyFont * 1.8)

  const footerY = height - margin - Math.round(labelFont * 1.4)
  const footerLineY = footerY - Math.round(labelFont * 2.6)

  const textFilters: string[] = []
  const writeText = async (name: string, value: string) => {
    await writeFile(path.join(outDir, name), `${value}\n`, "utf8")
    return name
  }

  const titleFile = await writeText("poster-title.txt", titleText)
  const regularFont = fontPath(false)
  const boldFont = fontPath(true)

  textFilters.push(
    `drawbox=x=0:y=0:w=iw:h=ih:color=0x000000@0.18:t=fill`,
    `drawbox=x=${margin}:y=${accentY}:w=${Math.round(width * 0.085)}:h=${Math.max(4, Math.round(minSide * 0.006))}:color=${ffColor(accent)}:t=fill`,
    drawtext({
      fontFile: boldFont,
      textFile: titleFile,
      fontSize: titleFont,
      fontColor: "0xF8FAFC",
      x: `${margin}`,
      y: `${titleY}`,
      lineSpacing: Math.max(4, titleLineHeight - titleFont),
      shadow: true,
      borderWidth: Math.max(1, Math.round(titleFont * 0.025)),
      borderColor: "0x000000@0.45",
    }),
  )

  // Supporting lines: one per scene, numbered, wrapped to two lines each.
  const items: string[] = []
  for (const scene of rawScenes.slice(0, 3)) {
    const text = cleanText(scene.caption) || cleanText(scene.text)
    if (text && !items.some((item) => item.toLowerCase() === text.toLowerCase())) items.push(text)
  }

  const numberColumn = Math.round(bodyFont * 2.1)
  const itemChars = charsPerLine(width - margin * 2 - numberColumn, bodyFont)
  let cursorY = bodyY
  let itemIndex = 0
  for (const item of items) {
    const wrapped = wrapText(item, itemChars, 2)
    const itemHeight = lineCount(wrapped) * bodyLineHeight
    if (cursorY + itemHeight > footerLineY - Math.round(bodyFont * 0.8)) break

    const numberFile = await writeText(`poster-item-${itemIndex}-n.txt`, String(itemIndex + 1).padStart(2, "0"))
    const textFile = await writeText(`poster-item-${itemIndex}.txt`, wrapped)
    textFilters.push(
      drawtext({
        fontFile: boldFont,
        textFile: numberFile,
        fontSize: Math.round(bodyFont * 0.82),
        fontColor: ffColor(accent),
        x: `${margin}`,
        y: `${cursorY + 1}`,
      }),
      drawtext({
        fontFile: regularFont,
        textFile: textFile,
        fontSize: bodyFont,
        fontColor: "0xE2E8F0",
        x: `${margin + numberColumn}`,
        y: `${cursorY}`,
        lineSpacing: Math.max(3, bodyLineHeight - bodyFont),
        shadow: true,
      }),
    )
    cursorY += itemHeight + Math.round(bodyFont * 1.05)
    itemIndex += 1
  }

  const durationValue = Number(spec.duration)
  const durationLabel = Number.isFinite(durationValue) && durationValue > 0
    ? Math.min(60, Math.max(5, Math.round(durationValue)))
    : 10
  const metaFile = await writeText("poster-meta.txt", `${aspect}  |  ${durationLabel}s`)
  const brandFile = await writeText("poster-brand.txt", "chat-to-video")

  textFilters.push(
    `drawbox=x=${margin}:y=${footerLineY}:w=${width - margin * 2}:h=1:color=0xFFFFFF@0.18:t=fill`,
    drawtext({
      fontFile: boldFont,
      textFile: brandFile,
      fontSize: labelFont,
      fontColor: `${ffColor(accent)}@0.95`,
      x: `${margin}`,
      y: `${footerY}`,
    }),
    drawtext({
      fontFile: regularFont,
      textFile: metaFile,
      fontSize: labelFont,
      fontColor: "0xFFFFFF@0.6",
      x: `w-text_w-${margin}`,
      y: `${footerY}`,
    }),
  )

  const filterGraph =
    `[0:v]scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},` +
    `eq=brightness=-0.12:saturation=1.05[bg];` +
    `[bg][1:v]overlay=0:0,${textFilters.join(",")},format=rgb24[v]`

  const finalPath = path.join(outDir, "final.png")
  try {
    await runFfmpeg(
      [
        "-y",
        "-i",
        background,
        "-i",
        scrim,
        "-filter_complex",
        filterGraph,
        "-map",
        "[v]",
        "-frames:v",
        "1",
        "-update",
        "1",
        "-pix_fmt",
        "rgb24",
        finalPath,
      ],
      { cwd: outDir, ffmpegPath: options.ffmpegPath, timeoutMs: 120_000 },
    )
  } catch (error) {
    throw new Error(`renderImage: FFmpeg failed: ${errorMessage(error)}`)
  }

  return { filePath: finalPath }
}
