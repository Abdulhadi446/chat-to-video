import { createReadStream } from "node:fs"
import { realpath, stat } from "node:fs/promises"
import { extname, isAbsolute, resolve, sep } from "node:path"
import { Readable } from "node:stream"
import type { NextRequest } from "next/server"

import { requireUser } from "@/lib/auth"
import { unstable_rethrow } from "next/navigation"

type RouteParams = { params: Promise<{ path: string[] }> }

const CONTENT_TYPES: Record<string, string> = {
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".wav": "audio/wav",
  ".mp3": "audio/mpeg",
  ".m4a": "audio/mp4",
  ".aac": "audio/aac",
}

function jsonError(message: string, status: number): Response {
  return Response.json({ error: message }, { status })
}

function notFound(): Response {
  return jsonError("Not found", 404)
}

function isSafeSegment(segment: string): boolean {
  if (!segment) return false
  if (segment === "." || segment === "..") return false
  if (segment.includes("/") || segment.includes("\\") || segment.includes("\0")) return false
  if (segment.startsWith(".")) return false
  if (isAbsolute(segment)) return false
  return true
}

function parseRange(
  header: string,
  size: number,
): { start: number; end: number } | null {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim())
  if (!match) return null

  const [, startRaw, endRaw] = match
  if (!startRaw && !endRaw) return null

  let start: number
  let end: number

  if (!startRaw) {
    // Suffix range: bytes=-N -> last N bytes.
    const suffixLength = Number(endRaw)
    if (!Number.isInteger(suffixLength) || suffixLength <= 0) return null
    start = Math.max(size - suffixLength, 0)
    end = size - 1
  } else {
    start = Number(startRaw)
    end = endRaw ? Number(endRaw) : size - 1
  }

  if (!Number.isInteger(start) || !Number.isInteger(end)) return null
  if (start < 0 || start >= size || start > end) return null

  return { start, end: Math.min(end, size - 1) }
}

export async function GET(
  req: NextRequest,
  { params }: RouteParams,
): Promise<Response> {
  try {
    await requireUser()
  } catch (err) {
    unstable_rethrow(err)
    if (err instanceof Response) return err
    console.error("[files] auth failed", err)
    return jsonError("Something went wrong", 500)
  }

  const { path: segments } = await params
  if (!Array.isArray(segments) || segments.length === 0) return notFound()
  if (!segments.every(isSafeSegment)) return notFound()

  let dataRoot: string
  try {
    dataRoot = await realpath(resolve(process.cwd(), "data"))
  } catch {
    // No data directory yet -> nothing to serve.
    return notFound()
  }

  const requested = resolve(dataRoot, ...segments)
  if (!requested.startsWith(dataRoot + sep)) return notFound()

  // Resolve symlinks so a link inside data/ cannot escape it.
  let filePath: string
  try {
    filePath = await realpath(requested)
  } catch {
    return notFound()
  }
  if (!filePath.startsWith(dataRoot + sep)) return notFound()

  // Allowlist media extensions only. This keeps .env, *.db, and source out.
  const contentType = CONTENT_TYPES[extname(filePath).toLowerCase()]
  if (!contentType) return notFound()

  let fileStats
  try {
    fileStats = await stat(filePath)
  } catch {
    return notFound()
  }
  if (!fileStats.isFile()) return notFound()

  const size = fileStats.size
  const baseHeaders: Record<string, string> = {
    "Content-Type": contentType,
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, max-age=0, must-revalidate",
    "X-Content-Type-Options": "nosniff",
  }

  if (size === 0) {
    return new Response(null, {
      status: 200,
      headers: { ...baseHeaders, "Content-Length": "0" },
    })
  }

  const rangeHeader = req.headers.get("range")
  let start = 0
  let end = size - 1
  let status = 200

  if (rangeHeader) {
    const range = parseRange(rangeHeader, size)
    if (!range) {
      return new Response(null, {
        status: 416,
        headers: {
          "Content-Range": `bytes */${size}`,
          "Accept-Ranges": "bytes",
          "Cache-Control": baseHeaders["Cache-Control"],
        },
      })
    }
    start = range.start
    end = range.end
    status = 206
  }

  const headers: Record<string, string> = {
    ...baseHeaders,
    "Content-Length": String(end - start + 1),
  }
  if (status === 206) {
    headers["Content-Range"] = `bytes ${start}-${end}/${size}`
  }

  try {
    const nodeStream = createReadStream(filePath, { start, end })
    const stream = Readable.toWeb(nodeStream) as unknown as ReadableStream<Uint8Array>
    return new Response(stream, { status, headers })
  } catch (err) {
    console.error("[files] stream failed", err)
    return notFound()
  }
}
