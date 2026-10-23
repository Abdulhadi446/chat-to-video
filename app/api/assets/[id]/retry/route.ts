import { NextRequest } from "next/server"

import { getSessionUser } from "@/lib/auth"
import dbApi from "@/lib/db"
import { enqueueJob } from "@/lib/jobs/runner"

export async function POST(
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

  // One active job per asset: a retry while queued/running is a no-op.
  const active = dbApi
    .listJobs(asset.id)
    .find((job) => job.status === "queued" || job.status === "running")
  if (active) {
    return Response.json(
      { error: "A job is already active for this asset", job: active },
      { status: 409 },
    )
  }

  try {
    const previous = dbApi.latestJob(asset.id)
    const job = dbApi.createJob(asset.id, previous?.mode ?? "deterministic")
    dbApi.updateAsset(asset.id, { status: "queued", error: null })
    enqueueJob(job.id)
    return Response.json({ job })
  } catch (error) {
    console.error("[assets/retry] failed to enqueue retry:", error)
    return Response.json({ error: "Failed to retry asset" }, { status: 500 })
  }
}
