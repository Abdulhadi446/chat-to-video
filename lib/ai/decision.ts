import type { Intent } from "./intent"

export type ExecutionMode = "deterministic" | "agent"

export interface ModeDecision {
  mode: ExecutionMode
  reason: string
}

const SYSTEMONE_URL = "https://thetrillioniar.me/v1/systemone"
/** Contract default is 15s; deployments can raise it if the router is slow. */
const DECISION_TIMEOUT_MS = Math.max(
  1_000,
  Number(process.env.THETRILLIONIAR_TIMEOUT_MS) || 15_000,
)
const HARD_CONFIDENCE_THRESHOLD = 0.6

interface ComplexitySignals {
  promptWords: number
  scenesHint: number
  customAnimation: boolean
  manyAssets: boolean
  preciseSync: boolean
  customCode: boolean
}

function complexitySignals(intent: Intent, text: string): ComplexitySignals {
  const prompt = `${text} ${intent.topic} ${intent.style ?? ""}`.trim()
  const assetMentions = prompt.match(/\b(?:image|images|photo|photos|clip|clips|asset|assets|logo|b-?roll|footage)\b/gi)
  return {
    promptWords: prompt ? prompt.split(/\s+/).length : 0,
    scenesHint: intent.duration <= 10 ? 3 : intent.duration <= 30 ? 5 : 8,
    customAnimation:
      /\b(?:custom|bespoke|motion\s*design|animated|animation|kinetic|3d|3-d|parallax|morph|intro sequence)\b/i.test(prompt),
    manyAssets: (assetMentions?.length ?? 0) >= 3 || /\b(?:many|multiple|several|dozens)\b/i.test(prompt),
    preciseSync:
      /\b(?:sync|synchroni[sz]e|lip\s*sync|beat[\s-]?match|timed to|match the (?:music|beat|audio))\b/i.test(prompt),
    customCode:
      /\b(?:code|custom\s+html|canvas|webgl|three\.?js|hyperframes|compositing|composite|ffmpeg filter)\b/i.test(prompt),
  }
}

function summariseSignals(signals: ComplexitySignals): string {
  const flags = [
    signals.customAnimation ? "custom animation" : null,
    signals.manyAssets ? "many assets" : null,
    signals.preciseSync ? "precise sync" : null,
    signals.customCode ? "custom code" : null,
  ].filter(Boolean)
  return flags.length ? flags.join(", ") : "plain scenes/text, simple assets"
}

function readConfidence(source: unknown, fallback: unknown): number {
  const candidates = [source, fallback]
  for (const value of candidates) {
    if (typeof value === "number" && Number.isFinite(value)) {
      return value > 1 ? Math.min(value / 100, 1) : Math.max(value, 0)
    }
    if (typeof value === "string") {
      const parsed = Number(value.replace("%", "").trim())
      if (Number.isFinite(parsed)) return parsed > 1 ? Math.min(parsed / 100, 1) : Math.max(parsed, 0)
    }
  }
  return 0
}

function readChoice(value: unknown): string {
  if (typeof value === "string") return value.trim().toLowerCase()
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>
    const nested = record.choice ?? record.verdict ?? record.answer ?? record.value
    if (typeof nested === "string") return nested.trim().toLowerCase()
  }
  return ""
}

function readAbstention(payload: Record<string, unknown>, answers: Record<string, unknown>): boolean {
  const difficulty =
    answers.difficulty && typeof answers.difficulty === "object"
      ? (answers.difficulty as Record<string, unknown>)
      : null
  const candidates = [
    payload.is_abstention,
    payload.isAbstention,
    payload.abstained,
    payload.abstain,
    answers.is_abstention,
    answers.abstained,
    difficulty?.is_abstention,
    difficulty?.abstained,
  ]
  if (
    candidates.some(
      (v) => v === true || v === 1 || (typeof v === "string" && /^(true|1|yes)$/i.test(v)),
    )
  ) {
    return true
  }
  const choice = readChoice(answers.difficulty ?? payload.difficulty)
  return choice === "abstain" || choice === "abstained" || choice === "unsure" || choice === "unknown"
}

/**
 * Route a production between the deterministic pipeline and the opencode agent.
 * Trillionir is advisory only: any error, timeout, or abstention falls back to
 * the deterministic pipeline. Never throws.
 */
export async function decideMode(intent: Intent, text = ""): Promise<ModeDecision> {
  const signals = complexitySignals(intent, text)

  const apiKey = process.env.THETRILLIONIAR_API_KEY?.trim()
  if (!apiKey) {
    return {
      mode: "deterministic",
      reason: `Deterministic pipeline — decision API key not configured; ${summariseSignals(signals)}`,
    }
  }

  const state = [
    "Production request for a chat-to-video studio.",
    JSON.stringify(
      {
        kind: intent.kind,
        topic: intent.topic,
        duration: intent.duration,
        aspect: intent.aspect,
        voice: intent.voice,
        style: intent.style ?? null,
        prompt: text.slice(0, 600),
        signals,
      },
      null,
      2,
    ),
  ].join("\n")

  const body = {
    state,
    questions: {
      difficulty: {
        type: "choice",
        instructions:
          "Choose the production pipeline for this request. Pick easy when a plain deterministic renderer can do it; pick hard only when the request needs an autonomous coding agent.",
        criteria: {
          easy: "Plain scenes with text and captions, simple stock/generated visuals, no compositing, no custom animation or code.",
          hard: "Custom animation or motion design, many assets, precise audio/beat sync, compositing, or custom code/HTML/canvas.",
        },
      },
    },
  }

  try {
    const res = await fetch(SYSTEMONE_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(DECISION_TIMEOUT_MS),
    })

    if (!res.ok) {
      return {
        mode: "deterministic",
        reason: `Deterministic fallback — decision API returned HTTP ${res.status}`,
      }
    }

    const payload = (await res.json()) as Record<string, unknown>
    const answers = (payload.answers && typeof payload.answers === "object"
      ? payload.answers
      : {}) as Record<string, unknown>

    const choices =
      payload.choices && typeof payload.choices === "object"
        ? (payload.choices as Record<string, unknown>)
        : null
    const rawDifficulty =
      answers.difficulty ?? choices?.difficulty ?? payload.difficulty ?? payload.verdict
    const difficultyObject =
      rawDifficulty && typeof rawDifficulty === "object"
        ? (rawDifficulty as Record<string, unknown>)
        : null

    const choice = readChoice(rawDifficulty)
    const confidence = readConfidence(
      difficultyObject?.confidence ?? difficultyObject?.certainty,
      payload.confidence,
    )
    const abstention =
      readAbstention(payload, answers) ||
      choices?.is_abstention === true ||
      difficultyObject?.is_abstention === true
    const rationale =
      difficultyObject?.rationale ?? difficultyObject?.reason ?? difficultyObject?.justification
    const rationaleText = typeof rationale === "string" ? ` — ${rationale.slice(0, 200)}` : ""

    if (choice === "hard" && !abstention && confidence >= HARD_CONFIDENCE_THRESHOLD) {
      return {
        mode: "agent",
        reason: `Agent pipeline — Trillionir chose hard (confidence ${confidence.toFixed(2)})${rationaleText}`,
      }
    }

    if (abstention) {
      return {
        mode: "deterministic",
        reason: `Deterministic fallback — Trillionir abstained; ${summariseSignals(signals)}`,
      }
    }

    return {
      mode: "deterministic",
      reason: `Deterministic pipeline — Trillionir chose ${
        choice || "easy"
      } (confidence ${confidence.toFixed(2)})${rationaleText}`,
    }
  } catch (err) {
    const message = (err as Error)?.name === "TimeoutError" ? "timeout" : (err as Error)?.message ?? "error"
    return {
      mode: "deterministic",
      reason: `Deterministic fallback — decision API unavailable (${String(message).slice(0, 120)})`,
    }
  }
}
