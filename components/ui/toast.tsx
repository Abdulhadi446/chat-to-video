"use client"

import { AlertCircle, Check, Info, X } from "lucide-react"
import { cn } from "@/lib/utils"

export type ToastTone = "success" | "error" | "info"

export interface ToastItem {
  id: number
  title: string
  description?: string
  tone?: ToastTone
}

const toneStyle: Record<ToastTone, { icon: React.ReactNode; accent: string }> = {
  success: {
    icon: <Check className="size-3.5" aria-hidden="true" />,
    accent: "text-emerald",
  },
  error: {
    icon: <AlertCircle className="size-3.5" aria-hidden="true" />,
    accent: "text-danger",
  },
  info: {
    icon: <Info className="size-3.5" aria-hidden="true" />,
    accent: "text-accent-bright",
  },
}

export function ToastViewport({
  toasts,
  onDismiss,
}: {
  toasts: ToastItem[]
  onDismiss: (id: number) => void
}) {
  if (!toasts.length) return null

  return (
    <div className="pointer-events-none fixed inset-x-3 top-3 z-[95] flex flex-col items-stretch gap-2 sm:left-auto sm:right-4 sm:top-4 sm:w-[340px]">
      {toasts.map((toast) => {
        const tone = toast.tone ?? "info"
        const style = toneStyle[tone]
        return (
          <div
            key={toast.id}
            role={tone === "error" ? "alert" : "status"}
            className="pointer-events-auto flex items-start gap-3 rounded-[12px] border border-line-strong bg-panel-raised/95 p-3.5 shadow-[0_18px_50px_-20px_rgba(0,0,0,0.9)] backdrop-blur-md animate-rise"
          >
            <span
              className={cn(
                "mt-px grid size-6 shrink-0 place-items-center rounded-full border border-line bg-white/[0.04]",
                style.accent,
              )}
            >
              {style.icon}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[12.5px] font-medium leading-4 text-ink">{toast.title}</p>
              {toast.description ? (
                <p className="mt-1 text-[11.5px] leading-relaxed text-muted">{toast.description}</p>
              ) : null}
            </div>
            <button
              type="button"
              onClick={() => onDismiss(toast.id)}
              aria-label="Dismiss notification"
              className="-mr-1 -mt-1 grid size-7 shrink-0 place-items-center rounded-md text-faint transition-colors hover:bg-white/[0.06] hover:text-ink"
            >
              <X className="size-3.5" aria-hidden="true" />
            </button>
          </div>
        )
      })}
    </div>
  )
}
