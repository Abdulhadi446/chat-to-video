"use client"

import { ArrowUpRight, Download, Film, ImageIcon, Loader2, Video } from "lucide-react"
import type { Job } from "@/lib/types"
import { Button, buttonVariants } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { StatusPill } from "@/components/ui/status-pill"
import { cn } from "@/lib/utils"
import {
  assetAspect,
  assetDuration,
  assetVoice,
  clampProgress,
  fileHref,
  formatStage,
  type AssetWithJob,
} from "@/components/chat/api"

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="font-mono text-[8px] uppercase tracking-[0.14em] text-faint">{label}</dt>
      <dd className="mt-0.5 truncate text-[10.5px] text-ink/85">{value}</dd>
    </div>
  )
}

export function SidebarAssetCard({
  asset,
  job,
  onJump,
}: {
  asset: AssetWithJob | null
  job: Job | null
  onJump: () => void
}) {
  if (!asset) {
    return (
      <div className="rounded-card border border-dashed border-line bg-white/[0.012] p-3">
        <div className="flex items-center gap-2 text-[11px] text-muted">
          <Film className="size-3.5 text-faint" aria-hidden="true" />
          Nothing rendered yet
        </div>
        <p className="mt-1.5 text-[10px] leading-relaxed text-faint">
          Describe a video or a still and the latest render will appear here.
        </p>
      </div>
    )
  }

  const active = asset.status === "queued" || asset.status === "running"
  const thumb = fileHref(asset.thumbPath)
  const download = fileHref(asset.filePath)
  const progress = clampProgress(job?.progress)
  const duration = assetDuration(asset)
  const aspect = assetAspect(asset)
  const voice = assetVoice(asset)
  const sceneCount = asset.spec?.scenes?.length

  return (
    <div className="rounded-card border border-line bg-white/[0.02] p-3">
      <div className="flex items-start gap-2.5">
        <div className="relative size-11 shrink-0 overflow-hidden rounded-[8px] border border-line bg-white/[0.03]">
          {thumb && asset.status === "done" ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={thumb} alt="" className="h-full w-full object-cover" />
          ) : (
            <div className="grid h-full place-items-center text-faint">
              {asset.kind === "video" ? (
                <Video className="size-4" aria-hidden="true" />
              ) : (
                <ImageIcon className="size-4" aria-hidden="true" />
              )}
            </div>
          )}
          {active ? (
            <div className="absolute inset-0 grid place-items-center bg-black/45">
              <Loader2 className="size-3.5 animate-spin text-accent" aria-hidden="true" />
            </div>
          ) : null}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <span className="font-mono text-[8px] uppercase tracking-[0.16em] text-faint">
              Current asset
            </span>
            <StatusPill status={asset.status} />
          </div>
          <p className="mt-1 line-clamp-2 text-[11px] font-medium leading-snug text-ink/90">
            {asset.spec?.title || asset.prompt}
          </p>
        </div>
      </div>

      {active ? (
        <div className="mt-2.5">
          <div className="mb-1 flex items-center justify-between gap-2 font-mono text-[8px] uppercase tracking-[0.12em] text-faint">
            <span className="truncate">{formatStage(job?.stage)}</span>
            <span className="tabular-nums">{job ? `${Math.round(progress)}%` : "···"}</span>
          </div>
          <Progress
            value={progress}
            active
            indeterminate={!job}
            label="Sidebar render progress"
          />
        </div>
      ) : null}

      {asset.status === "failed" && asset.error ? (
        <p className="mt-2 line-clamp-2 rounded-[6px] border border-danger/20 bg-danger/[0.05] px-2 py-1.5 text-[9.5px] leading-relaxed text-danger/90">
          {asset.error}
        </p>
      ) : null}

      <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2.5 border-t border-line pt-2.5">
        <Meta label={asset.kind === "video" ? "Aspect" : "Frame"} value={aspect} />
        <Meta
          label={asset.kind === "video" ? "Duration" : "Format"}
          value={asset.kind === "video" ? (duration ? `${duration}s` : "—") : "PNG"}
        />
        <Meta
          label="Voice"
          value={asset.kind === "video" ? (voice === "narrator" ? "Narrator" : voice ? "Silent" : "—") : "—"}
        />
        <Meta label="Scenes" value={sceneCount ? String(sceneCount) : "—"} />
      </dl>

      <div className="mt-2.5 flex items-center gap-1.5">
        <Button
          variant="secondary"
          size="sm"
          onClick={onJump}
          className="h-7 flex-1 px-2 text-[10px] text-muted"
        >
          <ArrowUpRight className="size-3" aria-hidden="true" />
          View in chat
        </Button>
        {asset.status === "done" && download ? (
          <a
            href={download}
            download
            aria-label="Download current asset"
            title="Download"
            className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "h-7 w-7 px-0 text-faint")}
          >
            <Download className="size-3" aria-hidden="true" />
          </a>
        ) : null}
      </div>
    </div>
  )
}
