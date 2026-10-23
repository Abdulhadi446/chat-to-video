import { getSessionUser } from "@/lib/auth"
import { unstable_rethrow } from "next/navigation"

export async function GET(): Promise<Response> {
  try {
    const user = await getSessionUser()
    if (!user) {
      return Response.json({ error: "Unauthorized" }, { status: 401 })
    }
    return Response.json({ user })
  } catch (err) {
    unstable_rethrow(err)
    console.error("[auth/me]", err)
    return Response.json({ error: "Something went wrong" }, { status: 500 })
  }
}
