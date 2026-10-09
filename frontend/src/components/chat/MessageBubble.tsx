// One text row: user words (with @-file chips) or an agent reply with an
// optional thinking block. Shared by the Karbot log and the files view.
import { Markdown } from '../Markdown'
import { AgentBubble, UserBubble } from '../chat-parts'
import { ReasoningDisclosure } from './ReasoningDisclosure'
import { BodySm } from '../text'
import type { ChatFile, ChatText } from './messages'

// @-references to indexed files render as chips inside the user's own
// words. Unknown @-words stay plain text.
export function renderMentionChips(text: string, files: ChatFile[]) {
  return text.split(/(@[\w.-]+)/g).map((part, index) => {
    const name = part.startsWith('@') ? part.slice(1) : ''
    if (name && files.some((file) => file.name === name)) {
      return (
        <span
          key={index}
          className="mx-0.5 inline-flex items-center rounded-md border border-border bg-background px-1.5 font-medium"
        >
          @{name}
        </span>
      )
    }
    return part
  })
}

export interface ReasoningControl {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function MessageBubble({ message, files, live = false, latest = false, reasoningControl }: { message: ChatText; files: ChatFile[]; live?: boolean; latest?: boolean; reasoningControl?: ReasoningControl }) {
  if (message.role === 'user') {
    return (
      <div className="flex justify-end" data-message-bubble="">
        <UserBubble>
          {renderMentionChips(message.text, files)}
        </UserBubble>
      </div>
    )
  }
  return (
    <div className="min-w-0 space-y-2" data-message-bubble="">
      {message.reasoning ? <ReasoningDisclosure reasoning={message.reasoning} open={reasoningControl?.open} onOpenChange={reasoningControl?.onOpenChange} /> : null}
      {message.text ? (
        <AgentBubble copyText={live ? undefined : message.text} timestamp={message.at} latest={latest && !live}>
          <Markdown text={message.text} />
          {message.failed ? (
            <BodySm as="span" className="mt-1 block text-muted-foreground">This reply failed.</BodySm>
          ) : null}
          {message.missedSteer ? (
            <BodySm as="span" className="mt-1 block text-muted-foreground">
              Sent after the run moved on: shown, not relaunched.
            </BodySm>
          ) : null}
        </AgentBubble>
      ) : null}
    </div>
  )
}
