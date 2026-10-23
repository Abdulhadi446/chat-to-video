"use client"

import * as React from "react"
import { AlertCircle, Clock3, Ratio, Send, Volume2, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import type { RenderSettings } from "@/components/chat/api"

const durations = [10, 30, 60] as const
const aspects = ["9:16", "16:9", "1:1"] as const
const voices = [
  { value: "silent", label: "Silent" },
  { value: "narrator", label: "Voice" },
] as const

function Chip({
  selected,
  onClick,
  children,
  title,
}: {
  selected: boolean
  onClick: () => void
  children: React.ReactNode
  title?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      title={title}
      className={cn(
        "h-[22px] rounded-[4px] px-1.5 font-mono text-[8.5px] uppercase tracking-[0.04em] transition-colors duration-150",
        selected
          ? "bg-white/[0.1] text-ink shadow-[inset_0_1px_0_rgba(255,255,255,0.07)]"
          : "text-faint hover:bg-white/[0.04] hover:text-muted",
      )}
    >
      {children}
    </button>
  )
}

function Group({
  label,
  icon,
  children,
}: {
  label: string
  icon: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className="flex shrink-0 items-center rounded-[6px] border border-line bg-black/25 p-[2px]"
    >
      <span className="hidden px-1 text-faint sm:inline" aria-hidden="true">
        {icon}
      </span>
      {children}
    </div>
  )
}

export function Composer({
  value,
  onChange,
  onSend,
  sending,
  disabled,
  settings,
  onSettingsChange,
  textareaRef,
  notice,
  onDismissNotice,
}: {
  value: string
  onChange: (value: string) => void
  onSend: () => void
  sending: boolean
  disabled?: boolean
  settings: RenderSettings
  onSettingsChange: (settings: RenderSettings) => void
  textareaRef: React.RefObject<HTMLTextAreaElement | null>
  notice: string | null
  onDismissNotice: () => void
}) {
  React.useEffect(() => {
    const element = textareaRef.current
    if (!element) return
    element.style.height = "0px"
    element.style.height = `${Math.min(180, Math.max(50, element.scrollHeight))}px`
  }, [value, textareaRef])

  function handleKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Enter" || (!event.metaKey && !event.ctrlKey)) return
    if (event.nativeEvent.isComposing) return
    event.preventDefault()
    if (!value.trim() || sending || disabled) return
    onSend()
  }

  const canSend = value.trim().length > 0 && !sending && !disabled

  return (
    <div className="relative z-20 shrink-0 border-t border-line bg-canvas/95 px-3 pb-[max(12px,env(safe-area-inset-bottom))] pt-3 backdrop-blur-md sm:px-6">
      <div className="mx-auto w-full max-w-3xl">
        {notice ? (
          <div
            role="alert"
            className="mb-2 flex items-start gap-2 rounded-[9px] border border-danger/20 bg-danger/[0.06] px-3 py-2"
          >
            <AlertCircle className="mt-px size-3.5 shrink-0 text-danger" aria-hidden="true" />
            <p className="min-w-0 flex-1 text-[11px] leading-relaxed text-danger">{notice}</p>
            <button
              type="button"
              onClick={onDismissNotice}
              aria-label="Dismiss error"
              className="-mr-0.5 grid size-5 shrink-0 place-items-center rounded text-danger/70 transition-colors hover:bg-danger/10 hover:text-danger"
            >
              <X className="size-3" aria-hidden="true" />
            </button>
          </div>
        ) : null}

        <div
          className={cn(
            "rounded-[16px] border bg-panel/90 shadow-[0_18px_50px_-30px_rgba(0,0,0,0.9)] transition-[border-color,box-shadow] duration-150",
            sending
              ? "border-accent/30"
              : "border-line-strong focus-within:border-accent/45 focus-within:ring-2 focus-within:ring-accent/10",
          )}
        >
          <textarea
            ref={textareaRef}
            value={value}
            onChange={(event) => onChange(event.target.value)}
            onKeyDown={handleKeyDown}
            rows={1}
            placeholder="Describe a video or a still…"
            aria-label="Describe what to make"
            className="block max-h-[180px] min-h-[50px] w-full resize-none bg-transparent px-3.5 pb-1 pt-3.5 text-[13.5px] leading-6 text-ink placeholder:text-faint/65 focus:outline-none focus-visible:outline-none sm:px-4"
          />

          <div className="flex items-center gap-2 px-2 pb-2 pt-0.5">
            <div className="no-scrollbar flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
              <Group label="Duration" icon={<Clock3 className="size-2.5" />}>
                {durations.map((duration) => (
                  <Chip
                    key={duration}
                    selected={settings.duration === duration}
                    onClick={() => onSettingsChange({ ...settings, duration })}
                    title={`${duration} second cut`}
                  >
                    {duration}s
                  </Chip>
                ))}
              </Group>

              <Group label="Aspect ratio" icon={<Ratio className="size-2.5" />}>
                {aspects.map((aspect) => (
                  <Chip
                    key={aspect}
                    selected={settings.aspect === aspect}
                    onClick={() => onSettingsChange({ ...settings, aspect })}
                    title={`${aspect} frame`}
                  >
                    {aspect}
                  </Chip>
                ))}
              </Group>

              <Group label="Voice" icon={<Volume2 className="size-2.5" />}>
                {voices.map((voice) => (
                  <Chip
                    key={voice.value}
                    selected={settings.voice === voice.value}
                    onClick={() => onSettingsChange({ ...settings, voice: voice.value })}
                    title={voice.value === "narrator" ? "Add narration" : "No voiceover"}
                  >
                    {voice.label}
                  </Chip>
                ))}
              </Group>
            </div>

            <Button
              type="button"
              size="icon"
              onClick={onSend}
              disabled={!canSend}
              loading={sending}
              aria-label="Send message"
              title="Send (⌘ or Ctrl + Enter)"
              className="size-8 shrink-0 rounded-[8px]"
            >
              {sending ? null : <Send className="size-3.5" aria-hidden="true" />}
            </Button>
          </div>
        </div>

        <div className="mt-2 flex items-center justify-between gap-3 px-1">
          <p className="truncate font-mono text-[8px] uppercase tracking-[0.11em] text-faint">
            Settings travel with your brief
          </p>
          <p className="hidden shrink-0 font-mono text-[8px] uppercase tracking-[0.11em] text-faint sm:block">
            ⌘ / Ctrl + ↵ to send
          </p>
        </div>
      </div>
    </div>
  )
}
