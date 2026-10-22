import { DatabaseSync } from "node:sqlite"
import { mkdirSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { randomUUID } from "node:crypto"
import type {
  Asset,
  Chat,
  Job,
  JobStatus,
  Message,
  User,
  VideoSpec,
} from "./types"

const raw = process.env.DATABASE_URL || "file:./data/app.db"
const dbPath = resolve(process.cwd(), raw.replace(/^file:/, ""))
mkdirSync(dirname(dbPath), { recursive: true })

const db = new DatabaseSync(dbPath)

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  PRAGMA busy_timeout = 5000;

  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS chats (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    meta TEXT,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS assets (
    id TEXT PRIMARY KEY,
    chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    status TEXT NOT NULL,
    prompt TEXT NOT NULL,
    spec TEXT,
    file_path TEXT,
    thumb_path TEXT,
    duration REAL,
    aspect TEXT,
    error TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS jobs (
    id TEXT PRIMARY KEY,
    asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
    status TEXT NOT NULL,
    progress INTEGER NOT NULL DEFAULT 0,
    stage TEXT NOT NULL DEFAULT 'queued',
    log TEXT,
    mode TEXT NOT NULL DEFAULT 'deterministic',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_chats_user ON chats(user_id, updated_at DESC);
  CREATE INDEX IF NOT EXISTS idx_messages_chat ON messages(chat_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_assets_chat ON assets(chat_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_jobs_asset ON jobs(asset_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_sessions_expiry ON sessions(expires_at);
`)

const now = () => Date.now()

type Row = Record<string, unknown>

function parseJson<T>(value: unknown): T | null {
  if (typeof value !== "string" || !value) return null
  try {
    return JSON.parse(value) as T
  } catch {
    return null
  }
}

function mapUser(r: Row): User {
  return { id: String(r.id), email: String(r.email), createdAt: Number(r.created_at) }
}

function mapChat(r: Row): Chat {
  return {
    id: String(r.id),
    userId: String(r.user_id),
    title: String(r.title),
    createdAt: Number(r.created_at),
    updatedAt: Number(r.updated_at),
  }
}

function mapMessage(r: Row): Message {
  return {
    id: String(r.id),
    chatId: String(r.chat_id),
    role: r.role as Message["role"],
    content: String(r.content),
    meta: parseJson<Record<string, unknown>>(r.meta),
    createdAt: Number(r.created_at),
  }
}

function mapAsset(r: Row): Asset {
  return {
    id: String(r.id),
    chatId: String(r.chat_id),
    userId: String(r.user_id),
    kind: r.kind as Asset["kind"],
    status: r.status as JobStatus,
    prompt: String(r.prompt),
    spec: parseJson<VideoSpec>(r.spec),
    filePath: r.file_path ? String(r.file_path) : null,
    thumbPath: r.thumb_path ? String(r.thumb_path) : null,
    duration: r.duration == null ? null : Number(r.duration),
    aspect: (r.aspect as Asset["aspect"]) ?? null,
    error: r.error ? String(r.error) : null,
    createdAt: Number(r.created_at),
    updatedAt: Number(r.updated_at),
  }
}

function mapJob(r: Row): Job {
  return {
    id: String(r.id),
    assetId: String(r.asset_id),
    status: r.status as JobStatus,
    progress: Number(r.progress),
    stage: String(r.stage),
    log: r.log ? String(r.log) : null,
    mode: r.mode as Job["mode"],
    createdAt: Number(r.created_at),
    updatedAt: Number(r.updated_at),
  }
}

export const dbApi = {
  // users
  createUser(email: string, passwordHash: string): User {
    const id = randomUUID()
    const ts = now()
    db.prepare(
      "INSERT INTO users (id, email, password_hash, created_at) VALUES (?, ?, ?, ?)",
    ).run(id, email.trim().toLowerCase(), passwordHash, ts)
    return { id, email: email.trim().toLowerCase(), createdAt: ts }
  },

  findUserByEmail(email: string): (User & { passwordHash: string }) | null {
    const r = db
      .prepare("SELECT * FROM users WHERE email = ?")
      .get(email.trim().toLowerCase()) as Row | undefined
    if (!r) return null
    return { ...mapUser(r), passwordHash: String(r.password_hash) }
  },

  findUserById(id: string): User | null {
    const r = db.prepare("SELECT * FROM users WHERE id = ?").get(id) as Row | undefined
    return r ? mapUser(r) : null
  },

  // sessions
  createSession(userId: string, expiresAt: number): string {
    const id = randomUUID()
    db.prepare(
      "INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)",
    ).run(id, userId, expiresAt, now())
    return id
  },

  getSession(id: string): { sessionId: string; expiresAt: number; user: User } | null {
    const r = db
      .prepare(
        "SELECT s.id AS sid, s.expires_at AS exp, u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ?",
      )
      .get(id) as Row | undefined
    if (!r) return null
    return {
      sessionId: String(r.sid),
      expiresAt: Number(r.exp),
      user: mapUser(r),
    }
  },

  deleteSession(id: string): void {
    db.prepare("DELETE FROM sessions WHERE id = ?").run(id)
  },

  purgeExpiredSessions(): void {
    db.prepare("DELETE FROM sessions WHERE expires_at < ?").run(now())
  },

  // chats
  createChat(userId: string, title = "New chat"): Chat {
    const id = randomUUID()
    const ts = now()
    db.prepare(
      "INSERT INTO chats (id, user_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
    ).run(id, userId, title, ts, ts)
    return { id, userId, title, createdAt: ts, updatedAt: ts }
  },

  listChats(userId: string): Chat[] {
    const rows = db
      .prepare("SELECT * FROM chats WHERE user_id = ? ORDER BY updated_at DESC")
      .all(userId) as Row[]
    return rows.map(mapChat)
  },

  getChat(id: string, userId: string): Chat | null {
    const r = db
      .prepare("SELECT * FROM chats WHERE id = ? AND user_id = ?")
      .get(id, userId) as Row | undefined
    return r ? mapChat(r) : null
  },

  renameChat(id: string, userId: string, title: string): void {
    db.prepare("UPDATE chats SET title = ?, updated_at = ? WHERE id = ? AND user_id = ?").run(
      title.slice(0, 80),
      now(),
      id,
      userId,
    )
  },

  touchChat(id: string): void {
    db.prepare("UPDATE chats SET updated_at = ? WHERE id = ?").run(now(), id)
  },

  deleteChat(id: string, userId: string): boolean {
    const result = db
      .prepare("DELETE FROM chats WHERE id = ? AND user_id = ?")
      .run(id, userId)
    return Number(result.changes) > 0
  },

  // messages
  addMessage(
    chatId: string,
    role: Message["role"],
    content: string,
    meta?: Record<string, unknown>,
  ): Message {
    const id = randomUUID()
    const ts = now()
    db.prepare(
      "INSERT INTO messages (id, chat_id, role, content, meta, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    ).run(id, chatId, role, content, meta ? JSON.stringify(meta) : null, ts)
    dbApi.touchChat(chatId)
    return { id, chatId, role, content, meta: meta ?? null, createdAt: ts }
  },

  listMessages(chatId: string): Message[] {
    const rows = db
      .prepare("SELECT * FROM messages WHERE chat_id = ? ORDER BY created_at ASC")
      .all(chatId) as Row[]
    return rows.map(mapMessage)
  },

  // assets
  createAsset(input: {
    chatId: string
    userId: string
    kind: Asset["kind"]
    prompt: string
    aspect?: Asset["aspect"]
    spec?: VideoSpec
  }): Asset {
    const id = randomUUID()
    const ts = now()
    db.prepare(
      `INSERT INTO assets (id, chat_id, user_id, kind, status, prompt, spec, aspect, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'queued', ?, ?, ?, ?, ?)`,
    ).run(
      id,
      input.chatId,
      input.userId,
      input.kind,
      input.prompt,
      input.spec ? JSON.stringify(input.spec) : null,
      input.aspect ?? null,
      ts,
      ts,
    )
    return {
      id,
      chatId: input.chatId,
      userId: input.userId,
      kind: input.kind,
      status: "queued",
      prompt: input.prompt,
      spec: input.spec ?? null,
      filePath: null,
      thumbPath: null,
      duration: null,
      aspect: input.aspect ?? null,
      error: null,
      createdAt: ts,
      updatedAt: ts,
    }
  },

  updateAsset(
    id: string,
    patch: Partial<
      Pick<Asset, "status" | "spec" | "filePath" | "thumbPath" | "duration" | "aspect" | "error">
    >,
  ): void {
    const fields: string[] = []
    const values: (string | number | null)[] = []
    const set = (col: string, value: string | number | null) => {
      fields.push(`${col} = ?`)
      values.push(value)
    }
    if (patch.status !== undefined) set("status", patch.status)
    if (patch.spec !== undefined) set("spec", patch.spec ? JSON.stringify(patch.spec) : null)
    if (patch.filePath !== undefined) set("file_path", patch.filePath)
    if (patch.thumbPath !== undefined) set("thumb_path", patch.thumbPath)
    if (patch.duration !== undefined) set("duration", patch.duration)
    if (patch.aspect !== undefined) set("aspect", patch.aspect)
    if (patch.error !== undefined) set("error", patch.error)
    if (!fields.length) return
    set("updated_at", now())
    values.push(id)
    db.prepare(`UPDATE assets SET ${fields.join(", ")} WHERE id = ?`).run(...values)
  },

  getAsset(id: string): Asset | null {
    const r = db.prepare("SELECT * FROM assets WHERE id = ?").get(id) as Row | undefined
    return r ? mapAsset(r) : null
  },

  listAssets(chatId: string): Asset[] {
    const rows = db
      .prepare("SELECT * FROM assets WHERE chat_id = ? ORDER BY created_at DESC")
      .all(chatId) as Row[]
    return rows.map(mapAsset)
  },

  // jobs
  createJob(assetId: string, mode: Job["mode"]): Job {
    const id = randomUUID()
    const ts = now()
    db.prepare(
      `INSERT INTO jobs (id, asset_id, status, progress, stage, mode, created_at, updated_at)
       VALUES (?, ?, 'queued', 0, 'queued', ?, ?, ?)`,
    ).run(id, assetId, mode, ts, ts)
    return {
      id,
      assetId,
      status: "queued",
      progress: 0,
      stage: "queued",
      log: null,
      mode,
      createdAt: ts,
      updatedAt: ts,
    }
  },

  updateJob(
    id: string,
    patch: Partial<Pick<Job, "status" | "progress" | "stage" | "log" | "mode">>,
  ): void {
    const fields: string[] = []
    const values: (string | number | null)[] = []
    const set = (col: string, value: string | number | null) => {
      fields.push(`${col} = ?`)
      values.push(value)
    }
    if (patch.status !== undefined) set("status", patch.status)
    if (patch.progress !== undefined) set("progress", patch.progress)
    if (patch.stage !== undefined) set("stage", patch.stage)
    if (patch.log !== undefined) set("log", patch.log)
    if (patch.mode !== undefined) set("mode", patch.mode)
    if (!fields.length) return
    set("updated_at", now())
    values.push(id)
    db.prepare(`UPDATE jobs SET ${fields.join(", ")} WHERE id = ?`).run(...values)
  },

  getJob(id: string): Job | null {
    const r = db.prepare("SELECT * FROM jobs WHERE id = ?").get(id) as Row | undefined
    return r ? mapJob(r) : null
  },

  listJobs(assetId: string): Job[] {
    const rows = db
      .prepare("SELECT * FROM jobs WHERE asset_id = ? ORDER BY created_at DESC")
      .all(assetId) as Row[]
    return rows.map(mapJob)
  },

  latestJob(assetId: string): Job | null {
    const r = db
      .prepare("SELECT * FROM jobs WHERE asset_id = ? ORDER BY created_at DESC LIMIT 1")
      .get(assetId) as Row | undefined
    return r ? mapJob(r) : null
  },
}

export default dbApi
