import type { Aspect, AssetKind, Message, VoiceMode } from "../types"
import { chatCompletion, extractJson } from "./openrouter"

export interface Intent {
  kind: AssetKind
  topic: string
  duration: 10 | 30 | 60
  aspect: Aspect
  voice: VoiceMode
  style?: string
  needsClarification?: string
}

const DEFAULT_INTENT: Intent = {
  kind: "video",
  topic: "A short cinematic story",
  duration: 10,
  aspect: "9:16",
  voice: "silent",
}

const ASPECTS: Aspect[] = ["9:16", "16:9", "1:1"]
const DURATIONS: Array<10 | 30 | 60> = [10, 30, 60]

const SYSTEM_PROMPT = `You are the intent parser for a chat-to-video studio. Turn the user's message (plus conversation history) into production settings.
Reply with ONLY a JSON object, no prose, no markdown:
{"kind":"video"|"image","topic":string,"duration":10|30|60,"aspect":"9:16"|"16:9"|"1:1","voice":"silent"|"narrator","style":string}

Rules:
- Defaults: kind "video", duration 10, aspect "9:16", voice "silent".
- "30 sec"/"30-second" -> 30; "1 min"/"a minute" -> 60.
- vertical/portrait/reel/tiktok/story -> "9:16"; landscape/wide/horizontal/youtube -> "16:9"; square/1:1 -> "1:1".
- voiceover/voice over/narrate/narration/spoken/with voice -> "narrator"; silent/no audio/no voice/music only -> "silent".
- image/picture/poster/logo/still/thumbnail/illustration -> kind "image" unless the user explicitly asks for a video.
- topic: a concise description (max ~20 words) of what should be shown, keeping subject, brand and mood. Do not include the words "make/create/generate".
- style: short art-direction hint (max ~12 words), e.g. "warm minimal product photography".
- If the message is a greeting, a general question, or clearly NOT a request to create a video or image, set "needsClarification" to one short helpful question (max 160 chars) instead of inventing a topic.
- If the message is a follow-up (e.g. "make it 30s", "change it to landscape"), read the history and update only those fields.
Return the JSON object only.`

interface RawIntent {
  kind?: unknown
  topic?: unknown
  duration?: unknown
  aspect?: unknown
  voice?: unknown
  style?: unknown
  needsClarification?: unknown
}

/** Explicit mentions in the latest message override model output. */
function matchText(text: string) {
  return {
    duration: parseDuration(text),
    aspect: parseAspect(text),
    voice: parseVoice(text),
    kind: parseKind(text),
  }
}

function parseDuration(text: string): 10 | 30 | 60 | undefined {
  if (
    /\b(?:one|1)[\s-]*(?:minute|min)\b/i.test(text) ||
    /\ba minute\b/i.test(text) ||
    /\b60[\s-]*(?:s|sec|secs|second|seconds)\b/i.test(text)
  ) {
    return 60
  }
  if (/\bhalf\s*(?:a\s*)?minute\b/i.test(text)) return 30
  const match = text.match(/\b(10|30|60)[\s-]*(?:s|sec|secs|second|seconds)\b/i)
  if (match) return Number(match[1]) as 10 | 30 | 60
  const bare = text.match(/\b(\d{1,3})\s*(?:second|seconds)\b/i)
  if (bare) return nearestDuration(Number(bare[1]))
  return undefined
}

function nearestDuration(value: number): 10 | 30 | 60 {
  if (!Number.isFinite(value) || value <= 0) return 10
  if (value <= 15) return 10
  if (value <= 40) return 30
  return 60
}

function parseAspect(text: string): Aspect | undefined {
  if (/\b9\s*[:/x]\s*16\b/i.test(text) || /\b(?:vertical|portrait|reel|tiktok|stories?|story)\b/i.test(text)) {
    return "9:16"
  }
  if (/\b16\s*[:/x]\s*9\b/i.test(text) || /\b(?:landscape|horizontal|youtube|widescreen|wide)\b/i.test(text)) {
    return "16:9"
  }
  if (/\b1\s*[:/x]\s*1\b/i.test(text) || /\b(?:square|instagram post|profile)\b/i.test(text)) {
    return "1:1"
  }
  return undefined
}

function parseVoice(text: string): VoiceMode | undefined {
  if (/\b(?:silent|muted|no (?:voice|audio|sound|narration)|without (?:voice|audio|sound)|music only)\b/i.test(text)) {
    return "silent"
  }
  if (/\b(?:voice[\s-]?over|voiceover|narrat(?:e|ion|or|ed)?|voiced|spoken|speak|voice)\b/i.test(text)) {
    return "narrator"
  }
  return undefined
}

function parseKind(text: string): AssetKind | undefined {
  const wantsVideo = /\b(?:video|mp4|clip|reel|animation|advert|commercial|trailer)\b/i.test(text)
  const wantsImage = /\b(?:image|picture|photo|png|poster|logo|still|thumbnail|illustration|graphic)\b/i.test(text)
  if (wantsVideo) return "video"
  if (wantsImage) return "image"
  return undefined
}

function historyTranscript(history: Message[]): string {
  const recent = history
    .filter((m) => m.role === "user" || m.role === "assistant")
    .slice(-8)
    .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content.slice(0, 500)}`)
  return recent.join("\n")
}

/**
 * Heuristic fallback (and sanity check) for whether the message asks for media.
 */
function looksLikeCreation(text: string): boolean {
  const t = text.trim().toLowerCase()
  if (!t) return false
  const creation =
    /\b(?:make|create|generate|render|produce|design|build|turn|animate|edit|film|shoot|show|visuali[sz]e)\b/.test(t) ||
    /\b(?:video|mp4|clip|reel|animation|image|picture|photo|png|poster|logo|still|thumbnail|illustration|graphic|advert|ad|commercial|trailer)\b/.test(t)
  if (creation) return true
  // Short follow-ups like "30 seconds, landscape please" after a creation request.
  const optionOnly = /^(?:[\s,./-]*(?:\d+\s*(?:s|sec|seconds?)|square|vertical|landscape|portrait|16:9|9:16|1:1|silent|voiceover|voice over|narrator)[\s,./-]*)+$/i.test(t)
  return optionOnly
}

function clarifyingQuestion(): string {
  return "What would you like me to create? For example: “a 10s vertical coffee ad with a calm voiceover” or “a square poster for a jazz night”."
}

/** Follow-ups change options on an existing request instead of introducing a topic. */
function isFollowUp(text: string): boolean {
  const t = text.trim().toLowerCase()
  if (!t) return false
  if (
    /^(?:(?:can|could|would)\s+you\s+)?(?:make|change|set|switch|turn|update|adjust)\s+(?:it|that|this)\b/.test(
      t,
    )
  ) {
    return true
  }
  return /^(?:[\s,./-]*(?:\d+\s*(?:s|sec|seconds?)|square|vertical|landscape|portrait|16:9|9:16|1:1|silent|voiceover|voice over|narrator|please|and)[\s,./-]*)+$/i.test(
    t,
  )
}

function historyTopic(history: Message[]): string | undefined {
  for (let i = history.length - 1; i >= 0; i--) {
    const message = history[i]
    if (message.role !== "user") continue
    if (isFollowUp(message.content)) continue
    const candidate = cleanTopic(message.content)
    if (candidate.length >= 8) return candidate
  }
  return undefined
}

interface IntentHints {
  kind?: AssetKind
  duration?: 10 | 30 | 60
  aspect?: Aspect
  voice?: VoiceMode
}

/** Inherit unchanged settings from the previous request on follow-ups. */
function historyHints(history: Message[]): IntentHints {
  const lastUser = [...history].reverse().find((message) => message.role === "user")
  if (!lastUser) return {}
  return {
    kind: parseKind(lastUser.content),
    duration: parseDuration(lastUser.content),
    aspect: parseAspect(lastUser.content),
    voice: parseVoice(lastUser.content),
  }
}

function cleanTopic(text: string): string {
  let topic = text
    .replace(/\n*\s*Settings:\s*[^\n]*/gi, " ")
    .replace(/\b(?:10|30|60)[\s-]*(?:s|sec|secs|second|seconds)\b/gi, " ")
    .replace(/\b(?:9\s*[:/x]\s*16|16\s*[:/x]\s*9|1\s*[:/x]\s*1)\b/gi, " ")
    .replace(
      /\b(?:vertical|portrait|landscape|horizontal|square|widescreen|silent|muted|voice[\s-]?over|voiceover|narrat(?:e|ion|or|ed)?|voiced|spoken)\b/gi,
      " ",
    )
    .replace(
      /\bwith\s+(?:a\s+|an\s+)?(?:calm|warm|cool|deep|soft|male|female|energetic|friendly|professional)\b/gi,
      " ",
    )
    .replace(/\bwith\s+(?:a|an)?\s*$/i, " ")
    .replace(/^[\s,.-]*(?:please\s+)?(?:can|could|would)\s+you\s+/i, "")
    .replace(/^[\s,.-]*(?:please\s+)?(?:make|create|generate|render|produce|design|build|animate|turn)\s+(?:me\s+)?(?:an?|the)?\s*/i, "")
    .replace(/^[\s,.-]*(?:i\s+(?:want|need|would like)\s+)?(?:an?|the)\s+/i, "")
    .replace(/\s+/g, " ")
    .replace(/\s+([,.;:!?])/g, "$1")
    .replace(/^[\s,.;:-]+|[\s,.;:-]+$/g, "")
    .trim()
  if (!topic) topic = text.trim()
  if (topic.length > 100) topic = `${topic.slice(0, 97).trimEnd()}...`
  return topic
}

function deriveTopic(text: string, history: Message[]): string {
  if (isFollowUp(text)) {
    const prior = historyTopic(history)
    if (prior) return prior
  }

  const current = cleanTopic(text)
  const optionOnly =
    current.length < 16 &&
    /^(?:\d+\s*(?:s|sec|seconds?)|square|vertical|landscape|silent|voiceover|it and please)$/i.test(current)
  if (!optionOnly && current) return current

  return historyTopic(history) ?? (current || DEFAULT_INTENT.topic)
}

function clampText(value: unknown, max: number): string | undefined {
  if (typeof value !== "string") return undefined
  const trimmed = value.replace(/\s+/g, " ").trim()
  if (!trimmed) return undefined
  return trimmed.length > max ? `${trimmed.slice(0, max - 1).trimEnd()}…` : trimmed
}

function normalizeDuration(value: unknown): 10 | 30 | 60 | undefined {
  const n = typeof value === "number" ? value : Number(String(value).replace(/[^\d.]/g, ""))
  if (!Number.isFinite(n) || n <= 0) return undefined
  if (DURATIONS.includes(n as 10 | 30 | 60)) return n as 10 | 30 | 60
  return nearestDuration(n)
}

function normalizeAspect(value: unknown): Aspect | undefined {
  if (typeof value !== "string") return undefined
  const cleaned = value.replace(/\s/g, "")
  const found = ASPECTS.find((a) => a === cleaned)
  if (found) return found
  if (/vertical|portrait|reel|story/i.test(value)) return "9:16"
  if (/landscape|horizontal|wide/i.test(value)) return "16:9"
  if (/square/i.test(value)) return "1:1"
  return undefined
}

function normalizeVoice(value: unknown): VoiceMode | undefined {
  if (typeof value !== "string") return undefined
  if (/narrat|voice|spoken/i.test(value)) return "narrator"
  if (/silent|none|mute|no/i.test(value)) return "silent"
  return undefined
}

function normalizeKind(value: unknown): AssetKind | undefined {
  if (value === "image" || value === "video") return value
  return undefined
}

function buildIntent(raw: RawIntent | null, text: string, history: Message[]): Intent {
  const explicit = matchText(text)
  const modelTopic = clampText(raw?.topic, 120)
  let topic = modelTopic ?? deriveTopic(text, history)
  const weakTopic =
    !modelTopic ||
    modelTopic.length < 10 ||
    /^(?:it|that|this|and|please)\b/i.test(modelTopic)
  const followUp = isFollowUp(text)
  if ((followUp || weakTopic) && history.length > 0) {
    topic = historyTopic(history) ?? topic
  }
  const hints = followUp ? historyHints(history) : {}

  const intent: Intent = {
    ...DEFAULT_INTENT,
    kind:
      explicit.kind ??
      normalizeKind(raw?.kind) ??
      hints.kind ??
      (looksLikeImageOnly(text) ? "image" : DEFAULT_INTENT.kind),
    topic,
    duration:
      explicit.duration ?? normalizeDuration(raw?.duration) ?? hints.duration ?? DEFAULT_INTENT.duration,
    aspect: explicit.aspect ?? normalizeAspect(raw?.aspect) ?? hints.aspect ?? DEFAULT_INTENT.aspect,
    voice: explicit.voice ?? normalizeVoice(raw?.voice) ?? hints.voice ?? DEFAULT_INTENT.voice,
    style: clampText(raw?.style, 100),
  }

  // Explicit words in the latest message always win over the model.
  const modelClarification = clampText(raw?.needsClarification, 200)
  if (modelClarification) {
    intent.needsClarification = modelClarification
  } else if (!looksLikeCreation(text)) {
    intent.needsClarification = clarifyingQuestion()
  }

  return intent
}

function looksLikeImageOnly(text: string): boolean {
  const image = /\b(?:image|picture|photo|png|poster|logo|still|thumbnail|illustration)\b/i.test(text)
  const video = /\b(?:video|mp4|clip|reel|animation|advert|commercial|trailer)\b/i.test(text)
  return image && !video
}

function fallbackIntent(text: string, history: Message[]): Intent {
  return buildIntent(null, text, history)
}

/**
 * Parse a user message into production intent. Never throws: any model failure
 * falls back to deterministic regex parsing + safe defaults.
 */
export async function parseIntent(text: string, history: Message[] = []): Promise<Intent> {
  const message = typeof text === "string" ? text.trim() : ""
  if (!message) {
    return { ...DEFAULT_INTENT, needsClarification: clarifyingQuestion() }
  }

  try {
    const transcript = historyTranscript(history)
    const userContent = transcript
      ? `Conversation so far:\n${transcript}\n\nNew user message:\n${message}`
      : `New user message:\n${message}`

    const raw = await chatCompletion({
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userContent },
      ],
      temperature: 0.1,
      maxTokens: 300,
    })

    const parsed = extractJson<RawIntent>(raw)
    if (!parsed || typeof parsed !== "object") return fallbackIntent(message, history)
    return buildIntent(parsed, message, history)
  } catch (err) {
    console.warn("[intent] OpenRouter parse failed, using regex fallback:", (err as Error)?.message)
    return fallbackIntent(message, history)
  }
}
