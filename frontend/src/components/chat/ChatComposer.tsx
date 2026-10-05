// Chat composer column: subagent strip plus the message composer with
// file picker, @-mention and /-skill listboxes, and send controls.
import type { Dispatch, SetStateAction, KeyboardEvent as ReactKeyboardEvent } from 'react'
import { Icons, fileIcon } from '@/lib/icons'
import { focusRingInset } from '@/lib/interaction'
import { popoverEnter } from '@/lib/motion'
import type { SkillSummary } from '../../data/useSkills'
import type { StagingConfig } from '../../data/useApi'
import type { ThreadView } from '../../data/useThreads'
import type { ChatFile } from './messages'
import { FilesMenu } from './FilesMenu'
import { SubagentsPanel } from '../SubagentsPanel'
import { ConversationComposer } from '../shells'
import { Composer } from './Composer'
import { ModelToolbar } from '../ModelToolbar'
import { Button } from '../ui/button'
import { IconButton } from '../IconButton'
import { Caption } from '../text'

export function ChatComposer({
  subagentThreads,
  taggedThread,
  openThreadKey,
  tagThread,
  openThreadChat,
  stopThread,
  pauseThread,
  resumeThread,
  send,
  draft,
  setDraft,
  setMentionClosed,
  setMentionIndex,
  setSkillClosed,
  setSkillIndex,
  composerKeys,
  inputRef,
  filesMenu,
  files,
  addButtonRef,
  mentionOpen,
  mentionNoMatch,
  mentionMatch,
  mentionOptions,
  mentionIndex,
  insertMention,
  skillOpen,
  skillNoMatch,
  skillMatch,
  skillOptions,
  skillIndex,
  insertSkill,
  working,
  planMode,
  setPlanMode,
  activeSessionId,
  config,
  replying,
  steerRunningAgent,
  stopReply,
  sendError,
  retrySend,
}: {
  subagentThreads: ThreadView[]
  taggedThread: ThreadView | null
  openThreadKey: string | null
  tagThread: (key: string) => void
  openThreadChat: (key: string) => void
  stopThread: (key: string) => void
  pauseThread: (key: string) => void
  resumeThread: (key: string) => void
  send: (text: string) => void
  draft: string
  setDraft: Dispatch<SetStateAction<string>>
  setMentionClosed: Dispatch<SetStateAction<boolean>>
  setMentionIndex: Dispatch<SetStateAction<number>>
  setSkillClosed: Dispatch<SetStateAction<boolean>>
  setSkillIndex: Dispatch<SetStateAction<number>>
  composerKeys: (event: ReactKeyboardEvent<HTMLTextAreaElement>) => void
  inputRef: { current: HTMLTextAreaElement | null }
  filesMenu: { open: boolean; mounted: boolean; closing: boolean; set: (next: boolean) => void }
  files: ChatFile[]
  addButtonRef: { current: HTMLButtonElement | null }
  mentionOpen: boolean
  mentionNoMatch: boolean
  mentionMatch: RegExpMatchArray | null
  mentionOptions: Array<{ id: string; name: string; hint: string; kind: 'thread' | 'file' }>
  mentionIndex: number
  insertMention: (pick: { name: string }) => void
  skillOpen: boolean
  skillNoMatch: boolean
  skillMatch: RegExpMatchArray | null
  skillOptions: SkillSummary[]
  skillIndex: number
  insertSkill: (skill: SkillSummary) => void
  working: boolean
  planMode: boolean
  setPlanMode: Dispatch<SetStateAction<boolean>>
  activeSessionId: string | null
  config: StagingConfig | null
  replying: boolean
  steerRunningAgent: (text: string) => void
  stopReply: () => void
  sendError: string | null
  retrySend: () => void
}) {
  return (
    <>
      {subagentThreads.length > 0 ? <SubagentsPanel
        threads={subagentThreads}
        taggedKey={taggedThread?.key ?? openThreadKey}
        onTagThread={tagThread}
        onOpenThread={openThreadChat}
        onStopThread={stopThread}
        onPauseThread={pauseThread}
        onResumeThread={resumeThread}
      /> : null}
      <ConversationComposer label="Message the agent" surface="bg-popover" input={<form
        onSubmit={(event) => {
          event.preventDefault()
          send(draft)
        }}
      >
        <Composer
          id="karbot-composer"
          label="Message the agent"
          value={draft}
          onChange={(value) => {
            setDraft(value)
            setMentionClosed(false)
            setMentionIndex(0)
            setSkillClosed(false)
            setSkillIndex(0)
          }}
          onKeyDown={composerKeys}
          placeholder="Ask Karbot..."
          textareaRef={inputRef}
          autoFocus
          listboxes={<>
        {filesMenu.mounted ? (
          <FilesMenu
            files={files}
            closing={filesMenu.closing}
            onPick={(file) => {
              filesMenu.set(false)
              setDraft((current) => `${current}@${file.name} `)
              inputRef.current?.focus()
            }}
            onClose={() => filesMenu.set(false)}
            onEscape={() => {
              filesMenu.set(false)
              addButtonRef.current?.focus()
            }}
          />
        ) : null}
        {mentionOpen || mentionNoMatch ? (
          <ul
            role="listbox"
            aria-label="Mention a thread or file"
            className={`absolute bottom-full left-0 z-50 mb-2 max-h-56 w-72 scroll-slim overflow-y-auto rounded-lg border border-border bg-popover p-1 shadow-md ${popoverEnter}`}
          >
            {mentionNoMatch ? (
              <li className="px-2 py-1.5 text-ui text-muted-foreground">
                No threads or files match &quot;@{mentionMatch?.[1] ?? ''}&quot;.
              </li>
            ) : null}
            {mentionOptions.map((option, index) => {
              const OptionIcon = option.kind === 'thread' ? Icons.agents : fileIcon(option.name)
              return (
                <li key={option.id} role="presentation">
                  <button
                    type="button"
                    role="option"
                    aria-selected={index === mentionIndex}
                    onClick={() => insertMention(option)}
                    className={`flex min-h-9 w-full cursor-pointer items-center gap-2 rounded-sm px-2 py-1 text-left text-ui ${index === mentionIndex ? 'bg-surface-active' : 'hover:bg-surface-hover'} ${focusRingInset}`}
                  >
                    <OptionIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                    <span className="min-w-0 flex-1 truncate">@{option.name}</span>
                    <Caption as="span" className="shrink-0">{option.hint}</Caption>
                  </button>
                </li>
              )
            })}
          </ul>
        ) : null}
        {skillOpen || skillNoMatch ? (
          <ul
            role="listbox"
            aria-label="Invoke a skill"
            className={`absolute bottom-full left-0 z-50 mb-2 max-h-56 w-72 scroll-slim overflow-y-auto rounded-lg border border-border bg-popover p-1 shadow-md ${popoverEnter}`}
          >
            {skillNoMatch ? (
              <li className="px-2 py-1.5 text-ui text-muted-foreground">
                No skills match &quot;/{skillMatch?.[1] ?? ''}&quot;.
              </li>
            ) : null}
            {skillOptions.map((option, index) => (
              <li key={option.name} role="presentation">
                <button
                  type="button"
                  role="option"
                  aria-selected={index === skillIndex}
                  onClick={() => insertSkill(option)}
                  className={`flex min-h-9 w-full cursor-pointer items-center gap-2 rounded-sm px-2 py-1 text-left text-ui ${index === skillIndex ? 'bg-surface-active' : 'hover:bg-surface-hover'} ${focusRingInset}`}
                >
                  <Icons.planMode className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                  <span className="shrink-0">/{option.name}</span>
                  <Caption as="span" className="min-w-0 flex-1 truncate text-right">{option.description}</Caption>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
          </>}
          left={<>
            <IconButton label="Attach file" type="button" ref={addButtonRef} aria-expanded={filesMenu.open} disabled={working} onClick={() => filesMenu.set(!filesMenu.open)}>
              <Icons.attachFile className="size-4" aria-hidden />
            </IconButton>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-label="Toggle plan mode"
              aria-pressed={planMode}
              onClick={() => setPlanMode((val) => !val)}
              className={planMode ? 'bg-primary-soft text-primary-text hover:bg-primary-soft hover:text-primary-text' : undefined}
            >
              <Icons.planMode className="size-3.5" aria-hidden />
              <span>Plan</span>
            </Button>
            {activeSessionId && !openThreadKey ? (
              <ModelToolbar
                key={`models-${activeSessionId}`}
                compact
                bare
                display="model"
                config={config}
                sessionId={activeSessionId}
              />
            ) : null}
          </>}
          right={replying ? <>
            <Button
              type="button"
              variant="primary"
              size="sm"
              disabled={!draft.trim()}
              onClick={() => steerRunningAgent(draft)}
            >
              <Icons.steer className="size-3.5" aria-hidden />
              Steer
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={!draft.trim()}
              onClick={() => send(draft)}
            >
              Queue
            </Button>
            <IconButton label="Stop reply" type="button" onClick={stopReply} className="text-danger hover:text-danger">
              <Icons.stopRun className="size-4" aria-hidden />
            </IconButton>
          </> : (
            <IconButton label="Send message" shortcut="Enter" type="submit" variant="default" size="icon-sm" disabled={!draft.trim()} className="rounded-full">
              <Icons.send className="size-4" aria-hidden />
            </IconButton>
          )}
          error={sendError}
          onRetry={retrySend}
        />
      </form>} />
    </>
  )
}
