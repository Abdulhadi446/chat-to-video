import type { NextRequest } from "next/server"

import {
  createSessionCookie,
  normalizeAndValidateEmail,
  verifyPassword,
} from "@/lib/auth"
import dbApi from "@/lib/db"

// Well-formed scrypt hash used only to keep the "unknown email" path roughly
// as expensive as a real verification (mitigates user-enumeration timing).
const DUMMY_HASH = `scrypt$16384$8$1$${"0".repeat(32)}$${"0".repeat(128)}`

function jsonError(message: string, status: number): Response {
  return Response.json({ error: message }, { status })
}

export async function POST(req: NextRequest): Promise<Response> {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return jsonError("Invalid request body", 400)
  }

  const data = body && typeof body === "object" ? (body as Record<string, unknown>) : {}
  const email = normalizeAndValidateEmail(data.email)
  const password = data.password

  if (!email || typeof password !== "string" || password.length === 0) {
    return jsonError("Invalid email or password", 401)
  }
  if (password.length > 200) {
    return jsonError("Invalid email or password", 401)
  }

  try {
    dbApi.purgeExpiredSessions()

    const user = dbApi.findUserByEmail(email)
    if (!user) {
      await verifyPassword(password, DUMMY_HASH)
      return jsonError("Invalid email or password", 401)
    }

    const valid = await verifyPassword(password, user.passwordHash)
    if (!valid) {
      return jsonError("Invalid email or password", 401)
    }

    await createSessionCookie(user.id)

    return Response.json({
      user: { id: user.id, email: user.email, createdAt: user.createdAt },
    })
  } catch (err) {
    console.error("[auth/login]", err)
    return jsonError("Something went wrong", 500)
  }
}
