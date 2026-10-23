import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Loader2 } from "lucide-react"
import { cn } from "@/lib/utils"

export const buttonVariants = cva(
  "inline-flex select-none items-center justify-center gap-2 whitespace-nowrap rounded-[10px] font-medium transition-[background-color,border-color,color,box-shadow,transform] duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-bright disabled:pointer-events-none disabled:opacity-45 active:translate-y-px",
  {
    variants: {
      variant: {
        primary:
          "bg-accent text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.18),0_10px_30px_-14px_rgba(139,92,246,0.9)] hover:bg-[#7f4ff0]",
        secondary:
          "border border-line-strong bg-white/[0.045] text-ink hover:border-white/20 hover:bg-white/[0.075]",
        ghost: "text-muted hover:bg-white/[0.05] hover:text-ink",
        danger:
          "border border-danger/25 bg-danger/10 text-danger hover:border-danger/40 hover:bg-danger/15",
      },
      size: {
        sm: "h-8 px-3 text-[12px]",
        md: "h-10 px-4 text-[13px]",
        lg: "h-11 px-5 text-[13.5px]",
        icon: "size-9",
      },
    },
    defaultVariants: {
      variant: "primary",
      size: "md",
    },
  },
)

export interface ButtonProps
  extends React.ComponentProps<"button">,
    VariantProps<typeof buttonVariants> {
  loading?: boolean
}

export function Button({
  className,
  variant,
  size,
  loading = false,
  disabled,
  children,
  type = "button",
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(buttonVariants({ variant, size }), className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading ? <Loader2 className="size-3.5 shrink-0 animate-spin" aria-hidden="true" /> : null}
      {children}
    </button>
  )
}
