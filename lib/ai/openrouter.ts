import OpenAI from "openai"
import type { ChatCompletionCreateParamsNonStreaming } from "openai/resources/chat/completions"

export const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1"
/**
 * Free Nemotron 3.5 Super is a strong 1M-context model that returns clean
 * storyboard JSON in ~3s with reasoning disabled. The old paid default
 * (gpt-4o-mini) 402s on this key.
 */
export const DEFAULT_OPENROUTER_MODEL = "nvidia/nemotron-3.5-super-vl:free"
export const DEFAULT_OPENROUTER_FALLBACK_MODEL = "cohere/north-mini-code:free"
/** Hard ceiling for a single completion request (task requirement: 45s, one retry). */
export const OPENROUTER_TIMEOUT_MS = 45_000

export interface ChatMessage {
  role: "system" | "user" | "assistant"
  content: string
}

let cachedClient: OpenAI | null = null

export function openRouterModel(): string {
  const configured = process.env.OPENROUTER_MODEL?.trim()
  return configured || DEFAULT_OPENROUTER_MODEL
}

export function openRouterConfigured(): boolean {
  return Boolean(process.env.OPENROUTER_API_KEY?.trim())
}

function getClient(): OpenAI {
  const apiKey = process.env.OPENROUTER_API_KEY?.trim()
  if (!apiKey) throw new Error("OPENROUTER_API_KEY is not configured")
  if (!cachedClient) {
    cachedClient = new OpenAI({
      apiKey,
      baseURL: OPENROUTER_BASE_URL,
      timeout: OPENROUTER_TIMEOUT_MS,
      maxRetries: 1,
      defaultHeaders: {
        "HTTP-Referer": "https://github.com/chat-to-video",
        "X-Title": "Chat to Video",
      },
    })
  }
  return cachedClient
}

/**
 * Single chat completion against OpenRouter. Returns the raw message content.
 * Throws on transport/API errors — callers are expected to have a fallback.
 */
export async function chatCompletion(args: {
  messages: ChatMessage[]
  temperature?: number
  maxTokens?: number
}): Promise<string> {
  const primary = openRouterModel()
  const fallback = process.env.OPENROUTER_FALLBACK_MODEL?.trim() || DEFAULT_OPENROUTER_FALLBACK_MODEL
  const models = fallback && fallback !== primary ? [primary, fallback] : [primary]

  let lastError: unknown = null

  for (const model of models) {
    try {
      const params = {
        model,
        messages: args.messages,
        temperature: args.temperature ?? 0.4,
        max_tokens: args.maxTokens ?? 1400,
        // Nemotron is a hybrid reasoning model. Without this it can spend the
        // whole token budget on hidden reasoning and return empty content.
        reasoning: { enabled: false },
      } as ChatCompletionCreateParamsNonStreaming
      const completion = await getClient().chat.completions.create(params)
      const content = completion.choices?.[0]?.message?.content
      if (typeof content !== "string" || !content.trim()) {
        throw new Error("OpenRouter returned an empty completion")
      }
      return content
    } catch (err) {
      lastError = err
      const status = (err as { status?: number })?.status
      // Bad credentials affect every fallback; everything else (402/404/429,
      // provider hiccups, empty output) is worth trying the next model.
      if (!fallback || status === 401 || status === 403) throw err
      console.warn(
        `[openrouter] ${model} failed${status ? ` with ${status}` : ""}; trying ${fallback}`,
      )
    }
  }

  throw lastError instanceof Error ? lastError : new Error("OpenRouter request failed")
}

function stripFences(raw: string): string {
  let text = raw.trim()
  // ```json ... ``` (also handles ```JSON / ``` only variants)
  if (text.startsWith("```")) {
    text = text.replace(/^```[a-zA-Z0-9_-]*\s*/, "")
    text = text.replace(/\s*```\s*$/, "")
  }
  return text.trim()
}

/**
 * Best-effort JSON extraction from an LLM response:
 * strips markdown fences and finds the first balanced `{ ... }` object.
 */
export function extractJson<T = unknown>(raw: string): T | null {
  if (typeof raw !== "string" || !raw.trim()) return null
  const text = stripFences(raw)

  try {
    const direct = JSON.parse(text) as T
    if (direct && typeof direct === "object") return direct
  } catch {
    // fall through to brace scanning
  }

  const start = text.indexOf("{")
  if (start === -1) return null

  let depth = 0
  let inString = false
  let escaped = false

  for (let i = start; i < text.length; i++) {
    const ch = text[i]

    if (inString) {
      if (escaped) escaped = false
      else if (ch === "\\") escaped = true
      else if (ch === '"') inString = false
      continue
    }

    if (ch === '"') {
      inString = true
    } else if (ch === "{") {
      depth++
    } else if (ch === "}") {
      depth--
      if (depth === 0) {
        const candidate = text.slice(start, i + 1)
        try {
          return JSON.parse(candidate) as T
        } catch {
          // Keep scanning for another object after this one.
          const next = text.indexOf("{", i + 1)
          if (next === -1) return null
          i = next - 1
          depth = 0
          inString = false
          escaped = false
        }
      }
    }
  }

  // Last resort: greedy match (handles truncated prose around an object).
  const greedy = text.match(/\{[\s\S]*\}/)
  if (greedy) {
    try {
      return JSON.parse(greedy[0]) as T
    } catch {
      return null
    }
  }
  return null
}
