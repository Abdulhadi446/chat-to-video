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
  const job = dbApi.getJob(id)
  if (!job) return Response.json({ error: "Job not found" }, { status: 404 })

  const asset = dbApi.getAsset(job.assetId)
  if (!asset || asset.userId !== user.id) {
    return Response.json({ error: "Job not found" }, { status: 404 })
  }

  return Response.json({ job, asset })
}
