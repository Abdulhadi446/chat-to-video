import type { Metadata, Viewport } from "next"
import "./globals.css"

export const metadata: Metadata = {
  title: {
    default: "Cue — Describe it. We render it.",
    template: "%s · Cue",
  },
  description:
    "Cue turns a plain-language brief into a finished MP4 or PNG — storyboard, voice, captions and render included.",
  applicationName: "Cue",
  icons: {
    icon: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='8' fill='%230a0a0f'/%3E%3Crect x='1.5' y='1.5' width='29' height='29' rx='6.5' fill='none' stroke='%238b5cf6' stroke-opacity='0.55'/%3E%3Cpath d='M13 10.5v11l9-5.5z' fill='%23f2efe6'/%3E%3C/svg%3E",
  },
}

export const viewport: Viewport = {
  themeColor: "#0a0a0f",
  colorScheme: "dark",
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-dvh bg-canvas font-sans text-ink antialiased">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:rounded-md focus:border focus:border-line-strong focus:bg-panel focus:px-3 focus:py-2 focus:text-sm focus:text-ink"
        >
          Skip to content
        </a>
        {children}
      </body>
    </html>
  )
}
