"use client"

import * as React from "react"
import { AlertCircle } from "lucide-react"
import { cn } from "@/lib/utils"

export interface TextFieldProps extends React.ComponentProps<"input"> {
  label: string
  error?: string
  hint?: string
  icon?: React.ReactNode
  trailing?: React.ReactNode
}

export function TextField({
  label,
  error,
  hint,
  icon,
  trailing,
  className,
  id,
  ...props
}: TextFieldProps) {
  const generatedId = React.useId()
  const fieldId = id ?? generatedId
  const errorId = `${fieldId}-error`
  const hintId = `${fieldId}-hint`

  return (
    <div className="space-y-1.5">
      <label htmlFor={fieldId} className="block text-[12px] font-medium text-muted">
        {label}
      </label>
      <div
        className={cn(
          "relative flex items-center rounded-[10px] border bg-black/25 transition-[border-color,box-shadow,background-color] duration-150",
          error
            ? "border-danger/55 focus-within:ring-2 focus-within:ring-danger/15"
            : "border-line hover:border-white/15 focus-within:border-accent/55 focus-within:ring-2 focus-within:ring-accent/15",
        )}
      >
        {icon ? (
          <span className="pl-3 text-faint" aria-hidden="true">
            {icon}
          </span>
        ) : null}
        <input
          id={fieldId}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : hint ? hintId : undefined}
          className={cn(
            "h-11 w-full bg-transparent text-[14px] text-ink placeholder:text-faint/70 focus:outline-none focus-visible:outline-none",
            icon ? "pl-2.5 pr-3.5" : "px-3.5",
            trailing && "pr-11",
            className,
          )}
          {...props}
        />
        {trailing ? <span className="absolute right-1.5 top-1/2 -translate-y-1/2">{trailing}</span> : null}
      </div>
      {error ? (
        <p id={errorId} className="flex items-center gap-1.5 text-[11.5px] text-danger">
          <AlertCircle className="size-3 shrink-0" aria-hidden="true" />
          {error}
        </p>
      ) : hint ? (
        <p id={hintId} className="text-[11.5px] text-faint">
          {hint}
        </p>
      ) : null}
    </div>
  )
}
