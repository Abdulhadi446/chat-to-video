"use client"

import { ArrowUpRight, ImageIcon, Sparkles, Video } from "lucide-react"
import { cn } from "@/lib/utils"
import type { RenderSettings } from "@/components/chat/api"

export interface ExamplePrompt {
  id: string
  label: string
  text: string
  kind: "video" | "image"
  settings: RenderSettings
}

const prompts: ExamplePrompt[] = [
  {
    id: "coffee",
    label: "Coffee spot",
    text: "A calm 10s coffee ad: warm morning light, a slow pour-over, narrator says “Start slower.”",
    kind: "video",
    settings: { duration: 10, aspect: "9:16", voice: "narrator" },
  },
  {
    id: "drift",
    label: "Shoe launch",
    text: "A 30s widescreen launch film for a running shoe called Drift. City at dawn, kinetic cuts, silent.",
    kind: "video",
    settings: { duration: 30, aspect: "16:9", voice: "silent" },
  },
  {
    id: "poster",
    label: "Poster still",
    text: "A square skincare poster: sage green, soft shadows, and one line of type: “Less, but better.”",
    kind: "image",
    settings: { duration: 10, aspect: "1:1", voice: "silent" },
  },
  {
    id: "quote",
    label: "Quote card",
    text: "A 10s vertical night-city quote card about slowing down. Serif type, bokeh lights, silent.",
    kind: "video",
    settings: { duration: 10, aspect: "9:16", voice: "silent" },
  },
]

export function EmptyState({
  disabled,
  onPrompt,
}: {
  disabled?: boolean
  onPrompt: (prompt: ExamplePrompt) => void
}) {
  return (
    <div className="flex min-h-full flex-1 items-center justify-center py-6 sm:py-10">
      <div className="w-full max-w-2xl">
        <div className="animate-rise">
          <p className="font-mono text-[8.5px] uppercase tracking-[0.2em] text-accent/85">
            New production
          </p>
          <h2 className="mt-2 text-[clamp(1.65rem,4.4vw,2.1rem)] font-semibold tracking-[-0.04em] text-ink">
            What are we making?
          </h2>
          <p className="mt-2 max-w-lg text-[12.5px] leading-relaxed text-muted">
            Describe it in plain language. Cue writes the storyboard, renders the file, and keeps
            every take in this chat.
          </p>
        </div>

        <div className="mt-6 grid grid-cols-2 gap-2.5">
          {prompts.map((prompt, index) => (
            <button
              key={prompt.id}
              type="button"
              disabled={disabled}
              onClick={() => onPrompt(prompt)}
              aria-label={`Start with example: ${prompt.label}`}
              className={cn(
                "animate-rise group flex flex-col rounded-card border border-line bg-panel/55 p-3 text-left transition-all duration-200",
                "hover:-translate-y-0.5 hover:border-accent/35 hover:bg-panel focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-bright",
                "disabled:pointer-events-none disabled:opacity-50",
              )}
              style={{ animationDelay: `${90 + index * 55}ms` }}
            >
              <span className="flex w-full items-center justify-between gap-2">
                <span className="flex min-w-0 items-center gap-1.5 font-mono text-[8px] uppercase tracking-[0.14em] text-faint">
                  {prompt.kind === "video" ? (
                    <Video className="size-2.5 shrink-0" aria-hidden="true" />
                  ) : (
                    <ImageIcon className="size-2.5 shrink-0" aria-hidden="true" />
                  )}
                  <span className="truncate">{prompt.label}</span>
                </span>
                <ArrowUpRight
                  className="size-3 shrink-0 text-accent opacity-0 transition-opacity duration-200 group-hover:opacity-100"
                  aria-hidden="true"
                />
              </span>
              <span className="mt-2 line-clamp-4 text-[11.5px] leading-snug text-ink/85">
                {prompt.text}
              </span>
              <span className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[7.5px] uppercase tracking-[0.1em] text-faint">
                <span>{prompt.settings.duration}s</span>
                <span aria-hidden="true">·</span>
                <span>{prompt.settings.aspect}</span>
                <span aria-hidden="true">·</span>
                <span>{prompt.settings.voice === "narrator" ? "narrator" : "silent"}</span>
              </span>
            </button>
          ))}
        </div>

        <p className="animate-rise mt-5 flex items-center gap-2 font-mono text-[8px] uppercase tracking-[0.13em] text-faint">
          <Sparkles className="size-3 shrink-0 text-accent/70" aria-hidden="true" />
          Or type your own brief — settings attach before sending
        </p>
      </div>
    </div>
  )
}
