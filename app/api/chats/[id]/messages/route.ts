import { NextRequest } from "next/server"

import { getSessionUser } from "@/lib/auth"
import { decideMode } from "@/lib/ai/decision"
import { parseIntent, type Intent } from "@/lib/ai/intent"
import { createStoryboard } from "@/lib/ai/storyboard"
import dbApi from "@/lib/db"
import { enqueueJob } from "@/lib/jobs/runner"
import type { ModeDecision } from "@/lib/ai/decision"

function unauthorized(): Response {
  return Response.json({ error: "Unauthorized" }, { status: 401 })
}

function notFound(): Response {
  return Response.json({ error: "Chat not found" }, { status: 404 })
}

function replyCopy(intent: Intent, decision: ModeDecision): string {
  const topic = intent.topic.length > 90 ? `${intent.topic.slice(0, 87)}...` : intent.topic
  const media =
    intent.kind === "image"
      ? `a ${intent.aspect} image`
      : `a ${intent.duration}s ${intent.aspect} video${
          intent.voice === "narrator" ? " with narration" : " (silent)"
        }`
  const pipeline = decision.mode === "agent" ? "the agent pipeline" : "the deterministic pipeline"
  return `Queued ${media}: “${topic}”. It’s rendering next on ${pipeline} — progress will show in the sidebar.`
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const user = await getSessionUser()
  if (!user) return unauthorized()

  const { id: chatId } = await context.params
  const chat = dbApi.getChat(chatId, user.id)
  if (!chat) return notFound()

  let payload: unknown
  try {
    payload = await request.json()
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const rawContent =
    payload && typeof payload === "object" && "content" in payload
      ? (payload as { content?: unknown }).content
      : undefined
  const content = typeof rawContent === "string" ? rawContent.trim() : ""
  if (!content) {
    return Response.json({ error: "Message content is required" }, { status: 400 })
  }
  if (content.length > 4_000) {
    return Response.json({ error: "Message is too long (max 4000 characters)" }, { status: 400 })
  }

  try {
    const history = dbApi.listMessages(chat.id)
    const userMessage = dbApi.addMessage(chat.id, "user", content)

    const intent = await parseIntent(content, history)

    // Not a creation request: answer with a helpful question, no asset/job.
    if (intent.needsClarification) {
      const reply = dbApi.addMessage(chat.id, "assistant", intent.needsClarification, { intent })
      return Response.json({ userMessage, reply, intent })
    }

    const [spec, decision] = await Promise.all([
      createStoryboard(intent),
      decideMode(intent, content),
    ])

    const asset = dbApi.createAsset({
      chatId: chat.id,
      userId: user.id,
      kind: intent.kind,
      prompt: content,
      aspect: intent.aspect,
      spec,
    })
    const job = dbApi.createJob(asset.id, decision.mode)

    const reply = dbApi.addMessage(chat.id, "assistant", replyCopy(intent, decision), {
      assetId: asset.id,
      jobId: job.id,
      mode: decision.mode,
      reason: decision.reason,
      intent,
    })

    if (chat.title === "New chat") {
      const title = intent.topic.trim().slice(0, 60) || "New chat"
      dbApi.renameChat(chat.id, user.id, title)
    }

    enqueueJob(job.id)

    return Response.json({ userMessage, reply, asset, job, intent, decision })
  } catch (error) {
    console.error("[messages] failed to queue generation:", error)
    return Response.json({ error: "Failed to queue generation" }, { status: 500 })
  }
}
