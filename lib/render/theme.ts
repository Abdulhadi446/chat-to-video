/**
 * Small, dependency-free helpers shared by the deterministic renderer.
 *
 * Everything here is server-side only (no `server-only` import so the demo
 * script can execute the modules directly after compilation).
 */

import { execFileSync, spawn } from "node:child_process"
import { existsSync } from "node:fs"
import { mkdir } from "node:fs/promises"
import path from "node:path"

export const DEFAULT_PALETTE = ["#0B1020", "#4C1D95", "#8B5CF6", "#F8FAFC"]

const HEX_RE = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i

export interface CommandOptions {
  cwd?: string
  timeoutMs?: number
  env?: NodeJS.ProcessEnv
}

export interface CommandResult {
  stdout: string
  stderr: string
}

export interface ProbeStream {
  codec_type?: string
  codec_name?: string
  width?: number
  height?: number
  pix_fmt?: string
  duration?: string
}

export interface ProbeResult {
  streams?: ProbeStream[]
  format?: { duration?: string; size?: string; format_name?: string }
}

/** Trim long command output so error messages stay readable in the UI. */
export function tail(text: string, max = 1800): string {
  const trimmed = text.trim()
  if (trimmed.length <= max) return trimmed
  return `...${trimmed.slice(-max)}`
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/** FFmpeg's jpg/png encoders need even dimensions for yuv420p video. */
export function even(value: number): number {
  return Math.max(2, Math.round(value / 2) * 2)
}

export async function ensureDir(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true })
}

export function resolveFfmpeg(explicit?: string): string {
  return explicit?.trim() || process.env.FFMPEG_PATH?.trim() || "ffmpeg"
}

export function resolveFfprobe(ffmpegPath?: string): string {
  const explicit = process.env.FFPROBE_PATH?.trim()
  if (explicit) return explicit
  const ffmpeg = resolveFfmpeg(ffmpegPath)
  if (path.basename(ffmpeg) !== "ffmpeg") {
    const sibling = path.join(path.dirname(ffmpeg), "ffprobe")
    if (existsSync(sibling)) return sibling
  }
  return "ffprobe"
}

/**
 * Spawn a process and reject with the stderr tail when it exits non-zero.
 * Used for ffmpeg/ffprobe/fc-match so failures surface as readable errors.
 */
export function runCommand(cmd: string, args: string[], options: CommandOptions = {}): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    let settled = false
    let stdout = ""
    let stderr = ""

    const child = spawn(cmd, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ["ignore", "pipe", "pipe"],
    })

    const timeoutMs = options.timeoutMs ?? 180_000
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      child.kill("SIGKILL")
      reject(new Error(`${cmd} timed out after ${Math.round(timeoutMs / 1000)}s`))
    }, timeoutMs)

    const settle = (fn: () => void) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      fn()
    }

    child.stdout?.setEncoding("utf8")
    child.stderr?.setEncoding("utf8")
    child.stdout?.on("data", (chunk: string) => {
      // Keep a bounded buffer: ffmpeg progress output can be very long.
      stdout = `${stdout}${chunk}`.slice(-200_000)
    })
    child.stderr?.on("data", (chunk: string) => {
      stderr = `${stderr}${chunk}`.slice(-20_000)
    })
    child.on("error", (error) => {
      settle(() => {
        reject(new Error(`Failed to run "${cmd}": ${error.message}`))
      })
    })
    child.on("close", (code) => {
      settle(() => {
        if (code === 0) {
          resolve({ stdout, stderr })
          return
        }
        const detail = tail(stderr)
        reject(new Error(`${cmd} exited with code ${code}${detail ? `: ${detail}` : ""}`))
      })
    })
  })
}

export async function runFfmpeg(args: string[], options: CommandOptions & { ffmpegPath?: string } = {}): Promise<void> {
  await runCommand(resolveFfmpeg(options.ffmpegPath), ["-hide_banner", "-loglevel", "error", ...args], {
    cwd: options.cwd,
    timeoutMs: options.timeoutMs ?? 300_000,
    env: options.env,
  })
}

export async function probeMedia(file: string, ffmpegPath?: string): Promise<ProbeResult> {
  const probe = resolveFfprobe(ffmpegPath)
  const { stdout } = await runCommand(
    probe,
    ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", file],
    { timeoutMs: 20_000 },
  )
  try {
    return JSON.parse(stdout) as ProbeResult
  } catch {
    throw new Error(`ffprobe returned invalid JSON for ${file}`)
  }
}

/** Strip markdown-ish noise the storyboard model sometimes emits. */
export function cleanText(value: unknown, fallback = ""): string {
  if (typeof value !== "string") return fallback
  const cleaned = value
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[*_~`>#]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
  return cleaned || fallback
}

/**
 * Wrap text into at most `maxLines` lines. Anything that does not fit gets an
 * ellipsis on the last line - captions are never allowed to overflow the frame.
 */
export function wrapText(text: string, maxChars: number, maxLines = 2): string {
  const clean = cleanText(text)
  if (!clean) return ""
  const width = Math.max(4, Math.floor(maxChars))
  const words = clean.split(" ").flatMap((word) => {
    if (word.length <= width) return [word]
    const chunks: string[] = []
    for (let index = 0; index < word.length; index += width) chunks.push(word.slice(index, index + width))
    return chunks
  })

  const lines: string[] = []
  let current = ""
  for (const word of words) {
    if (!current) {
      current = word
    } else if (current.length + 1 + word.length <= width) {
      current = `${current} ${word}`
    } else {
      lines.push(current)
      current = word
    }
  }
  if (current) lines.push(current)

  if (lines.length <= maxLines) return lines.join("\n")

  const kept = lines.slice(0, Math.max(1, maxLines - 1))
  const rest = lines.slice(Math.max(1, maxLines - 1)).join(" ")
  kept.push(truncateLine(rest, width))
  return kept.slice(0, maxLines).join("\n")
}

function truncateLine(text: string, width: number): string {
  if (text.length <= width) return text
  const rough = text.slice(0, Math.max(1, width - 1))
  const cut = rough.replace(/\s+\S*$/, "") || rough
  return `${cut.trimEnd()}…`
}

/** Conservative character budget for a pixel width at a given font size. */
export function charsPerLine(availablePx: number, fontSize: number, factor = 0.56): number {
  return Math.max(6, Math.floor(availablePx / Math.max(1, fontSize * factor)))
}

export function lineCount(text: string): number {
  if (!text) return 0
  return text.split("\n").length
}

export function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const match = hex.trim().match(HEX_RE)
  let value = match ? match[1] : "000000"
  if (value.length === 3) value = value.split("").map((part) => part + part).join("")
  return {
    r: Number.parseInt(value.slice(0, 2), 16),
    g: Number.parseInt(value.slice(2, 4), 16),
    b: Number.parseInt(value.slice(4, 6), 16),
  }
}

export function rgbToHex(r: number, g: number, b: number): string {
  const channel = (value: number) =>
    Math.round(clamp(value, 0, 255)).toString(16).padStart(2, "0").toUpperCase()
  return `#${channel(r)}${channel(g)}${channel(b)}`
}

export function luminance(hex: string): number {
  const { r, g, b } = hexToRgb(hex)
  const linear = (channel: number) => {
    const value = channel / 255
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b)
}

export function mixHex(first: string, second: string, amount: number): string {
  const a = hexToRgb(first)
  const b = hexToRgb(second)
  const t = clamp(amount, 0, 1)
  return rgbToHex(a.r + (b.r - a.r) * t, a.g + (b.g - a.g) * t, a.b + (b.b - a.b) * t)
}

/** FFmpeg colour literal (0xRRGGBB). */
export function ffColor(hex: string): string {
  const { r, g, b } = hexToRgb(hex)
  return `0x${rgbToHex(r, g, b).slice(1)}`
}

/** Validated palette (2-5 colours) with a dark/light-safe default. */
export function paletteColors(input?: string[]): string[] {
  const valid: string[] = []
  if (Array.isArray(input)) {
    for (const raw of input) {
      if (typeof raw !== "string") continue
      const match = raw.trim().match(HEX_RE)
      if (match) {
        const value = match[1].length === 3 ? match[1].split("").map((part) => part + part).join("") : match[1]
        const hex = `#${value.toUpperCase()}`
        if (!valid.includes(hex)) valid.push(hex)
      }
    }
  }

  const seed = valid.length >= 2 ? valid : [...DEFAULT_PALETTE, ...valid]
  const out: string[] = []
  for (const hex of seed) {
    if (!out.includes(hex)) out.push(hex)
  }
  for (const hex of DEFAULT_PALETTE) {
    if (out.length < 3 && !out.includes(hex)) out.push(hex)
  }
  return out.slice(0, 5)
}

export function accentColor(colors: string[]): string {
  let best = colors[0] ?? "#8B5CF6"
  let bestLuminance = -1
  for (const color of colors) {
    const value = luminance(color)
    if (value > bestLuminance && value < 0.88) {
      best = color
      bestLuminance = value
    }
  }
  if (bestLuminance >= 0.18) return best
  return mixHex(best, "#FFFFFF", 0.45)
}

const fontCache = new Map<string, string>()

/**
 * Resolve a real system font file. `fc-match` is preferred (per contract),
 * with common DejaVu/Liberation/Noto paths as a fallback.
 */
export function fontPath(bold = false): string {
  const cacheKey = bold ? "bold" : "regular"
  const cached = fontCache.get(cacheKey)
  if (cached) return cached

  const query = bold ? "DejaVu Sans:bold" : "DejaVu Sans"
  let found = ""
  try {
    found = execFileSync("fc-match", ["-f", "%{file}", query], {
      encoding: "utf8",
      timeout: 4_000,
      stdio: ["ignore", "pipe", "ignore"],
    }).trim()
  } catch {
    // fc-match is optional; the candidate list below usually covers Linux/macOS.
  }

  const candidates = bold
    ? [
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
        "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
        "/usr/share/fonts/liberation/LiberationSans-Bold.ttf",
        "/usr/share/fonts/noto/NotoSans-Bold.ttf",
        "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
      ]
    : [
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
        "/usr/share/fonts/liberation/LiberationSans-Regular.ttf",
        "/usr/share/fonts/noto/NotoSans-Regular.ttf",
        "/System/Library/Fonts/Supplemental/Arial.ttf",
      ]

  if (!found || !existsSync(found)) {
    found = candidates.find((candidate) => existsSync(candidate)) ?? ""
  }
  if (!found) {
    throw new Error(
      "No usable system font found. Install DejaVu Sans (e.g. `apt-get install fonts-dejavu-core`) so the renderer can draw titles and captions.",
    )
  }
  fontCache.set(cacheKey, found)
  return found
}

/** Escape a filesystem path for use inside an FFmpeg filtergraph option. */
export function filterPath(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/:/g, "\\:")
    .replace(/'/g, "\\'")
    .replace(/\[/g, "\\[")
    .replace(/\]/g, "\\]")
    .replace(/,/g, "\\,")
}
