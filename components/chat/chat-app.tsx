"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { AlertCircle, Menu, Plus, RefreshCw } from "lucide-react"
import type { Chat, Job, Message, User } from "@/lib/types"
import { BrandMark } from "@/components/brand"
import { Button } from "@/components/ui/button"
import { StatusPill } from "@/components/ui/status-pill"
import { ToastViewport, type ToastItem } from "@/components/ui/toast"
import { Sidebar } from "@/components/chat/sidebar"
import { Composer } from "@/components/chat/composer"
import { EmptyState, type ExamplePrompt } from "@/components/chat/empty-state"
import { AssistantThinking, StreamSkeleton, Timeline } from "@/components/chat/message-stream"
import {
  api,
  ApiError,
  clampProgress,
  DEFAULT_SETTINGS,
  formatOutgoing,
  jobsFromAssets,
  jobsFromMessages,
  normalizeAsset,
  normalizeAssets,
  type AssetWithJob,
  type RenderSettings,
} from "@/components/chat/api"

export function ChatApp() {
  const router = useRouter()

  const [user, setUser] = React.useState<User | null>(null)
  const [booting, setBooting] = React.useState(true)
  const [chats, setChats] = React.useState<Chat[]>([])
  const [chatsLoading, setChatsLoading] = React.useState(true)
  const [activeChatId, setActiveChatId] = React.useState<string | null>(null)
  const [activeChat, setActiveChat] = React.useState<Chat | null>(null)
  const [messages, setMessages] = React.useState<Message[]>([])
  const [assets, setAssets] = React.useState<AssetWithJob[]>([])
  const [jobs, setJobs] = React.useState<Record<string, Job>>({})
  const [chatLoading, setChatLoading] = React.useState(true)
  const [chatError, setChatError] = React.useState<string | null>(null)
  const [sending, setSending] = React.useState(false)
  const [sendingChatId, setSendingChatId] = React.useState<string | null>(null)
  const [creatingChat, setCreatingChat] = React.useState(false)
  const [loggingOut, setLoggingOut] = React.useState(false)
  const [draft, setDraft] = React.useState("")
  const [settings, setSettings] = React.useState<RenderSettings>(DEFAULT_SETTINGS)
  const [sidebarOpen, setSidebarOpen] = React.useState(false)
  const [toasts, setToasts] = React.useState<ToastItem[]>([])
  const [notice, setNotice] = React.useState<string | null>(null)
  const [retryingId, setRetryingId] = React.useState<string | null>(null)

  const scrollRef = React.useRef<HTMLDivElement>(null)
  const textareaRef = React.useRef<HTMLTextAreaElement>(null)
  const activeChatRef = React.useRef<string | null>(null)
  const chatsRef = React.useRef<Chat[]>([])
  const jobsRef = React.useRef<Record<string, Job>>({})
  const stickRef = React.useRef(true)
  const loadSeq = React.useRef(0)
  const toastSeq = React.useRef(0)
  const notifiedJobs = React.useRef<Set<string>>(new Set())

  React.useEffect(() => {
    chatsRef.current = chats
  }, [chats])

  React.useEffect(() => {
    jobsRef.current = jobs
  }, [jobs])

  const pushToast = React.useCallback((toast: Omit<ToastItem, "id">) => {
    const id = ++toastSeq.current
    setToasts((current) => [...current.slice(-2), { ...toast, id }])
    window.setTimeout(() => {
      setToasts((current) => current.filter((item) => item.id !== id))
    }, 5500)
  }, [])

  const redirectToLogin = React.useCallback(() => {
    router.replace("/login")
  }, [router])

  const scrollToBottom = React.useCallback((behavior: ScrollBehavior = "smooth") => {
    const element = scrollRef.current
    if (!element) return
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches
    element.scrollTo({
      top: element.scrollHeight,
      behavior: reduceMotion ? "auto" : behavior,
    })
  }, [])

  const handleScroll = React.useCallback(() => {
    const element = scrollRef.current
    if (!element) return
    stickRef.current = element.scrollHeight - element.scrollTop - element.clientHeight < 160
  }, [])

  const refreshChats = React.useCallback(async () => {
    try {
      const data = await api.listChats()
      chatsRef.current = data.chats
      setChats(data.chats)
      setActiveChat((current) =>
        current ? (data.chats.find((chat) => chat.id === current.id) ?? current) : current,
      )
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) redirectToLogin()
    }
  }, [redirectToLogin])

  const openChat = React.useCallback(
    async (chatId: string) => {
      const sequence = ++loadSeq.current
      activeChatRef.current = chatId
      setActiveChatId(chatId)
      setSidebarOpen(false)
      setChatLoading(true)
      setChatError(null)
      setNotice(null)
      setMessages([])
      setAssets([])
      setJobs({})
      setActiveChat(chatsRef.current.find((chat) => chat.id === chatId) ?? null)

      try {
        const data = await api.getChat(chatId)
        if (sequence !== loadSeq.current) return
        const normalized = normalizeAssets(data.assets)
        const loadedMessages = data.messages ?? []
        setActiveChat(data.chat)
        setMessages(loadedMessages)
        setAssets(normalized)
        setJobs({
          ...jobsFromMessages(loadedMessages, normalized),
          ...jobsFromAssets(normalized),
        })
        setChatLoading(false)
        stickRef.current = true
        window.requestAnimationFrame(() => scrollToBottom("auto"))
      } catch (error) {
        if (sequence !== loadSeq.current) return
        if (error instanceof ApiError && error.status === 401) {
          redirectToLogin()
          return
        }
        setChatError(error instanceof Error ? error.message : "We couldn’t load this production.")
        setChatLoading(false)
      }
    },
    [redirectToLogin, scrollToBottom],
  )

  React.useEffect(() => {
    let alive = true

    void (async () => {
      try {
        const me = await api.me()
        if (!alive) return
        setUser(me.user)
        setBooting(false)

        try {
          const list = await api.listChats()
          if (!alive) return
          chatsRef.current = list.chats
          setChats(list.chats)
          setChatsLoading(false)
          if (list.chats.length > 0) {
            void openChat(list.chats[0].id)
          } else {
            setChatLoading(false)
          }
        } catch (error) {
          if (!alive) return
          if (error instanceof ApiError && error.status === 401) {
            redirectToLogin()
            return
          }
          setChatsLoading(false)
          setChatLoading(false)
          setChatError(
            error instanceof Error ? error.message : "We couldn’t load your production log.",
          )
        }
      } catch (error) {
        if (!alive) return
        if (error instanceof ApiError && error.status === 401) {
          redirectToLogin()
          return
        }
        setBooting(false)
        setChatsLoading(false)
        setChatLoading(false)
        setChatError(error instanceof Error ? error.message : "We couldn’t reach the studio.")
      }
    })()

    return () => {
      alive = false
    }
  }, [openChat, redirectToLogin])

  const newChat = React.useCallback(async () => {
    if (creatingChat) return
    setSidebarOpen(false)

    if (activeChat && messages.length === 0 && !chatLoading && !chatError) {
      window.requestAnimationFrame(() => textareaRef.current?.focus())
      return
    }

    setCreatingChat(true)
    setNotice(null)
    try {
      const { chat } = await api.createChat()
      loadSeq.current += 1
      activeChatRef.current = chat.id
      setActiveChatId(chat.id)
      setActiveChat(chat)
      const nextChats = [chat, ...chatsRef.current.filter((item) => item.id !== chat.id)]
      chatsRef.current = nextChats
      setChats(nextChats)
      setMessages([])
      setAssets([])
      setJobs({})
      setChatError(null)
      setChatLoading(false)
      setDraft("")
      stickRef.current = true
      window.requestAnimationFrame(() => textareaRef.current?.focus())
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        redirectToLogin()
        return
      }
      const message = error instanceof Error ? error.message : "We couldn’t start a new chat."
      setNotice(message)
      pushToast({ tone: "error", title: "New chat failed", description: message })
    } finally {
      setCreatingChat(false)
    }
  }, [
    activeChat,
    messages.length,
    chatLoading,
    chatError,
    creatingChat,
    redirectToLogin,
    pushToast,
  ])

  const selectChat = React.useCallback(
    (chatId: string) => {
      if (chatId === activeChatRef.current) {
        setSidebarOpen(false)
        return
      }
      void openChat(chatId)
    },
    [openChat],
  )

  const send = React.useCallback(
    async (rawText: string, override?: RenderSettings) => {
      const text = rawText.trim()
      if (!text || sending) return

      const effectiveSettings = override ?? settings
      const content = formatOutgoing(text, effectiveSettings)
      const tempId = `temp-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
      const optimistic: Message = {
        id: tempId,
        chatId: activeChatRef.current ?? "pending",
        role: "user",
        content,
        meta: null,
        createdAt: Date.now(),
      }

      setMessages((current) => [...current, optimistic])
      setDraft("")
      setNotice(null)
      setSending(true)
      setSendingChatId(activeChatRef.current)
      stickRef.current = true
      window.requestAnimationFrame(() => scrollToBottom("smooth"))

      let chatId = activeChatRef.current
      const originChatId = chatId

      try {
        if (!chatId) {
          const created = await api.createChat()
          const createdChatId = created.chat.id
          chatId = createdChatId
          activeChatRef.current = createdChatId
          setActiveChatId(createdChatId)
          setSendingChatId(createdChatId)
          setActiveChat(created.chat)
          const nextChats = [
            created.chat,
            ...chatsRef.current.filter((item) => item.id !== created.chat.id),
          ]
          chatsRef.current = nextChats
          setChats(nextChats)
          setChatLoading(false)
          setMessages((current) =>
            current.map((message) =>
              message.id === tempId ? { ...message, chatId: createdChatId } : message,
            ),
          )
        }

        const result = await api.sendMessage(chatId, content)

        if (activeChatRef.current === chatId) {
          setMessages((current) => {
            const withoutTemp = current.filter((message) => message.id !== tempId)
            const incoming = [result.userMessage, result.reply].filter(
              (message): message is Message =>
                Boolean(message && typeof message === "object" && "id" in message),
            )
            const knownIds = new Set(withoutTemp.map((message) => message.id))
            const merged = [
              ...withoutTemp,
              ...incoming.filter((message) => !knownIds.has(message.id)),
            ]
            merged.sort((a, b) => a.createdAt - b.createdAt)
            return merged
          })

          if (result.asset) {
            const asset = normalizeAsset(result.asset)
            setAssets((current) => [...current.filter((item) => item.id !== asset.id), asset])
            const recovered = jobsFromMessages(
              result.reply ? [result.reply] : [],
              [asset],
            )
            const job = result.job ?? asset.job ?? recovered[asset.id] ?? null
            if (job) setJobs((current) => ({ ...current, [asset.id]: job }))
          }
        }

        void refreshChats()
      } catch (error) {
        const stillHere = activeChatRef.current === (chatId ?? originChatId)

        if (error instanceof ApiError && error.status === 401) {
          redirectToLogin()
          return
        }

        const message = error instanceof Error ? error.message : "That message didn’t send."
        if (stillHere) {
          setMessages((current) => current.filter((item) => item.id !== tempId))
          setDraft((current) => (current.trim().length > 0 ? current : rawText))
          setNotice(message)
        }
        pushToast({ tone: "error", title: "Message not sent", description: message })
      } finally {
        setSending(false)
        setSendingChatId(null)
        window.requestAnimationFrame(() => {
          if (stickRef.current) scrollToBottom("smooth")
        })
      }
    },
    [sending, settings, redirectToLogin, refreshChats, pushToast, scrollToBottom],
  )

  const retryAsset = React.useCallback(
    async (asset: AssetWithJob) => {
      if (retryingId) return
      setRetryingId(asset.id)
      setNotice(null)
      try {
        const { job } = await api.retryAsset(asset.id)
        notifiedJobs.current.delete(job.id)
        setJobs((current) => ({ ...current, [asset.id]: job }))
        setAssets((current) =>
          current.map((item) =>
            item.id === asset.id
              ? { ...item, status: job.status, error: null, updatedAt: Date.now() }
              : item,
          ),
        )
        pushToast({
          tone: "info",
          title: "Re-render queued",
          description: "The card will update as this take renders.",
        })
      } catch (error) {
        if (error instanceof ApiError && error.status === 409) {
          const payload = error.data as { job?: Job } | null
          if (payload?.job) {
            const existingJob = payload.job
            notifiedJobs.current.delete(existingJob.id)
            setJobs((current) => ({ ...current, [asset.id]: existingJob }))
            setAssets((current) =>
              current.map((item) =>
                item.id === asset.id
                  ? { ...item, status: existingJob.status, error: null }
                  : item,
              ),
            )
            pushToast({
              tone: "info",
              title: "Already rendering",
              description: "This asset already has an active take. It will update here.",
            })
            return
          }
        }

        if (error instanceof ApiError && error.status === 401) {
          redirectToLogin()
          return
        }
        const message = error instanceof Error ? error.message : "We couldn’t queue a new render."
        setNotice(message)
        pushToast({ tone: "error", title: "Regenerate failed", description: message })
      } finally {
        setRetryingId(null)
      }
    },
    [retryingId, redirectToLogin, pushToast],
  )

  const activeJobKey = React.useMemo(
    () =>
      Object.values(jobs)
        .filter((job) => job.status === "queued" || job.status === "running")
        .map((job) => `${job.id}:${job.status}:${job.assetId}`)
        .sort()
        .join("|"),
    [jobs],
  )

  React.useEffect(() => {
    if (!activeJobKey) return
    let cancelled = false
    let timer: number | undefined

    const poll = async () => {
      const active = Object.values(jobsRef.current).filter(
        (job) => job.status === "queued" || job.status === "running",
      )
      if (!active.length || cancelled) return

      const settled = await Promise.allSettled(
        active.map(async (job) => ({ requested: job, data: await api.getJob(job.id) })),
      )
      if (cancelled) return

      for (let index = 0; index < settled.length; index += 1) {
        const entry = settled[index]
        const requested = active[index]

        if (entry.status === "rejected") {
          if (entry.reason instanceof ApiError && entry.reason.status === 401) {
            redirectToLogin()
            return
          }
          // A recovered job id can go stale after a retry. Drop it so the
          // chat-level fallback poll can pick the render back up.
          if (entry.reason instanceof ApiError && entry.reason.status === 404) {
            setJobs((current) => {
              if (current[requested.assetId]?.id !== requested.id) return current
              const next = { ...current }
              delete next[requested.assetId]
              return next
            })
          }
          continue
        }

        const { data } = entry.value
        const nextJob: Job = {
          ...requested,
          ...data.job,
          assetId: data.job?.assetId ?? requested.assetId,
        }
        const refreshedAsset = data.asset ? normalizeAsset(data.asset) : null

        if (refreshedAsset) {
          setAssets((current) =>
            current.map((item) =>
              item.id === refreshedAsset.id ? { ...item, ...refreshedAsset } : item,
            ),
          )
        }

        const jobFinished = nextJob.status === "done" || nextJob.status === "failed"
        const assetStillActive =
          refreshedAsset?.status === "queued" || refreshedAsset?.status === "running"

        // A retry gets a new job id, but the assistant message still points at
        // the previous one. If that old job is finished while the asset is
        // still rendering, drop it and let chat polling pick up the real state.
        if (jobFinished && assetStillActive) {
          setJobs((current) => {
            if (current[requested.assetId]?.id !== requested.id) return current
            const next = { ...current }
            delete next[requested.assetId]
            return next
          })
          continue
        }

        setJobs((current) => ({ ...current, [nextJob.assetId]: nextJob }))

        const finalStatus = refreshedAsset?.status
        const assetFinished = finalStatus === "done" || finalStatus === "failed"
        if (assetFinished && !notifiedJobs.current.has(nextJob.id)) {
          notifiedJobs.current.add(nextJob.id)
          if (finalStatus === "done") {
            pushToast({
              tone: "success",
              title: "Render ready",
              description: "Your output is in the chat — play it or download the file.",
            })
          } else {
            pushToast({
              tone: "error",
              title: "Render failed",
              description:
                refreshedAsset?.error ||
                nextJob.log?.slice(0, 140) ||
                "Open the card to try again.",
            })
          }
          void refreshChats()
        }
      }

      if (!cancelled) timer = window.setTimeout(poll, 2000)
    }

    timer = window.setTimeout(poll, 600)
    return () => {
      cancelled = true
      if (timer) window.clearTimeout(timer)
    }
  }, [activeJobKey, pushToast, redirectToLogin, refreshChats])

  const orphanAssetKey = React.useMemo(
    () =>
      assets
        .filter(
          (asset) =>
            (asset.status === "queued" || asset.status === "running") && !jobs[asset.id],
        )
        .map((asset) => asset.id)
        .sort()
        .join("|"),
    [assets, jobs],
  )

  React.useEffect(() => {
    if (!orphanAssetKey || !activeChatId) return
    let cancelled = false
    let timer: number | undefined

    const poll = async () => {
      try {
        const data = await api.getChat(activeChatId)
        if (cancelled || activeChatRef.current !== activeChatId) return
        const normalized = normalizeAssets(data.assets)
        setAssets(normalized)
        const embedded = jobsFromAssets(normalized)
        if (Object.keys(embedded).length > 0) {
          setJobs((current) => ({ ...current, ...embedded }))
        }
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) {
          redirectToLogin()
          return
        }
      }
      if (!cancelled) timer = window.setTimeout(poll, 3000)
    }

    timer = window.setTimeout(poll, 1600)
    return () => {
      cancelled = true
      if (timer) window.clearTimeout(timer)
    }
  }, [orphanAssetKey, activeChatId, redirectToLogin])

  React.useEffect(() => {
    if (!stickRef.current) return
    const frame = window.requestAnimationFrame(() => scrollToBottom("smooth"))
    return () => window.cancelAnimationFrame(frame)
  }, [messages.length, assets.length, scrollToBottom])

  const logout = React.useCallback(async () => {
    setLoggingOut(true)
    try {
      await api.logout()
    } catch {
      // The cookie may already be gone; still leave the studio.
    } finally {
      router.replace("/login")
      router.refresh()
    }
  }, [router])

  const latestAsset = React.useMemo(
    () =>
      assets.reduce<AssetWithJob | null>((latest, asset) => {
        if (!latest) return asset
        const latestTime = latest.updatedAt || latest.createdAt
        const assetTime = asset.updatedAt || asset.createdAt
        return assetTime > latestTime ? asset : latest
      }, null),
    [assets],
  )

  const latestJob = latestAsset ? (jobs[latestAsset.id] ?? latestAsset.job ?? null) : null

  const closeSidebar = React.useCallback(() => {
    setSidebarOpen(false)
  }, [])

  const jumpToAsset = React.useCallback(() => {
    if (!latestAsset) return
    setSidebarOpen(false)
    window.setTimeout(() => {
      const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches
      document.getElementById(`asset-${latestAsset.id}`)?.scrollIntoView({
        behavior: reduceMotion ? "auto" : "smooth",
        block: "center",
      })
    }, 140)
  }, [latestAsset])

  const handlePrompt = React.useCallback(
    (prompt: ExamplePrompt) => {
      setSettings(prompt.settings)
      void send(prompt.text, prompt.settings)
    },
    [send],
  )

  if (booting) return <BootScreen />
  if (!user) {
    return (
      <FatalScreen
        message={chatError ?? "Something interrupted the session. Sign in again to continue."}
        onRetry={() => window.location.reload()}
        onSignIn={() => router.replace("/login")}
      />
    )
  }

  const hasContent = messages.length > 0 || assets.length > 0
  const rawTitle = activeChat?.title?.trim()
  const chatTitle = !rawTitle || rawTitle === "New chat" ? "New production" : rawTitle
  const sendingHere = sending && sendingChatId === activeChatId
  const runningLabel =
    latestAsset?.status === "running" && latestJob
      ? `Rendering ${Math.round(clampProgress(latestJob.progress))}%`
      : undefined

  return (
    <div className="relative flex h-dvh overflow-hidden bg-canvas">
      <Sidebar
        user={user}
        chats={chats}
        chatsLoading={chatsLoading}
        activeChatId={activeChatId}
        latestAsset={latestAsset}
        latestJob={latestJob}
        open={sidebarOpen}
        onClose={closeSidebar}
        onNewChat={() => void newChat()}
        creatingChat={creatingChat}
        onSelectChat={selectChat}
        onLogout={() => void logout()}
        loggingOut={loggingOut}
        onJumpToAsset={jumpToAsset}
      />

      <div className="relative flex min-w-0 flex-1 flex-col">
        <div
          className="pointer-events-none absolute inset-x-0 top-0 h-48 bg-[radial-gradient(760px_220px_at_58%_-30%,rgba(139,92,246,0.06),transparent_72%)]"
          aria-hidden="true"
        />

        <header className="relative z-20 flex h-14 shrink-0 items-center gap-2 border-b border-line bg-canvas/80 px-3 backdrop-blur-md sm:px-4">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setSidebarOpen(true)}
            aria-label="Open sidebar"
            className="size-8 shrink-0 md:hidden"
          >
            <Menu className="size-4" aria-hidden="true" />
          </Button>

          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h1 className="truncate text-[12.5px] font-medium text-ink">{chatTitle}</h1>
              {latestAsset ? (
                <StatusPill
                  status={latestAsset.status}
                  label={runningLabel}
                  className="sm:hidden"
                />
              ) : null}
            </div>
            <p className="mt-0.5 hidden truncate font-mono text-[8px] uppercase tracking-[0.14em] text-faint sm:block">
              {sendingHere
                ? "Writing the brief…"
                : activeChat
                  ? `Production · ${messages.length} message${messages.length === 1 ? "" : "s"}`
                  : "New production · describe a brief"}
            </p>
          </div>

          {latestAsset ? (
            <StatusPill
              status={latestAsset.status}
              label={runningLabel}
              className="hidden sm:inline-flex"
            />
          ) : null}

          <Button
            variant="ghost"
            size="icon"
            onClick={() => void newChat()}
            loading={creatingChat}
            aria-label="New chat"
            title="New chat"
            className="size-8 shrink-0 text-faint hover:text-ink"
          >
            {creatingChat ? null : <Plus className="size-4" aria-hidden="true" />}
          </Button>
        </header>

        <main id="main" className="relative flex min-h-0 flex-1 flex-col">
          <div
            ref={scrollRef}
            onScroll={handleScroll}
            className="relative min-h-0 flex-1 overflow-y-auto overscroll-contain"
          >
            <div className="mx-auto flex min-h-full w-full max-w-3xl flex-col px-4 pb-8 pt-5 sm:px-6">
              {chatLoading ? (
                <StreamSkeleton />
              ) : chatError ? (
                <LoadError
                  message={chatError}
                  title={
                    activeChatId ? "This production didn’t open" : "The studio didn’t load"
                  }
                  onRetry={() =>
                    activeChatId ? void openChat(activeChatId) : window.location.reload()
                  }
                />
              ) : !hasContent ? (
                <EmptyState disabled={sending} onPrompt={handlePrompt} />
              ) : (
                <div className="flex flex-1 flex-col">
                  <Timeline
                    messages={messages}
                    assets={assets}
                    jobs={jobs}
                    retryingId={retryingId}
                    onRetry={(asset) => void retryAsset(asset)}
                  />
                  {sendingHere ? (
                    <div className="mt-5">
                      <AssistantThinking />
                    </div>
                  ) : null}
                </div>
              )}
            </div>
          </div>

          <Composer
            value={draft}
            onChange={setDraft}
            onSend={() => void send(draft)}
            sending={sending}
            disabled={chatLoading || Boolean(chatError)}
            settings={settings}
            onSettingsChange={setSettings}
            textareaRef={textareaRef}
            notice={notice}
            onDismissNotice={() => setNotice(null)}
          />
        </main>
      </div>

      <ToastViewport
        toasts={toasts}
        onDismiss={(id) => setToasts((current) => current.filter((item) => item.id !== id))}
      />
    </div>
  )
}

function BootScreen() {
  return (
    <main
      id="main"
      className="relative flex h-dvh items-center justify-center overflow-hidden bg-canvas"
    >
      <div className="studio-ambient pointer-events-none absolute inset-0" aria-hidden="true" />
      <div className="studio-grid pointer-events-none absolute inset-0" aria-hidden="true" />
      <div className="relative z-10 flex flex-col items-center" role="status">
        <BrandMark className="size-10 rounded-[12px]" />
        <div className="mt-5 h-1 w-28 overflow-hidden rounded-full bg-white/[0.08]">
          <div className="progress-shimmer h-full w-1/2 rounded-full bg-accent" />
        </div>
        <p className="mt-4 font-mono text-[8.5px] uppercase tracking-[0.2em] text-faint">
          Opening your studio
        </p>
      </div>
    </main>
  )
}

function FatalScreen({
  message,
  onRetry,
  onSignIn,
}: {
  message: string
  onRetry: () => void
  onSignIn: () => void
}) {
  return (
    <main
      id="main"
      className="relative flex h-dvh items-center justify-center overflow-hidden bg-canvas px-4"
    >
      <div className="studio-ambient pointer-events-none absolute inset-0" aria-hidden="true" />
      <div className="studio-grid pointer-events-none absolute inset-0" aria-hidden="true" />
      <div className="relative z-10 w-full max-w-[380px] rounded-panel border border-line bg-panel/90 p-6 text-center shadow-[0_40px_100px_-40px_rgba(0,0,0,0.95)]">
        <span className="mx-auto grid size-10 place-items-center rounded-full border border-danger/25 bg-danger/10 text-danger">
          <AlertCircle className="size-4" aria-hidden="true" />
        </span>
        <h1 className="mt-4 text-[18px] font-semibold tracking-[-0.03em] text-ink">
          We couldn’t open the studio
        </h1>
        <p className="mt-2 text-[12px] leading-relaxed text-muted">{message}</p>
        <div className="mt-5 flex items-center gap-2">
          <Button variant="secondary" size="md" onClick={onRetry} className="flex-1">
            <RefreshCw className="size-3.5" aria-hidden="true" />
            Try again
          </Button>
          <Button variant="primary" size="md" onClick={onSignIn} className="flex-1">
            Sign in
          </Button>
        </div>
      </div>
    </main>
  )
}

function LoadError({
  message,
  title,
  onRetry,
}: {
  message: string
  title: string
  onRetry: () => void
}) {
  return (
    <div className="flex min-h-full flex-1 items-center justify-center py-10">
      <div className="max-w-sm text-center">
        <span className="mx-auto grid size-10 place-items-center rounded-full border border-danger/25 bg-danger/10 text-danger">
          <AlertCircle className="size-4" aria-hidden="true" />
        </span>
        <h2 className="mt-4 text-[16px] font-medium tracking-[-0.02em] text-ink">{title}</h2>
        <p className="mt-2 text-[12px] leading-relaxed text-muted">{message}</p>
        <Button variant="secondary" size="md" onClick={onRetry} className="mt-4">
          <RefreshCw className="size-3.5" aria-hidden="true" />
          Try again
        </Button>
      </div>
    </div>
  )
}
