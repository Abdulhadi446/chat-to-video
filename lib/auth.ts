import "server-only"

import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto"
import { promisify } from "node:util"
import { cookies } from "next/headers"

import dbApi from "./db"
import type { User } from "./types"

/** Name of the HTTP-only session cookie (contract: `ctv_session`). */
export const SESSION_COOKIE = "ctv_session"

const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60
const SESSION_TTL_MS = SESSION_TTL_SECONDS * 1000

const SCRYPT_COST = 16384
const SCRYPT_BLOCK_SIZE = 8
const SCRYPT_PARALLELIZATION = 1
const SCRYPT_KEY_LENGTH = 64
const SCRYPT_SALT_BYTES = 16
const MAX_PASSWORD_LENGTH = 200

const scrypt = promisify(scryptCallback) as unknown as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: { N: number; r: number; p: number },
) => Promise<Buffer>

type ParsedHash = {
  N: number
  r: number
  p: number
  salt: Buffer
  hash: Buffer
}

function parseHash(stored: string): ParsedHash | null {
  const value = stored.trim()
  if (!value) return null

  // Preferred format: scrypt$N$r$p$salt$hash (hex).
  const parts = value.split("$")
  if (parts.length === 6 && parts[0] === "scrypt") {
    const N = Number(parts[1])
    const r = Number(parts[2])
    const p = Number(parts[3])
    if (![N, r, p].every((n) => Number.isInteger(n) && n > 0)) return null
    if (N > 1_048_576 || r > 32 || p > 16) return null

    const salt = Buffer.from(parts[4], "hex")
    const hash = Buffer.from(parts[5], "hex")
    if (salt.length < 16 || hash.length < 16) return null
    return { N, r, p, salt, hash }
  }

  // Legacy format: salt:hash (hex), with default scrypt parameters.
  const [saltHex, hashHex] = value.split(":")
  if (!saltHex || !hashHex) return null
  const salt = Buffer.from(saltHex, "hex")
  const hash = Buffer.from(hashHex, "hex")
  if (salt.length < 16 || hash.length < 16) return null
  return {
    N: SCRYPT_COST,
    r: SCRYPT_BLOCK_SIZE,
    p: SCRYPT_PARALLELIZATION,
    salt,
    hash,
  }
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

/** Hash a password with scrypt. The parameters and salt are embedded in the result. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SCRYPT_SALT_BYTES)
  const hash = await scrypt(password, salt, SCRYPT_KEY_LENGTH, {
    N: SCRYPT_COST,
    r: SCRYPT_BLOCK_SIZE,
    p: SCRYPT_PARALLELIZATION,
  })
  return `scrypt$${SCRYPT_COST}$${SCRYPT_BLOCK_SIZE}$${SCRYPT_PARALLELIZATION}$${salt.toString("hex")}$${hash.toString("hex")}`
}

/** Constant-time verification of a password against a stored scrypt hash. */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  try {
    if (typeof password !== "string" || password.length > MAX_PASSWORD_LENGTH) return false
    const parsed = parseHash(stored)
    if (!parsed) return false

    const derived = await scrypt(password, parsed.salt, parsed.hash.length, {
      N: parsed.N,
      r: parsed.r,
      p: parsed.p,
    })
    if (derived.length !== parsed.hash.length) return false
    return timingSafeEqual(derived, parsed.hash)
  } catch {
    return false
  }
}

function purgeExpiredSessions(): void {
  try {
    dbApi.purgeExpiredSessions()
  } catch {
    // A failed cleanup must never break an auth request.
  }
}

/**
 * Read the session cookie and resolve the signed-in user.
 * Returns null when the cookie is missing, unknown, or expired.
 */
export async function getSessionUser(): Promise<User | null> {
  purgeExpiredSessions()

  const cookieStore = await cookies()
  const sessionId = cookieStore.get(SESSION_COOKIE)?.value
  if (!sessionId) return null

  const session = dbApi.getSession(sessionId)
  if (!session) return null

  if (session.expiresAt <= Date.now()) {
    try {
      dbApi.deleteSession(sessionId)
    } catch {
      // Ignore: the session is already unusable.
    }
    return null
  }

  return session.user
}

/**
 * Require a signed-in user. Throws a ready-to-return 401 JSON `Response`
 * when there is no valid session, so route handlers can do:
 * `catch (err) { if (err instanceof Response) return err }`.
 */
export async function requireUser(): Promise<User> {
  const user = await getSessionUser()
  if (!user) {
    throw Response.json({ error: "Unauthorized" }, { status: 401 })
  }
  return user
}

/** Create a DB session and set the `ctv_session` cookie (30 days). */
export async function createSessionCookie(userId: string): Promise<void> {
  purgeExpiredSessions()

  const sessionId = dbApi.createSession(userId, Date.now() + SESSION_TTL_MS)
  const cookieStore = await cookies()
  cookieStore.set(SESSION_COOKIE, sessionId, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: process.env.NODE_ENV === "production",
    maxAge: SESSION_TTL_SECONDS,
  })
}

/** Delete the current DB session (if any) and expire the cookie. */
export async function clearSessionCookie(): Promise<void> {
  const cookieStore = await cookies()
  const sessionId = cookieStore.get(SESSION_COOKIE)?.value
  if (sessionId) {
    try {
      dbApi.deleteSession(sessionId)
    } catch {
      // Logout must be idempotent even if the session row is already gone.
    }
  }

  cookieStore.set(SESSION_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: process.env.NODE_ENV === "production",
    maxAge: 0,
  })

  purgeExpiredSessions()
}

/**
 * Normalize + validate an email address. Returns the normalized value or null.
 * Kept here so auth routes and (future) profile routes share one rule.
 */
export function normalizeAndValidateEmail(email: unknown): string | null {
  if (typeof email !== "string") return null
  const normalized = normalizeEmail(email)
  if (normalized.length === 0 || normalized.length > 254) return null
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) return null
  return normalized
}
