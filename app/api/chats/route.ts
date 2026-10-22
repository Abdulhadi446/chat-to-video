import type { NextRequest } from "next/server"

import { requireUser } from "@/lib/auth"
import dbApi from "@/lib/db"
import type { User } from "@/lib/types"

function jsonError(message: string, status: number): Response {
  return Response.json({ error: message }, { status })
}

async function authUser(): Promise<User | Response> {
  try {
    return await requireUser()
  } catch (err) {
    if (err instanceof Response) return err
    console.error("[chats] auth failed", err)
    return jsonError("Something went wrong", 500)
  }
}

export async function GET(): Promise<Response> {
  const user = await authUser()
  if (user instanceof Response) return user

  try {
    return Response.json({ chats: dbApi.listChats(user.id) })
  } catch (err) {
    console.error("[chats GET]", err)
    return jsonError("Something went wrong", 500)
  }
}

export async function POST(req: NextRequest): Promise<Response> {
  const user = await authUser()
  if (user instanceof Response) return user

  let body: unknown = null
  try {
    body = await req.json()
  } catch {
    // An empty body is fine: creates the default "New chat".
    body = null
  }

  const data = body && typeof body === "object" ? (body as Record<string, unknown>) : {}
  let title = "New chat"
  if (data.title !== undefined) {
    if (typeof data.title !== "string") {
      return jsonError("Title must be a string", 400)
    }
    const trimmed = data.title.trim()
    if (trimmed.length > 0) title = trimmed.slice(0, 80)
  }

  try {
    const chat = dbApi.createChat(user.id, title)
    return Response.json({ chat }, { status: 201 })
  } catch (err) {
    console.error("[chats POST]", err)
    return jsonError("Something went wrong", 500)
  }
}
