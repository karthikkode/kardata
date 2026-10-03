// Kardata runtime adapter: mounts assistant-ui primitives over Kardata-owned
// conversation state. Transport stays Kardata: messages come from
// listMessages/followThread caches via toThreadMessages, sends go through
// the existing command paths. The adapter never fetches, never stores.
import { useMemo, type ReactNode } from 'react'
import {
  AssistantRuntimeProvider,
  useExternalStoreRuntime,
  type ThreadMessage,
} from '@assistant-ui/react'

function firstTextOf(message: { content?: readonly unknown[] }): string {
  const part = message.content?.find(
    (entry): entry is { type: 'text'; text: string } =>
      typeof entry === 'object' && entry !== null && (entry as { type: unknown }).type === 'text',
  )
  return typeof part?.text === 'string' ? part.text : ''
}

export function AssistantRuntimeAdapter({
  messages,
  isRunning,
  sendDisabled,
  onSend,
  onCancel,
  children,
}: {
  messages: ThreadMessage[]
  isRunning: boolean
  sendDisabled?: boolean
  onSend: (text: string) => void
  onCancel?: () => void
  children: ReactNode
}) {
  const runtime = useExternalStoreRuntime(
    useMemo(
      () => ({
        messages,
        isRunning,
        isSendDisabled: sendDisabled,
        onNew: async (message: { content?: readonly unknown[] }) => {
          onSend(firstTextOf(message))
        },
        ...(onCancel ? { onCancel: async () => onCancel() } : {}),
      }),
      [messages, isRunning, sendDisabled, onSend, onCancel],
    ),
  )
  return <AssistantRuntimeProvider runtime={runtime}>{children}</AssistantRuntimeProvider>
}
