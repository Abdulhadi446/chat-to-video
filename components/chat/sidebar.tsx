"use client"

import * as React from "react"
import { LogOut, MessageSquare, Plus, X } from "lucide-react"
import type { Chat, Job, User } from "@/lib/types"
import { Brand } from "@/components/brand"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { groupChats, relativeTime, type AssetWithJob } from "@/components/chat/api"
import { HowItWorks } from "@/components/chat/how-it-works"
import { SidebarAssetCard } from "@/components/chat/asset-panel"

function ChatRowSkeleton({ width }: { width: string }) {
  return (
    <div className="flex h-8 items-center gap-2 px-2.5">
      <span className="size-3 shrink-0 rounded-[3px] bg-white/[0.04]" />
      <span
        className="skeleton-sweep h-2 rounded-full bg-white/[0.045]"
        style={{ width }}
        aria-hidden="true"
      />
    </div>
  )
}

export function Sidebar({
  user,
  chats,
  chatsLoading,
  activeChatId,
  latestAsset,
  latestJob,
  open,
  onClose,
  onNewChat,
  creatingChat,
  onSelectChat,
  onLogout,
  loggingOut,
  onJumpToAsset,
}: {
  user: User
  chats: Chat[]
  chatsLoading: boolean
  activeChatId: string | null
  latestAsset: AssetWithJob | null
  latestJob: Job | null
  open: boolean
  onClose: () => void
  onNewChat: () => void
  creatingChat: boolean
  onSelectChat: (id: string) => void
  onLogout: () => void
  loggingOut: boolean
  onJumpToAsset: () => void
}) {
  const panelRef = React.useRef<HTMLElement>(null)
  const closeRef = React.useRef<HTMLButtonElement>(null)
  const [isDesktop, setIsDesktop] = React.useState(false)
  const groups = React.useMemo(() => groupChats(chats), [chats])

  React.useEffect(() => {
    const query = window.matchMedia("(min-width: 768px)")
    const update = () => setIsDesktop(query.matches)
    update()
    query.addEventListener("change", update)
    return () => query.removeEventListener("change", update)
  }, [])

  React.useEffect(() => {
    if (isDesktop && open) onClose()
  }, [isDesktop, open, onClose])

  React.useEffect(() => {
    if (!open) return

    const previouslyFocused = document.activeElement as HTMLElement | null
    closeRef.current?.focus()

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault()
        onClose()
        return
      }
      if (event.key !== "Tab" || !panelRef.current) return

      const focusable = panelRef.current.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), summary, [tabindex]:not([tabindex="-1"])',
      )
      if (focusable.length === 0) return

      const first = focusable[0]
      const last = focusable[focusable.length - 1]

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = "hidden"
    document.addEventListener("keydown", onKeyDown)

    return () => {
      document.removeEventListener("keydown", onKeyDown)
      document.body.style.overflow = previousOverflow
      previouslyFocused?.focus()
    }
  }, [open, onClose])

  return (
    <>
      <div
        className={cn(
          "fixed inset-0 z-40 bg-black/65 backdrop-blur-[2px] transition-opacity duration-300 md:hidden",
          open ? "opacity-100" : "pointer-events-none opacity-0",
        )}
        onClick={onClose}
        aria-hidden="true"
      />

      <aside
        ref={panelRef}
        aria-label="Studio sidebar"
        role={open ? "dialog" : undefined}
        aria-modal={open ? true : undefined}
        inert={!open && !isDesktop ? true : undefined}
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex w-[300px] max-w-[86vw] flex-col border-r border-line bg-canvas-soft transition-transform duration-300 ease-[cubic-bezier(.16,1,.3,1)] md:static md:z-auto md:w-[280px] md:max-w-none md:translate-x-0 md:shadow-none",
          open
            ? "translate-x-0 shadow-[24px_0_80px_-40px_rgba(0,0,0,0.9)]"
            : "-translate-x-full md:translate-x-0",
        )}
      >
        <div className="flex h-14 shrink-0 items-center justify-between px-4">
          <Brand onClick={onClose} />
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Close sidebar"
            className="grid size-8 place-items-center rounded-md text-faint transition-colors hover:bg-white/[0.06] hover:text-ink md:hidden"
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        </div>

        <div className="shrink-0 px-3 pb-1 pt-1">
          <Button
            variant="secondary"
            size="sm"
            onClick={onNewChat}
            loading={creatingChat}
            className="h-9 w-full justify-start gap-2.5 px-3 text-[12.5px]"
          >
            {creatingChat ? null : <Plus className="size-3.5 text-accent" aria-hidden="true" />}
            New chat
          </Button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex items-center justify-between px-4 pb-1 pt-3">
            <span className="font-mono text-[8.5px] uppercase tracking-[0.18em] text-faint">
              Production log
            </span>
            <span className="font-mono text-[8.5px] tabular-nums text-faint">{chats.length}</span>
          </div>

          <nav aria-label="Chat history" className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
            {chatsLoading ? (
              <div className="space-y-1 pt-1" aria-label="Loading chat history">
                <ChatRowSkeleton width="72%" />
                <ChatRowSkeleton width="58%" />
                <ChatRowSkeleton width="66%" />
                <ChatRowSkeleton width="48%" />
              </div>
            ) : groups.length === 0 ? (
              <div className="mx-1 mt-2 rounded-[9px] border border-dashed border-line p-3">
                <p className="text-[10.5px] leading-relaxed text-faint">
                  No chats yet. Describe a video or a still to start your first one.
                </p>
              </div>
            ) : (
              groups.map((group) => (
                <div key={group.label} className="pt-2.5 first:pt-1">
                  <p className="px-2.5 pb-1 font-mono text-[8px] uppercase tracking-[0.16em] text-faint/80">
                    {group.label}
                  </p>
                  <ul className="space-y-px">
                    {group.chats.map((chat) => {
                      const active = chat.id === activeChatId
                      return (
                        <li key={chat.id}>
                          <button
                            type="button"
                            onClick={() => onSelectChat(chat.id)}
                            aria-current={active ? "page" : undefined}
                            title={chat.title}
                            className={cn(
                              "group relative flex w-full items-center gap-2 rounded-[8px] px-2.5 py-[7px] text-left transition-colors",
                              active
                                ? "bg-white/[0.06] text-ink"
                                : "text-muted hover:bg-white/[0.035] hover:text-ink",
                            )}
                          >
                            {active ? (
                              <span
                                className="absolute left-0 top-1/2 h-3.5 w-[2px] -translate-y-1/2 rounded-full bg-accent"
                                aria-hidden="true"
                              />
                            ) : null}
                            <MessageSquare
                              className="size-3 shrink-0 opacity-50"
                              aria-hidden="true"
                            />
                            <span className="min-w-0 flex-1 truncate text-[11.5px] leading-4">
                              {chat.title || "Untitled chat"}
                            </span>
                            <span className="shrink-0 font-mono text-[8px] tabular-nums text-faint">
                              {relativeTime(chat.updatedAt)}
                            </span>
                          </button>
                        </li>
                      )
                    })}
                  </ul>
                </div>
              ))
            )}
          </nav>
        </div>

        <div className="max-h-[47dvh] shrink-0 overflow-y-auto overscroll-contain border-t border-line px-3 pb-2.5 pt-3">
          <SidebarAssetCard asset={latestAsset} job={latestJob} onJump={onJumpToAsset} />
          <HowItWorks />
        </div>

        <div className="shrink-0 border-t border-line p-3">
          <div className="flex items-center gap-2.5 rounded-[10px] px-1 py-0.5">
            <span className="grid size-7 shrink-0 place-items-center rounded-full border border-line bg-white/[0.05] text-[10px] font-medium uppercase text-muted">
              {user.email.charAt(0) || "C"}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[10.5px] text-ink/90" title={user.email}>
                {user.email}
              </p>
              <p className="font-mono text-[8px] uppercase tracking-[0.14em] text-faint">
                Studio account
              </p>
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={onLogout}
              loading={loggingOut}
              aria-label="Log out"
              title="Log out"
              className="size-8 text-faint hover:text-ink"
            >
              {loggingOut ? null : <LogOut className="size-3.5" aria-hidden="true" />}
            </Button>
          </div>
        </div>
      </aside>
    </>
  )
}
