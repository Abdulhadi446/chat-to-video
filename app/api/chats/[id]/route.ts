import type { NextRequest } from "next/server"
import { unstable_rethrow } from "next/navigation"

import { requireUser } from "@/lib/auth"
import dbApi from "@/lib/db"
import type { User } from "@/lib/types"

type RouteParams = { params: Promise<{ id: string }> }

function jsonError(message: string, status: number): Response {
  return Response.json({ error: message }, { status })
}

function notFound(): Response {
  return jsonError("Chat not found", 404)
}

async function authUser(): Promise<User | Response> {
  try {
    return await requireUser()
  } catch (err) {
    unstable_rethrow(err)
    if (err instanceof Response) return err
    console.error("[chats/:id] auth failed", err)
    return jsonError("Something went wrong", 500)
  }
}

async function readJsonObject(req: NextRequest): Promise<Record<string, unknown> | null> {
  try {
    const body: unknown = await req.json()
    if (!body || typeof body !== "object" || Array.isArray(body)) return null
    return body as Record<string, unknown>
  } catch {
    return null
  }
}

export async function GET(_req: NextRequest, { params }: RouteParams): Promise<Response> {
  const user = await authUser()
  if (user instanceof Response) return user

  const { id } = await params

  try {
    const chat = dbApi.getChat(id, user.id)
    if (!chat) return notFound()

    return Response.json({
      chat,
      messages: dbApi.listMessages(id),
      assets: dbApi.listAssets(id).map((asset) => ({
        ...asset,
        job: dbApi.latestJob(asset.id),
      })),
    })
  } catch (err) {
    console.error("[chats/:id GET]", err)
    return jsonError("Something went wrong", 500)
  }
}

export async function PATCH(req: NextRequest, { params }: RouteParams): Promise<Response> {
  const user = await authUser()
  if (user instanceof Response) return user

  const { id } = await params
  const data = await readJsonObject(req)
  if (!data || typeof data.title !== "string") {
    return jsonError("Title is required", 400)
  }
  const title = data.title.trim().slice(0, 80)
  if (!title) {
    return jsonError("Title cannot be empty", 400)
  }

  try {
    const existing = dbApi.getChat(id, user.id)
    if (!existing) return notFound()

    dbApi.renameChat(id, user.id, title)
    return Response.json({ chat: dbApi.getChat(id, user.id) })
  } catch (err) {
    console.error("[chats/:id PATCH]", err)
    return jsonError("Something went wrong", 500)
  }
}

export async function DELETE(_req: NextRequest, { params }: RouteParams): Promise<Response> {
  const user = await authUser()
  if (user instanceof Response) return user

  const { id } = await params

  try {
    const chat = dbApi.getChat(id, user.id)
    if (!chat) return notFound()

    dbApi.deleteChat(id, user.id)
    return Response.json({ ok: true })
  } catch (err) {
    console.error("[chats/:id DELETE]", err)
    return jsonError("Something went wrong", 500)
  }
}
