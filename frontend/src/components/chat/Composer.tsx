// Composer: the one shared message composer for workspace conversations
// and Karbot. The draft, send/steer/stop callbacks and key handling stay
// with the caller; this shell owns the card container, the autosizing
// textarea (1 to 8 lines), the toolbar row, the focused hint, and the
// send-failure notice.
import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode, type RefObject } from 'react'
import { Icons } from '@/lib/icons'
import { BodySm, Caption, Kbd } from '../text'
import { Button } from '../ui/button'

/** Eight 22px lines: the textarea stops growing here and scrolls. */
const MAX_COMPOSER_HEIGHT = 176

export function Composer({
  id,
  label,
  value,
  onChange,
  onKeyDown,
  placeholder,
  disabled = false,
  textareaRef,
  autoFocus = false,
  left,
  right,
  error = null,
  onRetry,
  hint = true,
  listboxes,
}: {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
  onKeyDown?: (event: ReactKeyboardEvent<HTMLTextAreaElement>) => void
  placeholder: string
  disabled?: boolean
  textareaRef?: RefObject<HTMLTextAreaElement | null>
  autoFocus?: boolean
  left?: ReactNode
  right?: ReactNode
  /** Send-failure detail; renders the fixed title plus Retry below. */
  error?: string | null
  onRetry?: () => void
  /** CP-04 shortcut hint while focused (desktop only). */
  hint?: boolean
  /** Mention/skill listboxes anchored above the card. */
  listboxes?: ReactNode
}) {
  const innerRef = useRef<HTMLTextAreaElement | null>(null)
  const [focused, setFocused] = useState(false)
  // The parent ref (when given) IS the textarea ref: passed straight
  // through, never merged or mutated, so the hooks rules stay happy.
  const resolvedRef = textareaRef ?? innerRef

  // Autosize 1 to 8 lines: measure the content, clamp, and let taller
  // drafts scroll inside the capped box. A zero scrollHeight (jsdom)
  // leaves the rows=1 height alone.
  useEffect(() => {
    const element = resolvedRef.current
    if (!element) return
    element.style.height = 'auto'
    if (element.scrollHeight > 0) {
      element.style.height = `${Math.min(element.scrollHeight, MAX_COMPOSER_HEIGHT)}px`
    }
  }, [value, resolvedRef])

  return (
    <div>
      <div
        className={`relative min-h-14 rounded-xl border border-border bg-card p-3 shadow-sm transition-colors duration-120 ease-out-soft focus-within:border-ring focus-within:outline-2 focus-within:outline-ring/30 ${disabled ? 'opacity-60' : ''}`}
      >
        {listboxes}
        <label htmlFor={id} className="sr-only">
          {label}
        </label>
        <textarea
          ref={resolvedRef}
          id={id}
          rows={1}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={onKeyDown}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          placeholder={placeholder}
          disabled={disabled}
          autoFocus={autoFocus}
          className="scroll-slim block max-h-44 min-h-8 pointer-coarse:min-h-10 w-full resize-none border-0 bg-transparent text-sm leading-[22px] placeholder:text-foreground-subtle focus:outline-none disabled:opacity-50"
        />
        {left || right ? (
          // Wraps on narrow busy rows (390px: model chip plus Steer, Queue
          // and Stop never fit one line): the actions drop to their own row
          // instead of overlapping the trigger. Wide layouts never wrap.
          <div className="mt-2 flex flex-wrap items-center justify-end gap-2">
            {left ? <div className="flex min-w-0 items-center gap-2">{left}</div> : null}
            <div className="flex-1" />
            {right ? <div className="flex shrink-0 items-center gap-2">{right}</div> : null}
          </div>
        ) : null}
      </div>
      {error ? (
        <div role="alert" className="mt-2 flex gap-2 rounded-md border border-danger-border bg-danger-soft p-3">
          <span className="flex h-5 shrink-0 items-center">
            <Icons.alertError aria-hidden className="size-4 text-danger" />
          </span>
          <div className="min-w-0 flex-1">
            <BodySm as="p">That did not go through.</BodySm>
            <Caption as="p" className="mt-0.5">
              {error}
            </Caption>
          </div>
          {onRetry ? (
            <Button type="button" variant="ghost" size="sm" onClick={onRetry} className="shrink-0">
              Retry
            </Button>
          ) : null}
        </div>
      ) : null}
      {hint && !disabled ? (
        // Space is always reserved (invisible when unfocused): mounting on
        // focus and unmounting on blur shifts the send button between
        // mousedown and mouseup, swallowing the click (no submit fires).
        <p aria-hidden={!focused} className={`mt-2 hidden items-center gap-1 md:flex ${focused ? '' : 'invisible'}`}>
          <Kbd>Enter</Kbd>
          <Caption as="span">to send,</Caption>
          <Kbd>Shift</Kbd>
          <Caption as="span">+</Caption>
          <Kbd>Enter</Kbd>
          <Caption as="span">for a new line</Caption>
        </p>
      ) : null}
    </div>
  )
}
