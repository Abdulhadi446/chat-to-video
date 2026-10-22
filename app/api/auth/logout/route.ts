import { clearSessionCookie } from "@/lib/auth"

export async function POST(): Promise<Response> {
  try {
    await clearSessionCookie()
  } catch (err) {
    console.error("[auth/logout]", err)
    // Logout stays idempotent; the client clears its local state regardless.
  }
  return Response.json({ ok: true })
}
