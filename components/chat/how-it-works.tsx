import { ChevronDown, Workflow } from "lucide-react"

const steps = [
  {
    title: "Brief",
    body: "Your message is read for kind, topic, length, aspect and voice.",
  },
  {
    title: "Storyboard",
    body: "A model writes scenes, captions and a voice script as strict JSON.",
  },
  {
    title: "Route",
    body: "A difficulty check picks the local renderer or the agent path.",
  },
  {
    title: "Render",
    body: "FFmpeg cuts scenes, captions and optional Piper narration into an MP4 — or a designed PNG.",
  },
  {
    title: "Deliver",
    body: "The file lands in this chat with download and regenerate.",
  },
]

export function HowItWorks() {
  return (
    <details className="group mt-2 rounded-card border border-line bg-white/[0.015] transition-colors open:bg-white/[0.025]">
      <summary className="flex list-none items-center gap-2 rounded-card px-3 py-2.5 text-[11px] text-muted transition-colors hover:text-ink [&::-webkit-details-marker]:hidden">
        <Workflow className="size-3.5 shrink-0 text-faint" aria-hidden="true" />
        <span>How it works</span>
        <span className="ml-auto font-mono text-[8px] uppercase tracking-[0.14em] text-faint">
          5 steps
        </span>
        <ChevronDown
          className="size-3 shrink-0 text-faint transition-transform duration-200 group-open:rotate-180"
          aria-hidden="true"
        />
      </summary>
      <div className="border-t border-line px-3 pb-3 pt-2.5">
        <ol className="space-y-2.5">
          {steps.map((step, index) => (
            <li key={step.title} className="flex gap-2.5">
              <span className="mt-px font-mono text-[8px] leading-4 text-accent/80">
                0{index + 1}
              </span>
              <div className="min-w-0">
                <p className="text-[10px] font-medium leading-4 text-ink/85">{step.title}</p>
                <p className="text-[9.5px] leading-relaxed text-faint">{step.body}</p>
              </div>
            </li>
          ))}
        </ol>
        <p className="mt-3 border-t border-line pt-2 text-[9px] leading-relaxed text-faint">
          Simple briefs render locally. Hard ones try the agent first and fall back automatically —
          you always get a file.
        </p>
      </div>
    </details>
  )
}
