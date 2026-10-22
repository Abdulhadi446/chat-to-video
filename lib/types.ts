export type AssetKind = "video" | "image"
export type JobStatus = "queued" | "running" | "done" | "failed"
export type Aspect = "9:16" | "16:9" | "1:1"
export type VoiceMode = "silent" | "narrator"
export type Transition = "fade" | "slide" | "zoom"

export interface Scene {
  text: string
  caption?: string
  /** Visual direction for the renderer (background, motion, imagery). */
  visual: string
  /** Optional stock-image search query (Openverse). */
  assetQuery?: string
  duration: number
  transition?: Transition
}

export interface VideoSpec {
  title: string
  kind: AssetKind
  /** Total duration in seconds. */
  duration: number
  aspect: Aspect
  voice: VoiceMode
  style?: string
  palette?: string[]
  scenes: Scene[]
  voiceScript?: string
}

export interface User {
  id: string
  email: string
  createdAt: number
}

export interface Chat {
  id: string
  userId: string
  title: string
  createdAt: number
  updatedAt: number
}

export interface Message {
  id: string
  chatId: string
  role: "user" | "assistant" | "system"
  content: string
  meta: Record<string, unknown> | null
  createdAt: number
}

export interface Asset {
  id: string
  chatId: string
  userId: string
  kind: AssetKind
  status: JobStatus
  prompt: string
  spec: VideoSpec | null
  filePath: string | null
  thumbPath: string | null
  duration: number | null
  aspect: Aspect | null
  error: string | null
  createdAt: number
  updatedAt: number
}

export interface Job {
  id: string
  assetId: string
  status: JobStatus
  progress: number
  stage: string
  log: string | null
  mode: "deterministic" | "agent"
  createdAt: number
  updatedAt: number
}

export interface JobWithAsset extends Job {
  asset: Asset
}

export const ASPECTS: Record<Aspect, { width: number; height: number }> = {
  "9:16": { width: 720, height: 1280 },
  "16:9": { width: 1280, height: 720 },
  "1:1": { width: 1080, height: 1080 },
}

export const DURATIONS = [10, 30, 60] as const
