"use client"

import {
  Check,
  Clock3,
  Download,
  ImageIcon,
  Layers,
  Loader2,
  RotateCcw,
  TriangleAlert,
  Video,
  Volume2,
  VolumeX,
} from "lucide-react"
import type { Job } from "@/lib/types"
import { BrandGlyph } from "@/components/brand"
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
  formatClock,
  formatStage,
  kindLabel,
  type AssetWithJob,
} from "@/components/chat/api"

function Chip({ children, icon }: { children: React.ReactNode; icon?: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-line bg-white/[0.03] px-2 py-[3px] font-mono text-[8.5px] uppercase tracking-[0.1em] text-muted">
      {icon}
      {children}
    </span>
  )
}

function AssetMeta({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="font-mono text-[7.5px] uppercase tracking-[0.14em] text-faint">{label}</dt>
      <dd className="mt-0.5 truncate text-[10px] text-ink/85">{value}</dd>
    </div>
  )
}

function GeneratingCard({ asset, job }: { asset: AssetWithJob; job: Job | null }) {
  const aspect = assetAspect(asset)
  const isImage = asset.kind === "image"
  const progress = clampProgress(job?.progress)
  const stage = formatStage(job?.stage)
  const mode = job?.mode === "agent" ? "Agent path" : job ? "Local renderer" : "In production"
  const duration = assetDuration(asset)
  const scenes = asset.spec?.scenes?.length

  return (
    <div
      id={`asset-${asset.id}`}
      className="scroll-mt-24 overflow-hidden rounded-panel border border-line bg-panel/70"
    >
      <div className="flex items-center gap-3 border-b border-line px-4 py-3">
        <span className="grid size-8 shrink-0 place-items-center rounded-[8px] border border-accent/25 bg-accent/10 text-accent">
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[12.5px] font-medium text-ink">
            Rendering your {kindLabel(asset.kind)}
          </p>
          <p className="mt-0.5 truncate font-mono text-[8.5px] uppercase tracking-[0.12em] text-faint">
            {stage} · {mode}
          </p>
        </div>
        <span className="shrink-0 font-mono text-[11px] tabular-nums text-muted">
          {job ? `${Math.round(progress)}%` : "···"}
        </span>
      </div>

      <div className="grid gap-4 p-4 sm:grid-cols-[132px_1fr] sm:items-start">
        <div
          className="relative mx-auto w-full max-w-[132px] overflow-hidden rounded-[9px] border border-line bg-[#0b0b10]"
          style={{ aspectRatio: isImage ? "1 / 1" : aspect.replace(":", " / ") }}
        >
          <div
            className="absolute inset-0 bg-[linear-gradient(155deg,rgba(139,92,246,0.16),transparent_55%),linear-gradient(to_top,rgba(255,255,255,0.04),transparent_60%)]"
            aria-hidden="true"
          />
          <div className="skeleton-sweep absolute inset-0" aria-hidden="true" />
          <span className="absolute left-2.5 top-2.5 font-mono text-[7px] uppercase tracking-[0.16em] text-faint">
            Preview
          </span>
          <div className="absolute inset-x-2.5 bottom-2.5 space-y-1.5" aria-hidden="true">
            <div className="h-1.5 w-3/4 rounded-full bg-white/[0.09]" />
            <div className="h-1 w-1/2 rounded-full bg-white/[0.06]" />
          </div>
          <div className="absolute inset-0 grid place-items-center text-faint/60">
            {asset.kind === "video" ? (
              <Video className="size-5" aria-hidden="true" />
            ) : (
              <ImageIcon className="size-5" aria-hidden="true" />
            )}
          </div>
        </div>

        <div className="min-w-0">
          <Progress
            value={progress}
            active
            indeterminate={!job}
            label="Video render progress"
          />
          <p className="mt-2.5 text-[11.5px] leading-relaxed text-muted" role="status">
            {stage}. This card updates every couple of seconds — you can keep chatting.
          </p>

          <dl className="mt-3 grid grid-cols-3 gap-2 border-t border-line pt-2.5">
            <AssetMeta label={isImage ? "Frame" : "Aspect"} value={aspect} />
            <AssetMeta
              label={isImage ? "Format" : "Duration"}
              value={isImage ? "PNG" : duration ? `${duration}s` : "—"}
            />
            <AssetMeta label="Scenes" value={scenes ? String(scenes) : "—"} />
          </dl>
        </div>
      </div>
    </div>
  )
}

function ResultCard({
  asset,
  job,
  retryLoading,
  onRetry,
}: {
  asset: AssetWithJob
  job: Job | null
  retryLoading: boolean
  onRetry: (asset: AssetWithJob) => void
}) {
  const file = fileHref(asset.filePath)
  const thumb = fileHref(asset.thumbPath)
  const aspect = assetAspect(asset)
  const duration = assetDuration(asset)
  const voice = assetVoice(asset)
  const sceneCount = asset.spec?.scenes?.length
  const title = asset.spec?.title || asset.prompt || "Untitled output"
  const isVideo = asset.kind === "video"
  const ratio = aspect.replace(":", " / ")
  const widthClass =
    aspect === "9:16" ? "max-w-[272px]" : aspect === "1:1" ? "max-w-[392px]" : "max-w-full"

  if (!file) {
    return (
      <div
        id={`asset-${asset.id}`}
        className="scroll-mt-24 rounded-panel border border-amber/25 bg-amber/[0.04] p-4"
      >
        <div className="flex items-start gap-3">
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-amber" aria-hidden="true" />
          <div>
            <p className="text-[12.5px] font-medium text-ink">The file is missing</p>
            <p className="mt-1 text-[11.5px] leading-relaxed text-muted">
              This render finished without an output path. Regenerate it to produce a fresh file.
            </p>
            <Button
              variant="secondary"
              size="sm"
              className="mt-3"
              onClick={() => onRetry(asset)}
              loading={retryLoading}
            >
              <RotateCcw className="size-3" aria-hidden="true" />
              Regenerate
            </Button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div
      id={`asset-${asset.id}`}
      className="scroll-mt-24 overflow-hidden rounded-panel border border-line bg-panel/80"
    >
      <div className="flex items-center gap-2.5 border-b border-line px-4 py-3">
        <span className="grid size-7 shrink-0 place-items-center rounded-[7px] border border-emerald/20 bg-emerald/[0.08] text-emerald">
          <Check className="size-3.5" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[12.5px] font-medium text-ink">{title}</p>
          <p className="mt-0.5 truncate font-mono text-[8.5px] uppercase tracking-[0.12em] text-faint">
            {isVideo ? "Video" : "Still"} · {formatClock(asset.updatedAt)} ·{" "}
            {job?.mode === "agent" ? "agent path" : "local render"}
          </p>
        </div>
        <StatusPill status="done" label="Ready" />
      </div>

      <div className="p-3 sm:p-4">
        <div
          className={cn(
            "relative mx-auto overflow-hidden rounded-[10px] border border-line bg-black",
            widthClass,
          )}
          style={{ aspectRatio: ratio }}
        >
          {isVideo ? (
            <video
              controls
              playsInline
              preload="metadata"
              poster={thumb ?? undefined}
              className="h-full w-full bg-black object-contain"
              aria-label={title}
            >
              <source src={file} type="video/mp4" />
              Your browser can’t play this video.{" "}
              <a href={file} className="underline">
                Download it instead
              </a>
              .
            </video>
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={file}
              alt={title}
              className="h-full w-full bg-black object-contain"
              loading="lazy"
            />
          )}
        </div>

        <div className="mt-3 flex flex-col gap-3 border-t border-line pt-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-1.5">
            <Chip icon={isVideo ? <Video className="size-2.5" /> : <ImageIcon className="size-2.5" />}>
              {isVideo ? "MP4" : "PNG"}
            </Chip>
            <Chip>{aspect}</Chip>
            {isVideo && duration ? (
              <Chip icon={<Clock3 className="size-2.5" />}>{duration}s</Chip>
            ) : null}
            {isVideo && voice ? (
              <Chip icon={voice === "narrator" ? <Volume2 className="size-2.5" /> : <VolumeX className="size-2.5" />}>
                {voice === "narrator" ? "Narrator" : "Silent"}
              </Chip>
            ) : null}
            {sceneCount ? (
              <Chip icon={<Layers className="size-2.5" />}>
                {sceneCount} scene{sceneCount === 1 ? "" : "s"}
              </Chip>
            ) : null}
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onRetry(asset)}
              loading={retryLoading}
              className="h-8 flex-1 px-2 text-[11px] text-muted sm:flex-none"
              title="Render this brief again"
            >
              {retryLoading ? null : <RotateCcw className="size-3" aria-hidden="true" />}
              Regenerate
            </Button>
            <a
              href={file}
              download
              className={cn(
                buttonVariants({ variant: "primary", size: "sm" }),
                "h-8 flex-1 justify-center px-3 sm:flex-none",
              )}
            >
              <Download className="size-3" aria-hidden="true" />
              Download {isVideo ? "MP4" : "PNG"}
            </a>
          </div>
        </div>
      </div>
    </div>
  )
}

function FailedCard({
  asset,
  retryLoading,
  onRetry,
}: {
  asset: AssetWithJob
  retryLoading: boolean
  onRetry: (asset: AssetWithJob) => void
}) {
  return (
    <div
      id={`asset-${asset.id}`}
      className="scroll-mt-24 rounded-panel border border-danger/25 bg-danger/[0.035] p-4"
    >
      <div className="flex items-start gap-3">
        <span className="grid size-8 shrink-0 place-items-center rounded-[8px] border border-danger/25 bg-danger/10 text-danger">
          <TriangleAlert className="size-4" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="text-[12.5px] font-medium text-ink">Render failed</p>
            <StatusPill status="failed" />
          </div>
          <p className="mt-1.5 text-[11.5px] leading-relaxed text-muted">
            {asset.error || "The renderer stopped before writing a file. Give it another take."}
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => onRetry(asset)}
              loading={retryLoading}
            >
              <RotateCcw className="size-3" aria-hidden="true" />
              Try again
            </Button>
            <span className="font-mono text-[8.5px] uppercase tracking-[0.12em] text-faint">
              {assetAspect(asset)} · {kindLabel(asset.kind)}
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}

export function AssetBlock({
  asset,
  job,
  retryLoading,
  onRetry,
}: {
  asset: AssetWithJob
  job: Job | null
  retryLoading: boolean
  onRetry: (asset: AssetWithJob) => void
}) {
  if (asset.status === "failed") {
    return <FailedCard asset={asset} retryLoading={retryLoading} onRetry={onRetry} />
  }
  if (asset.status === "done") {
    return <ResultCard asset={asset} job={job} retryLoading={retryLoading} onRetry={onRetry} />
  }
  return <GeneratingCard asset={asset} job={job} />
}

export function AssistantAvatar() {
  return (
    <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-[7px] border border-line bg-white/[0.03] text-accent-bright">
      <BrandGlyph className="size-3 translate-x-px" />
    </span>
  )
}
