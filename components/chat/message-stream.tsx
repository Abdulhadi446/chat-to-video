"use client"

import type { Job, Message } from "@/lib/types"
import { formatClock, splitSettings, type AssetWithJob } from "@/components/chat/api"
import { AssetBlock, AssistantAvatar } from "@/components/chat/asset-block"

function MessageItem({ message }: { message: Message }) {
  if (message.role === "system") {
    return (
      <div className="flex justify-center">
        <p className="rounded-full border border-line bg-white/[0.02] px-3 py-1 font-mono text-[8.5px] uppercase tracking-[0.12em] text-faint">
          {message.content}
        </p>
      </div>
    )
  }

  if (message.role === "user") {
    const { body, settings } = splitSettings(message.content)
    return (
      <div className="msg-in flex justify-end">
        <div className="max-w-[86%] sm:max-w-[76%]">
          <div className="rounded-[14px] rounded-br-[5px] border border-accent/25 bg-accent/[0.09] px-3.5 py-2.5 text-[13.5px] leading-relaxed text-ink shadow-[inset_0_1px_0_rgba(255,255,255,0.035)]">
            <p className="prose-chat whitespace-pre-wrap">{body}</p>
            {settings.length > 0 ? (
              <div className="mt-2 flex flex-wrap gap-1.5 border-t border-white/10 pt-2">
                {settings.map((setting) => (
                  <span
                    key={setting}
                    className="rounded-full border border-white/10 bg-black/20 px-2 py-[2px] font-mono text-[8px] uppercase tracking-[0.1em] text-muted"
                  >
                    {setting}
                  </span>
                ))}
              </div>
            ) : null}
          </div>
          <time
            dateTime={new Date(message.createdAt).toISOString()}
            className="mt-1 block pr-1 text-right font-mono text-[8px] uppercase tracking-[0.1em] text-faint"
          >
            {formatClock(message.createdAt)}
          </time>
        </div>
      </div>
    )
  }

  return (
    <div className="msg-in flex gap-3">
      <AssistantAvatar />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="text-[11px] font-medium text-ink">Cue</span>
          <time
            dateTime={new Date(message.createdAt).toISOString()}
            className="font-mono text-[8px] uppercase tracking-[0.1em] text-faint"
          >
            {formatClock(message.createdAt)}
          </time>
        </div>
        <p className="prose-chat mt-1 whitespace-pre-wrap text-[13.5px] leading-[1.75] text-ink/90">
          {message.content}
        </p>
      </div>
    </div>
  )
}

function metaAssetId(meta: Record<string, unknown> | null): string | null {
  if (!meta) return null
  if (typeof meta.assetId === "string") return meta.assetId
  if (typeof meta.asset_id === "string") return meta.asset_id
  return null
}

type TimelineItem =
  | { type: "message"; message: Message }
  | { type: "asset"; asset: AssetWithJob }

export function Timeline({
  messages,
  assets,
  jobs,
  retryingId,
  onRetry,
}: {
  messages: Message[]
  assets: AssetWithJob[]
  jobs: Record<string, Job>
  retryingId: string | null
  onRetry: (asset: AssetWithJob) => void
}) {
  const items = buildTimeline(messages, assets)

  return (
    <div className="space-y-5 pb-2">
      {items.map((item) =>
        item.type === "message" ? (
          <MessageItem key={`message-${item.message.id}`} message={item.message} />
        ) : (
          <AssetBlock
            key={`asset-${item.asset.id}`}
            asset={item.asset}
            job={jobs[item.asset.id] ?? item.asset.job ?? null}
            retryLoading={retryingId === item.asset.id}
            onRetry={onRetry}
          />
        ),
      )}
    </div>
  )
}

function buildTimeline(messages: Message[], assets: AssetWithJob[]): TimelineItem[] {
  const orderedMessages = [...messages].sort((a, b) => a.createdAt - b.createdAt)
  const orderedAssets = [...assets].sort((a, b) => a.createdAt - b.createdAt)
  const attached = new Map<string, AssetWithJob[]>()
  const tail: AssetWithJob[] = []

  for (const asset of orderedAssets) {
    const linked = orderedMessages.find((message) => metaAssetId(message.meta) === asset.id)
    if (linked) {
      const list = attached.get(linked.id) ?? []
      list.push(asset)
      attached.set(linked.id, list)
      continue
    }

    let nearestAssistant: Message | null = null
    let nearestDelta = Number.POSITIVE_INFINITY
    for (const message of orderedMessages) {
      if (message.role !== "assistant") continue
      const delta = Math.abs(message.createdAt - asset.createdAt)
      if (delta < nearestDelta) {
        nearestDelta = delta
        nearestAssistant = message
      }
    }

    if (nearestAssistant) {
      const list = attached.get(nearestAssistant.id) ?? []
      list.push(asset)
      attached.set(nearestAssistant.id, list)
    } else {
      tail.push(asset)
    }
  }

  const items: TimelineItem[] = []
  for (const message of orderedMessages) {
    items.push({ type: "message", message })
    for (const asset of attached.get(message.id) ?? []) {
      items.push({ type: "asset", asset })
    }
  }
  for (const asset of tail) items.push({ type: "asset", asset })

  return items
}

export function AssistantThinking() {
  return (
    <div className="msg-in flex items-center gap-3" role="status" aria-label="Cue is writing a reply">
      <AssistantAvatar />
      <div className="flex items-center gap-2 text-[10.5px] text-faint">
        <span className="flex items-center gap-1" aria-hidden="true">
          {[0, 1, 2].map((index) => (
            <span
              key={index}
              className="size-1 animate-pulse rounded-full bg-faint"
              style={{ animationDelay: `${index * 160}ms` }}
            />
          ))}
        </span>
        Writing the brief
      </div>
    </div>
  )
}

export function StreamSkeleton() {
  return (
    <div
      role="status"
      aria-label="Loading conversation"
      className="animate-pulse space-y-7 pt-2"
    >
      <span className="sr-only">Loading conversation…</span>
      <div className="flex justify-end">
        <div className="w-[64%] space-y-2">
          <div className="skeleton-sweep h-11 rounded-[14px] border border-line bg-white/[0.03]" />
          <div className="ml-auto h-1.5 w-10 rounded-full bg-white/[0.04]" />
        </div>
      </div>
      <div className="flex gap-3">
        <div className="size-6 shrink-0 rounded-[7px] bg-white/[0.04]" />
        <div className="flex-1 space-y-2.5 pt-1">
          <div className="h-1.5 w-16 rounded-full bg-white/[0.04]" />
          <div className="h-2.5 w-full rounded-full bg-white/[0.04]" />
          <div className="h-2.5 w-4/5 rounded-full bg-white/[0.04]" />
        </div>
      </div>
      <div className="rounded-panel border border-line p-4">
        <div className="skeleton-sweep h-32 rounded-[8px] bg-white/[0.025]" />
        <div className="mt-3 h-1.5 w-full rounded-full bg-white/[0.05]" />
        <div className="mt-2 h-1.5 w-1/3 rounded-full bg-white/[0.04]" />
      </div>
    </div>
  )
}
