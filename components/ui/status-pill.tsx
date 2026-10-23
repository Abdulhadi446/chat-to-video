import { Check, CircleDashed, Loader2, TriangleAlert } from "lucide-react"
import type { JobStatus } from "@/lib/types"
import { cn } from "@/lib/utils"

const styles: Record<
  JobStatus,
  { label: string; className: string; icon: React.ReactNode }
> = {
  queued: {
    label: "Queued",
    className: "border-line-strong bg-white/[0.04] text-muted",
    icon: <CircleDashed className="size-2.5" aria-hidden="true" />,
  },
  running: {
    label: "Rendering",
    className: "border-amber/25 bg-amber/10 text-amber",
    icon: <Loader2 className="size-2.5 animate-spin" aria-hidden="true" />,
  },
  done: {
    label: "Ready",
    className: "border-emerald/25 bg-emerald/10 text-emerald",
    icon: <Check className="size-2.5" aria-hidden="true" />,
  },
  failed: {
    label: "Failed",
    className: "border-danger/25 bg-danger/10 text-danger",
    icon: <TriangleAlert className="size-2.5" aria-hidden="true" />,
  },
}

export function StatusPill({
  status,
  label,
  className,
  showIcon = true,
}: {
  status: JobStatus
  label?: string
  className?: string
  showIcon?: boolean
}) {
  const style = styles[status]
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-[3px] text-[10px] font-medium leading-none",
        style.className,
        className,
      )}
    >
      {showIcon ? style.icon : null}
      {label ?? style.label}
    </span>
  )
}
