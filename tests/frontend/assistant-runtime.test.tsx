// Adapter mount proof: primitives render Kardata-owned rows and the
// composer send reaches the Kardata handler. No network, no transport.
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ComposerPrimitive, ThreadPrimitive } from '@assistant-ui/react'

// jsdom lacks ResizeObserver, which the thread viewport uses for
// auto-scroll measurement. Stubbed in this proof only.
if (typeof window !== 'undefined' && !('ResizeObserver' in window)) {
  if (!('scrollTo' in Element.prototype)) {
    (Element.prototype as unknown as Record<string, unknown>).scrollTo = () => {}
  }
  (window as unknown as Record<string, unknown>).ResizeObserver = class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
}
import { AssistantRuntimeAdapter } from '@/components/chat/AssistantRuntimeAdapter'
import { toThreadMessages } from '@/components/chat/assistantAdapter'
import type { ChatMessage } from '@/components/ChatPanel'

const settled: ChatMessage[] = [
  { id: 'm:1', kind: 'text', role: 'user', text: 'Find worthy problems' },
  { id: 'm:2', kind: 'text', role: 'agent', text: 'Acme Pay mismatch', reasoning: 'Checked docs' },
]

function Harness({ onSend }: { onSend: (text: string) => void }) {
  const messages = toThreadMessages(settled, { pendingText: null, pendingReasoning: null, pendingTools: [] })
  return (
    <AssistantRuntimeAdapter messages={messages} isRunning={false} onSend={onSend}>
      <ThreadPrimitive.Root>
        <ThreadPrimitive.Viewport>
          <ThreadPrimitive.Messages>
            {({ message }) => (
              <span data-role={message.role}>
                {message.content
                  .map((part) =>
                    typeof part === 'object' && part !== null && 'text' in part
                      ? String((part as { text: unknown }).text)
                      : '',
                  )
                  .join(' ')}
              </span>
            )}
          </ThreadPrimitive.Messages>
        </ThreadPrimitive.Viewport>
        <ComposerPrimitive.Root>
          <ComposerPrimitive.Input aria-label="Adapter composer" />
          <ComposerPrimitive.Send aria-label="Adapter send">Go</ComposerPrimitive.Send>
        </ComposerPrimitive.Root>
      </ThreadPrimitive.Root>
    </AssistantRuntimeAdapter>
  )
}

describe('assistant runtime adapter', () => {
  it('renders Kardata-owned rows through primitives with no transport', () => {
    render(<Harness onSend={vi.fn()} />)
    expect(screen.getByText('Find worthy problems')).toBeInTheDocument()
    expect(screen.getByText('Checked docs Acme Pay mismatch')).toBeInTheDocument()
  })

  it('routes composer sends to the Kardata handler', async () => {
    const user = userEvent.setup()
    const onSend = vi.fn()
    render(<Harness onSend={onSend} />)
    await user.type(screen.getByLabelText('Adapter composer'), 'steer this')
    await user.click(screen.getByRole('button', { name: 'Adapter send' }))
    expect(onSend).toHaveBeenCalledWith('steer this')
  })
})
