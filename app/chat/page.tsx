import type { Metadata } from "next"
import { ChatApp } from "@/components/chat/chat-app"

export const metadata: Metadata = {
  title: "Studio",
  description: "Describe a video, storyboard it, and render a real file.",
  robots: { index: false, follow: false },
}

export default function ChatPage() {
  return <ChatApp />
}
