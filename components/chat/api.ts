import type { Aspect, Asset, Chat, Job, Message, User, VoiceMode } from "@/lib/types"

export type AssetWithJob = Asset & {
  job?: Job | null
  jobId?: string | null
}

type AssetPayload = AssetWithJob | { asset: Asset; job?: Job | null }

export interface ChatDetail {
  chat: Chat
  messages: Message[]
  assets: AssetPayload[]
}

export interface SendResult {
  userMessage: Message
  reply: Message
  asset?: AssetPayload
  job?: Job | null
}

export interface RenderSettings {
  duration: 10 | 30 | 60
  aspect: Aspect
  voice: VoiceMode
}

export const DEFAULT_SETTINGS: RenderSettings = {
  duration: 10,
  aspect: "9:16",
  voice: "silent",
}

export class ApiError extends Error {
  status: number
  data: unknown

  constructor(message: string, status: number, data: unknown = null) {
    super(message)
    this.name = "ApiError"
    this.status = status
    this.data = data
  }
}

function messageFrom(data: unknown, fallback: string): string {
  if (data && typeof data === "object") {
    const record = data as Record<string, unknown>
    if (typeof record.error === "string" && record.error.trim()) return record.error
    if (typeof record.message === "string" && record.message.trim()) return record.message
  }
  return fallback
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    cache: "no-store",
    credentials: "same-origin",
    ...init,
    headers: {
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...(init?.headers ?? {}),
    },
  })

  let data: unknown = null
  try {
    data = await response.json()
  } catch {
    data = null
  }

  if (!response.ok) {
    const fallback =
      response.status === 401
        ? "Your session has expired. Sign in again."
        : response.status === 404
          ? "That item could not be found."
          : "Something went wrong. Try again."
    throw new ApiError(messageFrom(data, fallback), response.status, data)
  }

  return data as T
}

export const api = {
  me: () => request<{ user: User }>("/api/auth/me"),
  listChats: () => request<{ chats: Chat[] }>("/api/chats"),
  createChat: () =>
    request<{ chat: Chat }>("/api/chats", { method: "POST", body: JSON.stringify({}) }),
  getChat: (id: string) => request<ChatDetail>(`/api/chats/${encodeURIComponent(id)}`),
  sendMessage: (chatId: string, content: string) =>
    request<SendResult>(`/api/chats/${encodeURIComponent(chatId)}/messages`, {
      method: "POST",
      body: JSON.stringify({ content }),
    }),
  getJob: (id: string) => request<{ job: Job; asset: AssetWithJob }>(`/api/jobs/${encodeURIComponent(id)}`),
  retryAsset: (id: string) =>
    request<{ job: Job }>(`/api/assets/${encodeURIComponent(id)}/retry`, { method: "POST" }),
  logout: () => request<{ ok: true }>("/api/auth/logout", { method: "POST" }),
}

function isNestedAsset(
  payload: AssetPayload,
): payload is { asset: Asset; job?: Job | null } {
  return "asset" in payload && Boolean(payload.asset)
}

export function normalizeAsset(payload: AssetPayload): AssetWithJob {
  if (isNestedAsset(payload)) {
    return { ...payload.asset, job: payload.job ?? null }
  }
  return payload
}

export function normalizeAssets(payloads: AssetPayload[] | undefined | null): AssetWithJob[] {
  return (payloads ?? []).map(normalizeAsset)
}

export function jobsFromAssets(assets: AssetWithJob[]): Record<string, Job> {
  const jobs: Record<string, Job> = {}
  for (const asset of assets) {
    if (asset.job) jobs[asset.id] = asset.job
  }
  return jobs
}

/**
 * Chat detail returns assets without jobs. The assistant message stores the
 * job id in its metadata, so recover a placeholder to resume polling on reload.
 */
export function jobsFromMessages(
  messages: Message[],
  assets: AssetWithJob[],
): Record<string, Job> {
  const activeAssets = new Set(
    assets
      .filter((asset) => asset.status === "queued" || asset.status === "running")
      .map((asset) => asset.id),
  )
  const known = jobsFromAssets(assets)
  const jobs: Record<string, Job> = {}

  for (const message of [...messages].reverse()) {
    const meta = message.meta
    if (!meta) continue
    const jobId = typeof meta.jobId === "string" ? meta.jobId : null
    const assetId = typeof meta.assetId === "string" ? meta.assetId : null
    if (!jobId || !assetId || !activeAssets.has(assetId) || known[assetId] || jobs[assetId]) {
      continue
    }
    const mode: Job["mode"] = meta.mode === "agent" ? "agent" : "deterministic"
    jobs[assetId] = {
      id: jobId,
      assetId,
      status: "running",
      progress: 0,
      stage: "queued",
      log: null,
      mode,
      createdAt: message.createdAt,
      updatedAt: message.createdAt,
    }
  }

  return jobs
}

const SETTINGS_SEPARATOR = "\n\nSettings: "

export function formatOutgoing(text: string, settings: RenderSettings): string {
  const voice = settings.voice === "narrator" ? "narrator" : "silent"
  return `${text.trim()}${SETTINGS_SEPARATOR}${settings.duration}s · ${settings.aspect} · ${voice}`
}

export function splitSettings(content: string): { body: string; settings: string[] } {
  const index = content.lastIndexOf(SETTINGS_SEPARATOR)
  if (index === -1) return { body: content, settings: [] }

  const line = content.slice(index + SETTINGS_SEPARATOR.length).split("\n")[0] ?? ""
  const settings = line
    .split(" · ")
    .map((part) => part.trim())
    .filter(Boolean)

  return { body: content.slice(0, index), settings }
}

const clockFormatter = new Intl.DateTimeFormat(undefined, {
  hour: "numeric",
  minute: "2-digit",
})

const dayFormatter = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
})

export function formatClock(timestamp: number): string {
  return clockFormatter.format(timestamp)
}

export function relativeTime(timestamp: number, now = Date.now()): string {
  const seconds = Math.round((now - timestamp) / 1000)
  if (seconds < 45) return "now"
  if (seconds < 3600) return `${Math.max(1, Math.round(seconds / 60))}m`
  if (seconds < 86400) return `${Math.round(seconds / 3600)}h`
  if (seconds < 86400 * 7) return `${Math.round(seconds / 86400)}d`
  return dayFormatter.format(timestamp)
}

export interface ChatGroup {
  label: string
  chats: Chat[]
}

export function groupChats(chats: Chat[]): ChatGroup[] {
  const now = new Date()
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const startOfYesterday = startOfToday - 86400000
  const startOfWeek = startOfToday - 6 * 86400000

  const buckets: ChatGroup[] = [
    { label: "Today", chats: [] },
    { label: "Yesterday", chats: [] },
    { label: "Previous 7 days", chats: [] },
    { label: "Older", chats: [] },
  ]

  for (const chat of [...chats].sort((a, b) => b.updatedAt - a.updatedAt)) {
    if (chat.updatedAt >= startOfToday) buckets[0].chats.push(chat)
    else if (chat.updatedAt >= startOfYesterday) buckets[1].chats.push(chat)
    else if (chat.updatedAt >= startOfWeek) buckets[2].chats.push(chat)
    else buckets[3].chats.push(chat)
  }

  return buckets.filter((bucket) => bucket.chats.length > 0)
}

export function formatStage(stage: string | null | undefined): string {
  if (!stage) return "Waiting to start"
  const key = stage.trim().toLowerCase().replace(/_/g, " ")
  const known: Record<string, string> = {
    queued: "Waiting to start",
    queue: "Waiting to start",
    parse: "Reading the brief",
    intent: "Reading the brief",
    decide: "Choosing a render path",
    router: "Choosing a render path",
    storyboard: "Writing the storyboard",
    planning: "Writing the storyboard",
    plan: "Writing the storyboard",
    tts: "Recording narration",
    narration: "Recording narration",
    voice: "Recording narration",
    audio: "Recording narration",
    assets: "Preparing visuals",
    asset: "Preparing visuals",
    visual: "Preparing visuals",
    render: "Rendering scenes",
    rendering: "Rendering scenes",
    scenes: "Rendering scenes",
    encode: "Encoding the file",
    encoding: "Encoding the file",
    finalizing: "Encoding the file",
    mux: "Encoding the file",
    done: "Finishing up",
    failed: "Render failed",
  }
  return known[key] ?? key.replace(/^\w/, (char) => char.toUpperCase())
}

export function clampProgress(value: number | null | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0
  return Math.max(0, Math.min(100, value))
}

export function assetAspect(asset: AssetWithJob): Aspect {
  return asset.aspect ?? asset.spec?.aspect ?? "9:16"
}

export function assetDuration(asset: AssetWithJob): number | null {
  return asset.duration ?? asset.spec?.duration ?? null
}

export function assetVoice(asset: AssetWithJob): VoiceMode | null {
  return asset.spec?.voice ?? null
}

export function fileHref(path: string | null | undefined): string | null {
  if (!path) return null
  // Stored paths are repo-relative (`data/outputs/...`); the file route serves
  // from inside `data/`, so the leading root segment is not part of the URL.
  const relative = path
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .replace(/^data\//, "")
    .replace(/^\.\//, "")
  if (!relative) return null
  return `/api/files/${relative
    .split("/")
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join("/")}`
}

export function aspectRatioValue(aspect: Aspect): string {
  return aspect.replace(":", " / ")
}

export function kindLabel(kind: Asset["kind"]): string {
  return kind === "video" ? "video" : "still"
}
