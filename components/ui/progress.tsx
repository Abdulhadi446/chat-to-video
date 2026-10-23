import { cn } from "@/lib/utils"

const toneStyles = {
  accent: "bg-accent",
  emerald: "bg-emerald",
  amber: "bg-amber",
  danger: "bg-danger",
  muted: "bg-white/40",
} as const

export function Progress({
  value,
  tone = "accent",
  active = false,
  indeterminate = false,
  label = "Render progress",
  className,
}: {
  value: number
  tone?: keyof typeof toneStyles
  active?: boolean
  indeterminate?: boolean
  label?: string
  className?: string
}) {
  const clamped = Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0))

  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={indeterminate ? undefined : Math.round(clamped)}
      className={cn("relative h-1.5 w-full overflow-hidden rounded-full bg-white/[0.07]", className)}
    >
      <div
        className={cn(
          "h-full rounded-full transition-[width] duration-700 ease-out",
          toneStyles[tone],
          active && !indeterminate ? "progress-shimmer" : undefined,
          indeterminate && "progress-shimmer opacity-80",
        )}
        style={{ width: indeterminate ? "100%" : `${clamped}%` }}
      />
    </div>
  )
}
