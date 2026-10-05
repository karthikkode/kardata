// Past sessions: titles with ages, one active row, and a new-session
// action. Switching swaps the visible thread.
import { useState } from 'react'
import { Icons } from '@/lib/icons'
import { focusRingInset } from '@/lib/interaction'
import { popoverEnter, popoverExit } from '@/lib/motion'
import type { Session } from '../../data/api/sessions'
import { sessionAge } from './messages'
import { BodySm, Caption, Mono } from '../text'
import { ConfirmAction } from '../ui/alert-dialog'
import { IconButton } from '../IconButton'

export function SessionsPanel({
  sessions,
  activeId,
  pinnedId = null,
  closing,
  deleting,
  onOpen,
  onNew,
  onDelete,
  onClose,
  onEscape,
}: {
  sessions: Session[]
  activeId: string | null
  /** Research session: pinned first with a marker. Null in Karbot. */
  pinnedId?: string | null
  closing: boolean
  deleting: boolean
  onOpen: (session: Session) => void
  onNew: () => void
  onDelete: (session: Session) => void
  onClose: () => void
  onEscape: () => void
}) {
  // Row with its delete armed. Stays local: confirming never fires the
  // request, and a successful delete removes the row from the list.
  const [confirmingId, setConfirmingId] = useState<string | null>(null)
  const ordered = [...sessions].sort((a, b) => {
    const aPinned = pinnedId !== null && a.id === pinnedId
    const bPinned = pinnedId !== null && b.id === pinnedId
    if (aPinned === bPinned) return 0
    return aPinned ? -1 : 1
  })
  return (
    <>
      <button
        type="button"
        aria-label="Dismiss sessions"
        onClick={onClose}
        className="fixed inset-0 z-40 cursor-default bg-transparent"
      />
      <div
        role="menu"
        aria-label="Chat sessions"
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.stopPropagation()
            onEscape()
          }
        }}
        className={`absolute left-0 top-full z-50 mt-1 max-h-80 w-80 scroll-slim overflow-y-auto rounded-lg border border-border bg-popover p-1 shadow-md ${closing ? popoverExit : popoverEnter}`}
      >
        <button
          type="button"
          role="menuitem"
          aria-label="New chat"
          autoFocus
          onClick={onNew}
          className={`flex min-h-9 w-full cursor-pointer items-center gap-2 rounded-sm px-2 py-1 text-left text-ui hover:bg-surface-hover ${focusRingInset}`}
        >
          <Icons.newChat className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          <span className="min-w-0 flex-1 truncate">New chat</span>
        </button>
        <div aria-hidden className="mx-1 my-1 border-t border-border-subtle" />
        {sessions.length === 0 ? (
          <p className="px-2 py-1.5 text-ui text-muted-foreground">
            No chats yet.
          </p>
        ) : null}
        {ordered.map((session) => {
          const active = session.id === activeId
          return (
            <div
              key={session.id}
              className={`group flex min-h-11 items-center gap-1 rounded-md px-1 py-0.5 ${
                active ? 'bg-surface-active' : 'hover:bg-surface-hover'
              }`}
            >
              {active ? (
                <Icons.approve className="size-4 shrink-0 text-primary-text" aria-hidden />
              ) : (
                <span aria-hidden className="size-4 shrink-0" />
              )}
              <button
                type="button"
                role="menuitem"
                aria-current={active ? 'true' : undefined}
                aria-label={`Open ${session.title}`}
                onClick={() => onOpen(session)}
                className={`flex min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-sm px-1 py-1 text-left ${focusRingInset}`}
              >
                {pinnedId !== null && session.id === pinnedId ? (
                  <span className="flex shrink-0 items-center gap-1 text-xs font-medium text-muted-foreground">
                    <Icons.pin className="size-3.5" aria-hidden />
                    Research
                  </span>
                ) : null}
                <span className="min-w-0 flex-1">
                  <BodySm as="span" className={`block truncate ${active ? 'font-medium' : ''}`}>{session.title}</BodySm>
                  <Mono className="block truncate text-xs text-muted-foreground">{session.id}</Mono>
                </span>
                <Caption as="span" className="shrink-0 tabular-nums">
                  {sessionAge(session.updatedAt)}
                </Caption>
              </button>
              {confirmingId === session.id ? (
                <ConfirmAction
                  open
                  onOpenChange={(open) => {
                    if (!open) setConfirmingId(null)
                  }}
                  title={`Delete "${session.title}"?`}
                  description="This removes the chat from the session list. Its history is retained in the audit log."
                  confirmLabel="Delete conversation"
                  pending={deleting}
                  onConfirm={() => {
                    onDelete(session)
                    setConfirmingId(null)
                  }}
                />
              ) : null}
              <IconButton
                label={`Delete ${session.title}`}
                size="icon-sm"
                type="button"
                disabled={deleting}
                onClick={() => setConfirmingId(session.id)}
                className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-100"
              >
                <Icons.delete className="size-4" aria-hidden />
              </IconButton>
            </div>
          )
        })}
      </div>
    </>
  )
}
