import Link from "next/link"
import { ArrowLeft } from "lucide-react"
import { Brand } from "@/components/brand"

export function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative flex min-h-dvh flex-col overflow-hidden">
      <div className="studio-ambient pointer-events-none absolute inset-0" aria-hidden="true" />
      <div className="studio-grid pointer-events-none absolute inset-0" aria-hidden="true" />

      <header className="relative z-10 flex items-center justify-between px-5 py-5 sm:px-8">
        <Brand />
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 rounded-md text-[11.5px] text-faint transition-colors hover:text-ink"
        >
          <ArrowLeft className="size-3.5" aria-hidden="true" />
          Back to home
        </Link>
      </header>

      <main id="main" className="relative z-10 flex flex-1 items-center justify-center px-4 pb-10 pt-2">
        {children}
      </main>

      <footer className="relative z-10 px-5 pb-6 text-center font-mono text-[9px] uppercase tracking-[0.16em] text-faint">
        Rendered locally · MP4 and PNG · your files stay yours
      </footer>
    </div>
  )
}
