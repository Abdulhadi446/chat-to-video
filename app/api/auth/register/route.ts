import type { NextRequest } from "next/server"

import { createSessionCookie, hashPassword, normalizeAndValidateEmail } from "@/lib/auth"
import dbApi from "@/lib/db"

function jsonError(message: string, status: number): Response {
  return Response.json({ error: message }, { status })
}

function isUniqueEmailError(err: unknown): boolean {
  return (
    err instanceof Error &&
    /UNIQUE constraint failed: users\.email/i.test(err.message)
  )
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

  if (!email) {
    return jsonError("Enter a valid email address", 400)
  }
  if (typeof password !== "string" || password.length < 8) {
    return jsonError("Password must be at least 8 characters", 400)
  }
  if (password.length > 200) {
    return jsonError("Password must be 200 characters or fewer", 400)
  }

  try {
    dbApi.purgeExpiredSessions()

    if (dbApi.findUserByEmail(email)) {
      return jsonError("Email is already registered", 409)
    }

    const passwordHash = await hashPassword(password)
    const user = dbApi.createUser(email, passwordHash)
    await createSessionCookie(user.id)

    return Response.json({ user }, { status: 201 })
  } catch (err) {
    if (isUniqueEmailError(err)) {
      return jsonError("Email is already registered", 409)
    }
    console.error("[auth/register]", err)
    return jsonError("Something went wrong", 500)
  }
}
