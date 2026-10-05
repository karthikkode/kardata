// Chat message log: thread segments, optimistic echo, live pending
// rows, and the "Latest" escape. Read-only over parent state.
import type { Dispatch, SetStateAction } from 'react'
import { ThreadPrimitive } from '@assistant-ui/react'
import { Icons } from '@/lib/icons'
import { popoverEnter } from '@/lib/motion'
import type { ToolPayload } from '../../data/staging-api'
import { messageSeq } from './messages'
import type { ChatFile, ChatMessage, MessageSegment } from './messages'
import { AssistantRuntimeAdapter } from './AssistantRuntimeAdapter'
import { toThreadSegments } from './assistantAdapter'
import { ConversationEmpty } from './ConversationEmpty'
import { ReasoningDisclosure } from './ReasoningDisclosure'
import { ThinkingRow } from './ThinkingRow'
import { ToolActivity } from './ToolActivity'
import { MessageBubble, renderMentionChips, type ReasoningControl } from './MessageBubble'
import { ToolRow } from '../research-parts'
import { UserBubble } from '../chat-parts'
import { Button } from '../ui/button'

export function ChatLog({
  logRef,
  onLogScroll,
  segments,
  replying,
  messages,
  setDraft,
  inputRef,
  lastReasoningKey,
  reasoningControl,
  files,
  lastKey,
  echo,
  sendError,
  working,
  pendingTools,
  pendingReasoning,
  pendingText,
  reasoningOpen,
  setReasoningOpen,
  showLatest,
  stuckRef,
  setShowLatest,
  stickToBottom,
}: {
  logRef: { current: HTMLDivElement | null }
  onLogScroll: () => void
  segments: MessageSegment[]
  replying: boolean
  messages: ChatMessage[]
  setDraft: Dispatch<SetStateAction<string>>
  inputRef: { current: HTMLTextAreaElement | null }
  lastReasoningKey: string | undefined
  reasoningControl: ReasoningControl
  files: ChatFile[]
  lastKey: string | undefined
  echo: { text: string; basis: number } | null
  sendError: string | null
  working: boolean
  pendingTools: Array<ToolPayload & { seenAt?: number }>
  pendingReasoning: string | null
  pendingText: string | null
  reasoningOpen: boolean
  setReasoningOpen: (open: boolean) => void
  showLatest: boolean
  stuckRef: { current: boolean }
  setShowLatest: Dispatch<SetStateAction<boolean>>
  stickToBottom: () => void
}) {
  return (
    <>
      <div className="relative min-h-0 flex-1">
      <div
        role="log"
        aria-live="polite"
        aria-label="Chat messages"
        ref={logRef}
        onScroll={onLogScroll}
        className="scroll-slim h-full space-y-6 overflow-y-auto px-4 py-3"
      >
        <AssistantRuntimeAdapter
          messages={toThreadSegments(segments)}
          isRunning={replying}
          onSend={() => undefined}
        >
        <ThreadPrimitive.Root>
        {messages.length === 0 && !replying ? (
          <ThreadPrimitive.Empty>
            <ConversationEmpty variant="karbot" onSuggest={(text) => { setDraft(text); inputRef.current?.focus() }} />
          </ThreadPrimitive.Empty>
        ) : null}
        <ThreadPrimitive.Messages>
          {({ message: runtimeMessage }) => {
            const segment = segments.find((entry) => entry.key === runtimeMessage.id)
            if (!segment) return null
            const control = segment.key === lastReasoningKey ? reasoningControl : undefined
            return 'tools' in segment ? (
            <div key={segment.key} className="space-y-2">
              <ToolActivity tools={segment.tools} />
              {segment.reply ? (
                <>
                  {segment.reply.reasoning ? <ReasoningDisclosure reasoning={segment.reply.reasoning} open={control?.open} onOpenChange={control?.onOpenChange} /> : null}
                  <MessageBubble message={{ ...segment.reply, reasoning: undefined }} files={files} latest={segment.key === lastKey} />
                </>
              ) : null}
            </div>
          ) : (
            <div key={segment.key} className="space-y-2">
              {segment.message.kind === 'text' ? (
                <MessageBubble message={segment.message} files={files} latest={segment.key === lastKey} reasoningControl={control} />
              ) : (
                <ToolRow
                  name={segment.message.name}
                  detail={segment.message.detail}
                  state={segment.message.state}
                />
              )}
            </div>
            )
          }}
        </ThreadPrimitive.Messages>
        </ThreadPrimitive.Root>
        </AssistantRuntimeAdapter>
        {echo && !sendError && !messages.some((message) =>
          message.kind === 'text' && message.role === 'user' &&
          message.text === echo.text && messageSeq(message) > echo.basis,
        ) ? (
          <div key="pending-send">
            <div className="flex justify-end">
              <div className="max-w-[85%]">
                <UserBubble>
                  {renderMentionChips(echo.text, files)}
                </UserBubble>
                {working ? (
                  <p className="mt-0.5 text-right text-xs text-muted-foreground">Sending…</p>
                ) : null}
              </div>
            </div>
          </div>
        ) : null}
        {pendingTools.length > 0 || (pendingReasoning != null && pendingReasoning !== '') || (pendingText != null && pendingText !== '') ? (
          <div key="live-pending" className="space-y-2">
            {pendingTools.length > 0 ? (
              <ToolActivity
                tools={pendingTools.map((tool) => ({ id: tool.id, name: tool.name, detail: '', state: tool.state, seenAt: tool.seenAt }))}
                live
              />
            ) : null}
            {pendingReasoning != null && pendingReasoning !== '' ? (
              <ThinkingRow reasoning={pendingReasoning} open={reasoningOpen} onOpenChange={setReasoningOpen} />
            ) : null}
            {pendingText != null && pendingText !== '' ? (
              <MessageBubble
                message={{
                  id: 'pending',
                  kind: 'text',
                  role: 'agent',
                  text: pendingText,
                }}
                files={files}
                live
              />
            ) : null}
          </div>
        ) : null}
        {replying && !working && !pendingText && !pendingReasoning && pendingTools.length === 0 ? (
          <ThinkingRow />
        ) : null}
      </div>
      {showLatest ? (
        <div className="pointer-events-none absolute inset-x-0 bottom-2 flex justify-center">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className={`pointer-events-auto rounded-full shadow-sm ${popoverEnter}`}
            onClick={() => {
              stuckRef.current = true
              setShowLatest(false)
              stickToBottom()
              inputRef.current?.focus()
            }}
          >
            <Icons.latest aria-hidden />
            Latest
          </Button>
        </div>
      ) : null}
      </div>
    </>
  )
}
