import type { Scene, Transition, VideoSpec } from "../types"
import type { Intent } from "./intent"
import { chatCompletion, extractJson } from "./openrouter"

const MIN_SCENES = 3
const MAX_SCENES = 6
const MAX_TITLE = 80
const MAX_CAPTION = 90
const MAX_TEXT = 72
const MAX_VISUAL = 220
const MAX_VOICE_SCRIPT = 1200
const TRANSITIONS: Transition[] = ["fade", "slide", "zoom"]
const FALLBACK_PALETTE = ["#080b16", "#7c3aed", "#e9d5ff", "#22d3ee"]

interface RawScene {
  text?: unknown
  caption?: unknown
  visual?: unknown
  assetQuery?: unknown
  duration?: unknown
  transition?: unknown
}

interface RawSpec {
  title?: unknown
  style?: unknown
  palette?: unknown
  scenes?: unknown
  voiceScript?: unknown
}

function clampString(value: unknown, max: number): string | undefined {
  if (typeof value !== "string") return undefined
  const trimmed = value.replace(/\s+/g, " ").trim()
  if (!trimmed) return undefined
  if (trimmed.length <= max) return trimmed
  return `${trimmed.slice(0, max - 1).trimEnd()}…`
}

function numberFrom(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value === "string") {
    const parsed = Number.parseFloat(value.replace(/[^\d.]/g, ""))
    if (Number.isFinite(parsed)) return parsed
  }
  return undefined
}

function allocateDurations(weights: number[], total: number): number[] {
  const count = weights.length
  if (!count) return []
  const target = Math.max(Math.round(total), count)
  const safeWeights = weights.map((w) => (Number.isFinite(w) && w > 0 ? w : 1))
  const weightSum = safeWeights.reduce((a, b) => a + b, 0)
  const raw = safeWeights.map((w) => (w / weightSum) * target)
  const out = raw.map((v) => Math.max(1, Math.floor(v)))
  let diff = target - out.reduce((a, b) => a + b, 0)

  if (diff > 0) {
    const order = raw
      .map((v, i) => ({ i, frac: v - Math.floor(v) }))
      .sort((a, b) => b.frac - a.frac)
    let k = 0
    while (diff > 0) {
      out[order[k % count].i] += 1
      diff -= 1
      k += 1
    }
  } else if (diff < 0) {
    while (diff < 0) {
      const idx = out
        .map((v, i) => ({ v, i }))
        .filter((x) => x.v > 1)
        .sort((a, b) => b.v - a.v)[0]?.i
      if (idx === undefined) break
      out[idx] -= 1
      diff += 1
    }
  }

  return out
}

function normaliseTransition(value: unknown, index: number): Transition {
  if (typeof value === "string") {
    const lower = value.toLowerCase() as Transition
    if (TRANSITIONS.includes(lower)) return lower
  }
  return TRANSITIONS[index % TRANSITIONS.length]
}

function parsePalette(value: unknown): string[] {
  if (!Array.isArray(value)) return [...FALLBACK_PALETTE]
  const seen = new Set<string>()
  const palette: string[] = []
  for (const entry of value) {
    if (typeof entry !== "string") continue
    const color = entry.trim()
    if (!/^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(color)) continue
    const key = color.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    palette.push(color)
    if (palette.length >= 5) break
  }
  return palette.length >= 2 ? palette : [...FALLBACK_PALETTE]
}

function defaultVisual(topic: string, intent: Intent, index: number): string {
  const ideas = [
    `Bold opening title "${topic}" over a slowly drifting gradient, subtle grain.`,
    `Close-up product/idea imagery for "${topic}" with soft directional light and gentle push-in.`,
    `Supporting detail shot with layered shapes and shallow depth of field, palette from the style.`,
    `Dynamic mid-section: abstract shapes sliding into place behind the caption.`,
    `Closing composition that resolves the palette and holds the final line cleanly.`,
    `End card with breathing room, gentle vignette, and a restrained fade out.`,
  ]
  const base = ideas[index % ideas.length]
  return `${base} ${intent.style ? `Style: ${intent.style}.` : ""}`.trim().slice(0, MAX_VISUAL)
}

function defaultSceneText(intent: Intent, index: number): string {
  const topic = intent.topic
  const beats = [
    topic,
    intent.kind === "image" ? "Designed still" : "Scene by scene",
    intent.kind === "image" ? "Built in chat" : "Made in chat",
    "Details that land",
    "One clear story",
    "Made with Chat to Video",
  ]
  return beats[index % beats.length]
}

function padScenes(rawScenes: RawScene[], intent: Intent): RawScene[] {
  const scenes = rawScenes.slice(0, MAX_SCENES)
  while (scenes.length < MIN_SCENES) {
    const index = scenes.length
    scenes.push({
      text: defaultSceneText(intent, index),
      caption: defaultSceneText(intent, index),
      visual: defaultVisual(intent.topic, intent, index),
      duration: 1,
      transition: TRANSITIONS[index % TRANSITIONS.length],
    })
  }
  return scenes
}

function normaliseScenes(rawScenes: RawScene[], intent: Intent): Scene[] {
  const scenes = padScenes(rawScenes, intent).map((raw, index) => {
    const rawText = clampString(raw.text, MAX_TEXT)
    const rawCaption = clampString(raw.caption, MAX_CAPTION)
    const text = rawText ?? rawCaption ?? defaultSceneText(intent, index)
    const caption = rawCaption ?? text
    const visual = clampString(raw.visual, MAX_VISUAL) ?? defaultVisual(intent.topic, intent, index)
    const assetQuery = clampString(raw.assetQuery, 60)
    const rawDuration = numberFrom(raw.duration)
    return {
      text,
      caption,
      visual,
      ...(assetQuery ? { assetQuery } : {}),
      duration: rawDuration && rawDuration > 0 ? rawDuration : 1,
      transition: normaliseTransition(raw.transition, index),
    } satisfies Scene
  })

  const durations = allocateDurations(
    scenes.map((s) => s.duration),
    intent.duration,
  )
  return scenes.map((scene, i) => ({ ...scene, duration: durations[i] }))
}

function buildVoiceScript(rawVoiceScript: unknown, scenes: Scene[], intent: Intent): string | undefined {
  if (intent.voice !== "narrator") return undefined
  const explicit = clampString(rawVoiceScript, MAX_VOICE_SCRIPT)
  if (explicit) return explicit
  const joined = scenes
    .map((s) => (s.caption ?? s.text).replace(/[.!?]+$/, "").trim())
    .filter(Boolean)
    .join(". ")
  return `${joined}.`.slice(0, MAX_VOICE_SCRIPT)
}

function normaliseSpec(raw: RawSpec, intent: Intent): VideoSpec {
  const scenes = normaliseScenes(Array.isArray(raw.scenes) ? (raw.scenes as RawScene[]) : [], intent)
  return {
    title: clampString(raw.title, MAX_TITLE) ?? intent.topic.slice(0, MAX_TITLE),
    kind: intent.kind,
    duration: intent.duration,
    aspect: intent.aspect,
    voice: intent.voice,
    style: clampString(raw.style, 120) ?? intent.style ?? "clean editorial design, soft gradients, bold typography",
    palette: parsePalette(raw.palette),
    scenes,
    voiceScript: buildVoiceScript(raw.voiceScript, scenes, intent),
  }
}

/**
 * Safe, deterministic spec used when the model is unavailable or malformed.
 * Always 3 scenes whose durations sum exactly to intent.duration.
 */
export function buildFallbackSpec(intent: Intent): VideoSpec {
  const topic = (intent.topic || "A short cinematic story").slice(0, MAX_TITLE)
  const durations = allocateDurations([1, 1, 1], intent.duration)
  const beats = [
    {
      text: topic,
      caption: topic,
      visual: `Opening title card for "${topic}" over a deep gradient with slow drifting light and subtle grain.`,
    },
    {
      text: intent.kind === "image" ? "Designed in chat" : "Scene by scene",
      caption: intent.kind === "image" ? "One designed still" : "Built scene by scene",
      visual: `Detail composition with layered geometric shapes and soft directional light. ${
        intent.style ? `Style: ${intent.style}.` : ""
      }`,
    },
    {
      text: "Made with Chat to Video",
      caption: "Made with Chat to Video",
      visual: "Clean end card on the darkest palette color, centered mark, gentle fade out.",
    },
  ]

  const scenes: Scene[] = beats.map((beat, index) => ({
    text: beat.text,
    caption: beat.caption,
    visual: beat.visual.slice(0, MAX_VISUAL),
    duration: durations[index],
    transition: TRANSITIONS[index % TRANSITIONS.length],
  }))

  return {
    title: topic,
    kind: intent.kind,
    duration: intent.duration,
    aspect: intent.aspect,
    voice: intent.voice,
    style: intent.style ?? "clean editorial design, soft gradients, bold typography",
    palette: [...FALLBACK_PALETTE],
    scenes,
    voiceScript: buildVoiceScript(undefined, scenes, intent),
  }
}

function buildPrompt(intent: Intent): string {
  const sceneHint = intent.duration <= 10 ? "3" : intent.duration <= 30 ? "4-5" : "5-6"
  return `Create a production-ready storyboard for this ${intent.kind}.

Brief:
- topic: ${intent.topic}
- kind: ${intent.kind}
- total duration: ${intent.duration} seconds
- aspect: ${intent.aspect}
- voice: ${intent.voice}
- style: ${intent.style ?? "clean editorial, bold typography, cinematic color"}

Return STRICT JSON only (no markdown, no prose):
{
  "title": "short title",
  "style": "art direction summary",
  "palette": ["#0b0b12", "#7c3aed", "#f5f3ff"],
  "scenes": [
    {
      "text": "ON-SCREEN text, <= 60 chars",
      "caption": "caption line, <= 2 short lines / 90 chars",
      "visual": "concrete visual direction for an FFmpeg renderer: background, subject, motion, lighting",
      "assetQuery": "1-3 English keywords for a stock photo search (optional)",
      "duration": number,
      "transition": "fade" | "slide" | "zoom"
    }
  ],
  "voiceScript": "natural narration to read aloud, only when voice is narrator; empty string otherwise"
}

Hard constraints:
- Use ${sceneHint} scenes (minimum 3, maximum 6).
- Scene "duration" values are seconds and MUST sum EXACTLY to ${intent.duration}.
- Every scene > 0 seconds. Captions must fit two short lines.
- Visuals must be concrete and renderable without extra assets; a stock query is a bonus, not a requirement.
- Palette must be 3-5 hex colors that fit the style.
- Do not invent facts, people, or brand claims.
- Do not include any text outside the JSON object.`
}

/**
 * Generate a validated VideoSpec. Never throws: on any failure returns a safe
 * 3-scene spec derived from the intent topic.
 */
export async function createStoryboard(intent: Intent): Promise<VideoSpec> {
  try {
    const rawText = await chatCompletion({
      messages: [
        {
          role: "system",
          content:
            "You are a senior video art director. You output strict, valid JSON only. No markdown fences, no commentary.",
        },
        { role: "user", content: buildPrompt(intent) },
      ],
      temperature: 0.7,
      maxTokens: 1800,
    })

    const raw = extractJson<RawSpec>(rawText)
    if (!raw || typeof raw !== "object" || !Array.isArray(raw.scenes) || raw.scenes.length === 0) {
      console.warn("[storyboard] invalid JSON shape, using fallback spec:", rawText.slice(0, 240))
      return buildFallbackSpec(intent)
    }

    return normaliseSpec(raw, intent)
  } catch (err) {
    console.warn("[storyboard] generation failed, using fallback spec:", (err as Error)?.message)
    return buildFallbackSpec(intent)
  }
}
