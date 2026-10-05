// Chat log scroll: stick-to-bottom with a "Latest" escape. The log
// follows new frames only while stuck; scrolling up parks it.
import { useEffect, useRef, useState } from 'react'
import type { ToolPayload } from '../../data/useThreads'
import type { ChatMessage } from './messages'

export function useChatScroll({
  messages,
  pendingText,
  pendingTools,
  working,
}: {
  messages: ChatMessage[]
  pendingText: string | null
  pendingTools: Array<ToolPayload & { seenAt?: number }>
  working: boolean
}) {
  const logRef = useRef<HTMLDivElement>(null)
  const stuckRef = useRef(true)
  const [showLatest, setShowLatest] = useState(false)

  function stickToBottom() {
    const log = logRef.current
    if (log) log.scrollTop = log.scrollHeight
  }

  function resetScroll() {
    stuckRef.current = true
    setShowLatest(false)
  }

  function onLogScroll() {
    const log = logRef.current
    if (!log) return
    const stuck = log.scrollHeight - log.scrollTop - log.clientHeight < 48
    stuckRef.current = stuck
    setShowLatest(!stuck && log.scrollHeight > log.clientHeight)
  }

  useEffect(() => {
    if (stuckRef.current) stickToBottom()
  }, [messages, pendingText, pendingTools, working])
  return { logRef, stuckRef, showLatest, setShowLatest, stickToBottom, resetScroll, onLogScroll }
}
