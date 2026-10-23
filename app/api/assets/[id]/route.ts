import { NextRequest } from "next/server"

import { getSessionUser } from "@/lib/auth"
import dbApi from "@/lib/db"

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const user = await getSessionUser()
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 })

  const { id } = await context.params
  const asset = dbApi.getAsset(id)
  if (!asset || asset.userId !== user.id) {
    return Response.json({ error: "Asset not found" }, { status: 404 })
  }

  return Response.json({ asset, jobs: dbApi.listJobs(asset.id) })
}
