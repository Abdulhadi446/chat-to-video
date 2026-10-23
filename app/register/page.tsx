import type { Metadata } from "next"
import { AuthShell } from "@/components/auth/auth-shell"
import { AuthForm } from "@/components/auth/auth-form"

export const metadata: Metadata = {
  title: "Create account",
  description: "Create a Cue studio account to keep every chat and render.",
}

export default function RegisterPage() {
  return (
    <AuthShell>
      <AuthForm mode="register" />
    </AuthShell>
  )
}
