import Link from "next/link"
import { cn } from "@/lib/utils"

export function BrandGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className={className}>
      <path d="M9 6.8v10.4L17.6 12 9 6.8Z" fill="currentColor" />
    </svg>
  )
}

export function BrandMark({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "grid size-7 shrink-0 place-items-center rounded-[8px] border border-accent/40 bg-accent/10 text-ink",
        className,
      )}
    >
      <BrandGlyph className="size-3.5 translate-x-px" />
    </span>
  )
}

export function Brand({
  className,
  href = "/",
  showTag = true,
  onClick,
}: {
  className?: string
  href?: string
  showTag?: boolean
  onClick?: () => void
}) {
  return (
    <Link
      href={href}
      onClick={onClick}
      aria-label="Cue home"
      className={cn(
        "group inline-flex items-center gap-2.5 rounded-md text-ink transition-opacity hover:opacity-85",
        className,
      )}
    >
      <BrandMark />
      <span className="flex items-baseline gap-2">
        <span className="text-[15px] font-semibold tracking-[-0.03em]">Cue</span>
        {showTag ? (
          <span className="hidden rounded-[4px] border border-line px-1.5 py-px font-mono text-[9px] uppercase tracking-[0.16em] text-faint sm:inline">
            Studio
          </span>
        ) : null}
      </span>
    </Link>
  )
}
