"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { AlertCircle, Eye, EyeOff, Lock, Mail } from "lucide-react"
import { Button } from "@/components/ui/button"
import { TextField } from "@/components/ui/field"

type Mode = "login" | "register"

const copy = {
  login: {
    kicker: "Studio access",
    title: "Welcome back.",
    subtitle: "Sign in to pick up where your renders left off.",
    submit: "Sign in",
    submitLoading: "Signing in…",
    passwordHint: undefined as string | undefined,
    autoComplete: "current-password",
    footer: "New to Cue?",
    footerLink: "Create an account",
    footerHref: "/register",
  },
  register: {
    kicker: "New studio",
    title: "Set up your studio.",
    subtitle: "Every chat, storyboard and render, kept in one place.",
    submit: "Create account",
    submitLoading: "Creating account…",
    passwordHint: "At least 8 characters.",
    autoComplete: "new-password",
    footer: "Already have an account?",
    footerLink: "Sign in",
    footerHref: "/login",
  },
} satisfies Record<
  Mode,
  {
    kicker: string
    title: string
    subtitle: string
    submit: string
    submitLoading: string
    passwordHint?: string
    autoComplete: string
    footer: string
    footerLink: string
    footerHref: string
  }
>

interface Values {
  email: string
  password: string
  confirm: string
}

interface FieldErrors {
  email?: string
  password?: string
  confirm?: string
}

function validate(values: Values, mode: Mode): FieldErrors {
  const errors: FieldErrors = {}
  const email = values.email.trim()

  if (!email) errors.email = "Enter your email."
  else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.email = "That email doesn’t look right."

  if (!values.password) errors.password = "Enter your password."
  else if (mode === "register" && values.password.length < 8)
    errors.password = "Use at least 8 characters."

  if (mode === "register" && values.confirm !== values.password)
    errors.confirm = "Passwords don’t match."

  return errors
}

async function readJson(response: Response): Promise<Record<string, unknown> | null> {
  try {
    return (await response.json()) as Record<string, unknown>
  } catch {
    return null
  }
}

export function AuthForm({ mode }: { mode: Mode }) {
  const router = useRouter()
  const text = copy[mode]
  const [values, setValues] = React.useState<Values>({ email: "", password: "", confirm: "" })
  const [touched, setTouched] = React.useState<Record<string, boolean>>({})
  const [attempted, setAttempted] = React.useState(false)
  const [showPassword, setShowPassword] = React.useState(false)
  const [loading, setLoading] = React.useState(false)
  const [serverError, setServerError] = React.useState<string | null>(null)

  const errors = validate(values, mode)
  const showError = (field: keyof FieldErrors) =>
    attempted || touched[field] ? errors[field] : undefined

  function update(field: keyof Values) {
    return (event: React.ChangeEvent<HTMLInputElement>) => {
      setValues((current) => ({ ...current, [field]: event.target.value }))
      if (serverError) setServerError(null)
    }
  }

  function blur(field: keyof Values) {
    return () => setTouched((current) => ({ ...current, [field]: true }))
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setAttempted(true)
    if (Object.keys(validate(values, mode)).length > 0) return

    setLoading(true)
    setServerError(null)

    try {
      const response = await fetch(`/api/auth/${mode}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: values.email.trim().toLowerCase(),
          password: values.password,
        }),
      })
      const data = await readJson(response)

      if (!response.ok) {
        const fromServer =
          (typeof data?.error === "string" && data.error) ||
          (typeof data?.message === "string" && data.message)

        if (response.status === 401) {
          setServerError("That email and password combination doesn’t match our records.")
        } else if (response.status === 409) {
          setServerError("An account with that email already exists. Sign in instead.")
        } else {
          setServerError(fromServer || "We couldn’t complete that just now. Try again.")
        }
        return
      }

      router.push("/chat")
      router.refresh()
    } catch {
      setServerError("Couldn’t reach the studio. Check your connection and try again.")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="animate-rise w-full max-w-[400px]">
      <div className="relative overflow-hidden rounded-panel border border-line bg-panel/90 p-6 shadow-[0_40px_100px_-40px_rgba(0,0,0,0.95)] backdrop-blur-sm sm:p-7">
        <div
          className="pointer-events-none absolute inset-x-12 top-0 h-px bg-gradient-to-r from-transparent via-accent/60 to-transparent"
          aria-hidden="true"
        />

        <div className="mb-6">
          <p className="font-mono text-[9px] uppercase tracking-[0.2em] text-faint">{text.kicker}</p>
          <h1 className="mt-2 text-[26px] font-semibold leading-tight tracking-[-0.035em] text-ink">
            {text.title}
          </h1>
          <p className="mt-1.5 text-[12.5px] leading-relaxed text-muted">{text.subtitle}</p>
        </div>

        {serverError ? (
          <div
            role="alert"
            className="mb-4 flex items-start gap-2.5 rounded-[10px] border border-danger/25 bg-danger/[0.07] p-3"
          >
            <AlertCircle className="mt-px size-3.5 shrink-0 text-danger" aria-hidden="true" />
            <p className="text-[11.5px] leading-relaxed text-danger">{serverError}</p>
          </div>
        ) : null}

        <form onSubmit={onSubmit} noValidate className="space-y-4">
          <TextField
            label="Email"
            name="email"
            type="email"
            inputMode="email"
            autoComplete="email"
            autoCapitalize="none"
            spellCheck={false}
            placeholder="you@studio.com"
            icon={<Mail className="size-3.5" aria-hidden="true" />}
            value={values.email}
            onChange={update("email")}
            onBlur={blur("email")}
            error={showError("email")}
            required
          />

          <TextField
            label="Password"
            name="password"
            type={showPassword ? "text" : "password"}
            autoComplete={text.autoComplete}
            placeholder={mode === "register" ? "At least 8 characters" : "Your password"}
            icon={<Lock className="size-3.5" aria-hidden="true" />}
            value={values.password}
            onChange={update("password")}
            onBlur={blur("password")}
            error={showError("password")}
            hint={mode === "register" ? text.passwordHint : undefined}
            required
            trailing={
              <button
                type="button"
                onClick={() => setShowPassword((current) => !current)}
                aria-label={showPassword ? "Hide password" : "Show password"}
                aria-pressed={showPassword}
                className="grid size-8 place-items-center rounded-[7px] text-faint transition-colors hover:bg-white/[0.05] hover:text-ink"
              >
                {showPassword ? (
                  <EyeOff className="size-3.5" aria-hidden="true" />
                ) : (
                  <Eye className="size-3.5" aria-hidden="true" />
                )}
              </button>
            }
          />

          {mode === "register" ? (
            <TextField
              label="Confirm password"
              name="confirm-password"
              type={showPassword ? "text" : "password"}
              autoComplete="new-password"
              placeholder="Repeat your password"
              icon={<Lock className="size-3.5" aria-hidden="true" />}
              value={values.confirm}
              onChange={update("confirm")}
              onBlur={blur("confirm")}
              error={showError("confirm")}
              required
            />
          ) : null}

          <Button type="submit" size="lg" loading={loading} className="mt-1 w-full">
            {loading ? text.submitLoading : text.submit}
          </Button>
        </form>

        <div className="mt-6 border-t border-line pt-4 text-center text-[12px] text-faint">
          {text.footer}{" "}
          <Link
            href={text.footerHref}
            className="font-medium text-ink underline decoration-line-strong underline-offset-4 transition-colors hover:decoration-accent"
          >
            {text.footerLink}
          </Link>
        </div>
      </div>

      <p className="mt-4 text-center font-mono text-[9px] uppercase tracking-[0.16em] text-faint">
        You stay signed in for 30 days
      </p>
    </div>
  )
}
