import Link from "next/link"
import {
  ArrowRight,
  ArrowUpRight,
  Download,
  Layers,
  MessageSquare,
  Play,
  Sparkles,
  Wand2,
  Film,
} from "lucide-react"
import { Brand } from "@/components/brand"
import { buttonVariants } from "@/components/ui/button"
import { cn } from "@/lib/utils"

const steps = [
  {
    n: "01",
    title: "Chat",
    body: "Write the brief in plain language. Length, format and voice are part of the ask.",
    icon: MessageSquare,
  },
  {
    n: "02",
    title: "Storyboard",
    body: "Scenes, on-screen text, captions and a voice script are structured from your intent.",
    icon: Layers,
  },
  {
    n: "03",
    title: "Render",
    body: "A local FFmpeg pipeline returns a real MP4 or PNG — playable, downloadable, yours.",
    icon: Film,
  },
]

const sceneLines = [
  "Sunlight across the counter",
  "Pour-over, steam rising",
  "Hands around a ceramic cup",
  "Caption: start slower",
]

export default function Home() {
  return (
    <div className="relative flex min-h-dvh flex-col overflow-hidden">
      <div className="studio-ambient pointer-events-none absolute inset-0" aria-hidden="true" />
      <div className="studio-grid pointer-events-none absolute inset-0" aria-hidden="true" />

      <header className="relative z-10 mx-auto flex w-full max-w-6xl items-center justify-between px-5 py-5 sm:px-8">
        <Brand />
        <nav className="flex items-center gap-1.5 sm:gap-3" aria-label="Primary">
          <a
            href="#how"
            className="hidden rounded-md px-2.5 py-2 text-[12.5px] text-muted transition-colors hover:text-ink sm:inline-flex"
          >
            How it works
          </a>
          <Link
            href="/login"
            className="inline-flex rounded-md px-2.5 py-2 text-[12.5px] text-muted transition-colors hover:text-ink"
          >
            Sign in
          </Link>
          <Link
            href="/chat"
            className={cn(buttonVariants({ variant: "primary", size: "sm" }), "h-9 px-3.5")}
          >
            Open studio
            <ArrowRight className="size-3.5" aria-hidden="true" />
          </Link>
        </nav>
      </header>

      <main id="main" className="relative z-10 flex flex-1 flex-col justify-center">
        <section className="mx-auto w-full max-w-6xl px-5 pb-8 pt-6 sm:px-8 lg:pb-10 lg:pt-4">
          <div className="grid items-center gap-12 lg:grid-cols-[1.02fr_0.98fr] lg:gap-8">
            <div className="max-w-xl">
              <div className="animate-rise inline-flex items-center gap-2 rounded-full border border-line bg-white/[0.025] px-3 py-1.5 font-mono text-[9.5px] uppercase tracking-[0.18em] text-muted">
                <span className="live-dot" aria-hidden="true" />
                AI production studio
              </div>

              <h1
                className="animate-rise mt-5 text-[clamp(2.9rem,6vw,4.5rem)] font-semibold leading-[0.96] tracking-[-0.05em] text-ink"
                style={{ animationDelay: "70ms" }}
              >
                Describe it.
                <span className="mt-1 block">
                  We{" "}
                  <span className="font-serif font-normal italic tracking-[-0.035em] text-accent-bright">
                    render
                  </span>{" "}
                  it.
                </span>
              </h1>

              <p
                className="animate-rise mt-5 max-w-[43ch] text-[14.5px] leading-relaxed text-muted"
                style={{ animationDelay: "140ms" }}
              >
                One conversation replaces the timeline. Cue turns your brief into a storyboard,
                then a finished video or still — captions, voice and all.
              </p>

              <div
                className="animate-rise mt-7 flex flex-wrap items-center gap-3"
                style={{ animationDelay: "210ms" }}
              >
                <Link
                  href="/chat"
                  className={cn(buttonVariants({ variant: "primary", size: "lg" }), "group")}
                >
                  Open the studio
                  <ArrowRight
                    className="size-4 transition-transform duration-300 group-hover:translate-x-0.5"
                    aria-hidden="true"
                  />
                </Link>
                <a
                  href="#how"
                  className={cn(buttonVariants({ variant: "secondary", size: "lg" }), "text-muted")}
                >
                  <Sparkles className="size-3.5 text-accent" aria-hidden="true" />
                  See how it works
                </a>
              </div>

              <ul
                className="animate-rise mt-8 flex flex-wrap items-center gap-x-4 gap-y-2 font-mono text-[9.5px] uppercase tracking-[0.16em] text-faint"
                style={{ animationDelay: "280ms" }}
              >
                <li>10–60 second cuts</li>
                <li className="h-3 w-px bg-line-strong" aria-hidden="true" />
                <li>9:16 · 16:9 · 1:1</li>
                <li className="h-3 w-px bg-line-strong" aria-hidden="true" />
                <li>MP4 + PNG</li>
              </ul>
            </div>

            <div
              className="animate-rise relative mx-auto w-full max-w-[420px] lg:justify-self-end"
              style={{ animationDelay: "180ms" }}
              role="img"
              aria-label="Example of a storyboard and rendered video frame"
            >
              <div className="relative flex flex-col gap-4 sm:block sm:h-[560px]">
                {/* Storyboard sheet — the "before". */}
                <div className="relative ml-auto w-[86%] max-w-[300px] rotate-[-2.5deg] rounded-[14px] border border-line bg-panel/95 p-3 shadow-[0_24px_60px_-28px_rgba(0,0,0,0.9)] sm:absolute sm:right-0 sm:top-0 sm:w-[286px] sm:p-4">
                  <div className="flex items-center justify-between font-mono text-[8.5px] uppercase tracking-[0.18em] text-faint">
                    <span className="flex items-center gap-1.5 text-muted">
                      <Layers className="size-3" aria-hidden="true" />
                      Storyboard
                    </span>
                    <span>04 scenes</span>
                  </div>
                  <div className="mt-3 space-y-1.5">
                    {sceneLines.map((line, i) => (
                      <div
                        key={line}
                        className={cn(
                          "flex items-center gap-2 rounded-[7px] border px-2 py-1.5",
                          i === 0
                            ? "border-accent/30 bg-accent/[0.07]"
                            : "border-line/80 bg-white/[0.015]",
                        )}
                      >
                        <span className="font-mono text-[8px] text-faint">0{i + 1}</span>
                        <span className="truncate text-[9px] text-ink/70">{line}</span>
                        <span className="ml-auto shrink-0 font-mono text-[8px] text-faint">
                          2.5s
                        </span>
                      </div>
                    ))}
                  </div>
                  <div className="mt-3 flex items-center justify-between border-t border-line pt-2 font-mono text-[8px] uppercase tracking-[0.14em] text-faint">
                    <span className="flex items-center gap-1.5">
                      <Wand2 className="size-2.5" aria-hidden="true" />
                      voice / narrator
                    </span>
                    <span>est. 00:10</span>
                  </div>
                </div>

                {/* Output card — the "after". */}
                <div className="relative -mt-6 w-[62%] max-w-[220px] rotate-[1.5deg] rounded-[16px] border border-line-strong bg-panel p-2.5 shadow-[0_34px_90px_-28px_rgba(0,0,0,0.95)] transition-transform duration-500 hover:rotate-0 sm:absolute sm:bottom-0 sm:left-0 sm:mt-0 sm:w-[206px]">
                  <div className="mb-2 flex items-center justify-between px-1 font-mono text-[8px] uppercase tracking-[0.16em] text-faint">
                    <span className="flex items-center gap-1.5 text-muted">
                      <span className="size-1 rounded-full bg-emerald" aria-hidden="true" />
                      output
                    </span>
                    <span>9:16 · 00:10</span>
                  </div>

                  <div className="sample-frame relative overflow-hidden rounded-[12px] aspect-[9/16]">
                    <div className="relative z-10 flex h-full flex-col justify-between p-4">
                      <div className="flex items-start justify-between font-mono text-[7.5px] uppercase tracking-[0.16em] text-[#f2efe6]/55">
                        <span>Sable / No. 04</span>
                        <span>10s</span>
                      </div>

                      <div
                        className="absolute right-3 top-8 size-24 rounded-full bg-[radial-gradient(circle_at_34%_28%,#f7d9b8,#b17a50_52%,#573323)] opacity-90"
                        aria-hidden="true"
                      />

                      <div className="relative mt-auto">
                        <div className="h-px w-9 bg-[#f2efe6]/40" aria-hidden="true" />
                        <p className="mt-3 font-serif text-[21px] leading-[1.05] tracking-[-0.02em] text-[#f7f1e6] sm:text-[22px]">
                          Slow mornings,
                          <br />
                          poured by hand.
                        </p>
                        <p className="mt-3 font-mono text-[7px] uppercase tracking-[0.18em] text-[#f2efe6]/50">
                          single origin · brewed to order
                        </p>
                      </div>

                      <div className="mt-4 flex items-center justify-between border-t border-white/15 pt-2 font-mono text-[7px] uppercase tracking-[0.14em] text-white/45">
                        <span>Scene 01</span>
                        <span>00:00 — 00:03</span>
                      </div>
                    </div>
                  </div>

                  <div className="mt-2.5 flex items-center gap-2 px-1 pb-0.5">
                    <span className="grid size-5 place-items-center rounded-full bg-ink text-canvas">
                      <Play className="size-2.5 translate-x-px" fill="currentColor" aria-hidden="true" />
                    </span>
                    <div className="h-[2px] flex-1 rounded-full bg-white/10" aria-hidden="true">
                      <div className="h-full w-[38%] rounded-full bg-ink/70" />
                    </div>
                    <span className="font-mono text-[7.5px] text-faint">0:04</span>
                  </div>
                </div>

                <div className="absolute -left-1 top-0 hidden items-center gap-1.5 rounded-full border border-line bg-panel/90 px-2.5 py-1 font-mono text-[8px] uppercase tracking-[0.14em] text-muted shadow-lg backdrop-blur sm:flex">
                  <span className="live-dot" aria-hidden="true" />
                  render complete
                </div>

                <div className="absolute bottom-5 right-0 flex items-center gap-2 rounded-[10px] border border-line-strong bg-panel/95 px-2.5 py-2 shadow-[0_18px_50px_-20px_rgba(0,0,0,0.9)] backdrop-blur">
                  <span className="grid size-6 place-items-center rounded-[6px] bg-white/[0.06] text-accent">
                    <Download className="size-3" aria-hidden="true" />
                  </span>
                  <span>
                    <span className="block text-[10px] font-medium leading-tight text-ink">
                      final.mp4
                    </span>
                    <span className="block font-mono text-[7.5px] uppercase tracking-[0.12em] text-faint">
                      720 × 1280 · H.264
                    </span>
                  </span>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section
          id="how"
          aria-label="How it works"
          className="mx-auto w-full max-w-6xl scroll-mt-6 px-5 pb-7 sm:px-8"
        >
          <div className="grid overflow-hidden rounded-card border border-line bg-panel/50 sm:grid-cols-3">
            {steps.map((step, i) => (
              <div
                key={step.n}
                className={cn(
                  "group relative px-4 py-4 sm:px-5",
                  i > 0 && "border-t border-line sm:border-l sm:border-t-0",
                )}
              >
                <div className="flex items-center justify-between">
                  <span className="font-mono text-[9px] tracking-[0.2em] text-faint">{step.n}</span>
                  <step.icon
                    className="size-3.5 text-faint transition-colors duration-300 group-hover:text-accent"
                    aria-hidden="true"
                  />
                </div>
                <h2 className="mt-2 text-[12.5px] font-medium text-ink">{step.title}</h2>
                <p className="mt-1 text-[11.5px] leading-relaxed text-faint">{step.body}</p>
              </div>
            ))}
          </div>
        </section>
      </main>

      <footer className="relative z-10 mx-auto flex w-full max-w-6xl flex-col gap-2 border-t border-line px-5 py-4 text-[11px] text-faint sm:flex-row sm:items-center sm:justify-between sm:px-8">
        <p>
          <span className="text-muted">Cue</span> — an AI production studio for briefs, not
          timelines.
        </p>
        <div className="flex items-center gap-4">
          <a
            href="https://github.com/Abdulhadi446/chat-to-video"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 transition-colors hover:text-ink"
          >
            Repository
            <ArrowUpRight className="size-3" aria-hidden="true" />
          </a>
          <Link href="/login" className="transition-colors hover:text-ink">
            Sign in
          </Link>
        </div>
      </footer>
    </div>
  )
}
