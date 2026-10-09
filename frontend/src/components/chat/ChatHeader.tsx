// Karbot header: back/session picker, rename, context popover, files
// toggle, more menu, and close. All state lives in the parent.
import type { Dispatch, SetStateAction } from 'react'
import { Icons } from '@/lib/icons'
import { focusRingInset } from '@/lib/interaction'
import { popoverEnter, popoverExit } from '@/lib/motion'
import type { Session } from '../../data/useSessions'
import type { StagingConfig } from '../../data/useApi'
import type { ThreadView } from '../../data/useThreads'
import type { ChatFile, ChatScope } from './messages'
import { SessionsPanel } from './SessionsPanel'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { ConfirmAction } from '../ui/alert-dialog'
import { MenuItem, MenuPopup, MenuRoot, MenuTrigger } from '../ui/menu'
import { WorkspaceOverlay } from '../workspace-parts'
import { BodySm, Caption, Description, Label } from '../text'
import { IconButton } from '../IconButton'

export function ChatHeader({
  saveRename,
  sessions,
  activeSession,
  activeSessionId,
  openThread,
  scope,
  files,
  contextSummary,
  contextDetails,
  config,
  activeTab,
  moreOpen,
  deletingSession,
  renaming,
  savingName,
  compacting,
  confirmingDelete,
  renameDraft,
  renameError,
  deleteError,
  sessionsPanel,
  contextPanel,
  sessionsButtonRef,
  contextButtonRef,
  renameInputRef,
  renameSelectedRef,
  backToSession,
  openSession,
  newSession,
  runDelete,
  cancelDelete,
  cancelRename,
  startRename,
  confirmDelete,
  handleCompactSession,
  setMoreOpenState,
  setRenameDraft,
  setActiveTab,
  onClose,
}: {
  saveRename: () => void
  sessions: Session[] | null
  activeSession: Session | null
  activeSessionId: string | null
  openThread: ThreadView | undefined
  scope: ChatScope
  files: ChatFile[]
  contextSummary: string | null
  contextDetails: Array<{ label: string; value: string }>
  config: StagingConfig | null
  activeTab: 'conversation' | 'files'
  moreOpen: boolean
  deletingSession: boolean
  renaming: boolean
  savingName: boolean
  compacting: boolean
  confirmingDelete: boolean
  renameDraft: string
  renameError: string | null
  deleteError: string | null
  sessionsPanel: { open: boolean; mounted: boolean; closing: boolean; set: (next: boolean) => void }
  contextPanel: { open: boolean; mounted: boolean; closing: boolean; set: (next: boolean) => void }
  sessionsButtonRef: { current: HTMLButtonElement | null }
  contextButtonRef: { current: HTMLButtonElement | null }
  renameInputRef: { current: HTMLInputElement | null }
  renameSelectedRef: { current: boolean }
  backToSession: () => void
  openSession: (session: Session) => void
  newSession: () => void
  runDelete: (sessionId: string) => void
  cancelDelete: () => void
  cancelRename: () => void
  startRename: () => void
  confirmDelete: () => void
  handleCompactSession: () => void
  setMoreOpenState: (next: boolean) => void
  setRenameDraft: Dispatch<SetStateAction<string>>
  setActiveTab: Dispatch<SetStateAction<'conversation' | 'files'>>
  onClose: () => void
}) {
  return (
    <>
      <div className="relative flex h-12 items-center gap-1 border-b border-border-subtle px-2">
        {openThread ? (
          <>
            <IconButton label="Back to chat" size="icon-sm" type="button" onClick={backToSession}>
              <Icons.back className="size-4" aria-hidden />
            </IconButton>
            <BodySm as="p" className="min-w-0 flex-1 truncate font-medium">{openThread.key}</BodySm>
          </>
        ) : (
          <>
            <Icons.karbot className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            <div className="relative min-w-0 flex-1">
              <button
                type="button"
                ref={sessionsButtonRef}
                aria-haspopup="menu"
                aria-expanded={sessionsPanel.open}
                aria-label="Chat sessions"
                onClick={() => sessionsPanel.set(!sessionsPanel.open)}
                title={activeSession ? activeSession.title : scope ? scope.name : 'Assistant'}
                className={`flex h-8 w-full min-w-0 cursor-pointer items-center gap-1 rounded-md px-2 text-left text-ui transition-colors duration-120 ease-out hover:bg-surface-hover ${focusRingInset}`}
              >
                <span className="min-w-0 flex-1 truncate font-medium">
                  {activeSession ? activeSession.title : scope ? scope.name : 'Assistant'}
                </span>
                <Icons.chevronDown className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              </button>
              {sessionsPanel.mounted ? (
                <SessionsPanel
                  sessions={sessions ?? []}
                  activeId={activeSessionId}
                  closing={sessionsPanel.closing}
                  deleting={deletingSession}
                  onOpen={openSession}
                  onNew={newSession}
                  onDelete={(session) => runDelete(session.id)}
                  onClose={() => sessionsPanel.set(false)}
                  onEscape={() => {
                    sessionsPanel.set(false)
                    sessionsButtonRef.current?.focus()
                  }}
                />
              ) : null}
            </div>
            {activeSession ? (
              <ConfirmAction
                open={confirmingDelete}
                onOpenChange={(open) => {
                  if (!open) cancelDelete()
                }}
                title={`Delete "${activeSession.title}"?`}
                description="This removes the chat from the session list. Its history is retained in the audit log."
                confirmLabel="Delete conversation"
                pending={deletingSession}
                error={deleteError}
                onConfirm={() => {
                  runDelete(activeSession.id)
                }}
              />
            ) : null}
            {renaming ? (
              <WorkspaceOverlay
                title="Rename chat"
                size="small"
                onClose={cancelRename}
                initialFocus={renameInputRef}
                footer={
                  <>
                    <Button type="button" variant="secondary" onClick={cancelRename}>Cancel</Button>
                    <Button type="button" variant="primary" pending={savingName} disabled={!renameDraft.trim()} onClick={() => saveRename()}>Save</Button>
                  </>
                }
              >
                <form aria-label="Rename chat" onSubmit={(event) => { event.preventDefault(); saveRename() }}>
                  <Label as="label" htmlFor="karbot-rename-name">Chat name</Label>
                  <Input
                    ref={renameInputRef}
                    id="karbot-rename-name"
                    value={renameDraft}
                    disabled={savingName}
                    onChange={(event) => setRenameDraft(event.target.value)}
                    onFocus={(event) => {
                      if (!renameSelectedRef.current) {
                        renameSelectedRef.current = true
                        event.currentTarget.select()
                      }
                    }}
                    aria-describedby={renameError ? 'karbot-rename-error' : undefined}
                    className="mt-1.5"
                  />
                  {renameError ? (
                    <Caption id="karbot-rename-error" role="alert" className="mt-1.5 text-danger">{renameError}</Caption>
                  ) : null}
                </form>
              </WorkspaceOverlay>
            ) : null}
            {scope ? (
              <button
                type="button"
                ref={contextButtonRef}
                aria-expanded={contextPanel.open}
                onClick={() => contextPanel.set(!contextPanel.open)}
                className={`h-8 shrink-0 cursor-pointer rounded-md px-2 text-xs text-muted-foreground transition-colors duration-120 ease-out hover:bg-surface-hover hover:text-foreground ${focusRingInset}`}
              >
                Context
              </button>
            ) : null}
            <IconButton label="New chat" size="icon-sm" type="button" disabled={!config} onClick={newSession}>
              <Icons.newChat className="size-4" aria-hidden />
            </IconButton>
            <span className="relative inline-flex shrink-0">
              <IconButton
                label="Session files"
                size="icon-sm"
                type="button"
                aria-pressed={activeTab === 'files'}
                onClick={() => setActiveTab(activeTab === 'files' ? 'conversation' : 'files')}
                className={activeTab === 'files' ? 'bg-surface-active text-foreground' : undefined}
              >
                <Icons.fileDocs className="size-4" aria-hidden />
              </IconButton>
              {files.length > 0 ? (
                <span aria-hidden className="absolute top-1 right-1 size-1.5 rounded-full bg-primary" />
              ) : null}
            </span>
            <MenuRoot open={moreOpen} onOpenChange={setMoreOpenState}>
              <MenuTrigger render={<IconButton label="More actions" size="icon-sm" type="button" disabled={!activeSession}><Icons.moreActions className="size-4" aria-hidden /></IconButton>} />
              <MenuPopup>
                <MenuItem onClick={startRename}><Icons.edit aria-hidden />Rename</MenuItem>
                <MenuItem disabled={compacting || !activeSessionId} onClick={() => void handleCompactSession()}><Icons.minimize aria-hidden className={compacting ? 'animate-spin' : undefined} />Compact context</MenuItem>
                <MenuItem onClick={confirmDelete} className="text-danger"><Icons.delete aria-hidden />Delete</MenuItem>
              </MenuPopup>
            </MenuRoot>
          </>
        )}
        <IconButton label="Close" size="icon-sm" type="button" onClick={onClose}>
          <Icons.deny className="size-4" aria-hidden />
        </IconButton>
        {(scope !== null && contextPanel.mounted) ? (
          <>
            <button
              type="button"
              aria-label="Dismiss context"
              onClick={() => contextPanel.set(false)}
              className="fixed inset-0 z-40 cursor-default bg-transparent"
            />
            <div
              role="region"
              aria-label="Chat context"
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  event.stopPropagation()
                  contextPanel.set(false)
                  contextButtonRef.current?.focus()
                }
              }}
              className={`absolute inset-x-2 top-full z-50 mt-1 rounded-lg border border-border bg-popover p-3 shadow-md ${contextPanel.closing ? popoverExit : popoverEnter}`}
            >
          <div className="flex items-center gap-2">
            <BodySm as="p" className="min-w-0 flex-1 font-medium">What this chat knows</BodySm>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              autoFocus
              onClick={() => contextPanel.set(false)}
            >
              Close context
            </Button>
          </div>
          {contextSummary ? (
            <Description as="p" aria-live="polite" className="mt-1">
              {contextSummary}
            </Description>
          ) : null}
          {contextDetails.length > 0 ? (
            <dl className="mt-2 flex flex-col gap-1.5">
              {contextDetails.map((item) => (
                <div key={item.label} className="flex items-baseline gap-2">
                  <dt className="shrink-0 text-xs text-foreground-subtle">{item.label}</dt>
                  <dd className="min-w-0 flex-1 truncate text-ui text-foreground">{item.value}</dd>
                </div>
              ))}
            </dl>
          ) : (
            <Description as="p" className="mt-1">No breakdown yet.</Description>
          )}
            </div>
          </>
          ) : null}
      </div>
    </>
  )
}
