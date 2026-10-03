// Live thinking row (CV-05), shared by the workspace and Karbot.
// Inline row, no border or background: Brain + shimmer "Thinking" +
// elapsed clock. When live reasoning text exists the row expands it;
// the open state lifts to the caller so the settled ReasoningDisclosure
// keeps it after the reply lands (CV-06).
import { useEffect, useState } from 'react'
import { Icons } from '@/lib/icons'
import { Caption } from '../text'
import { CollapsiblePanel, CollapsibleRoot, CollapsibleTrigger } from '../ui/collapsible'
import { BodySm } from '../text'
import { cn } from '@/lib/utils'

export function ThinkingRow({
  reasoning,
  open,
  onOpenChange,
}: {
  reasoning?: string
  open?: boolean
  onOpenChange?: (open: boolean) => void
}) {
  const [elapsed, setElapsed] = useState(0)
  useEffect(() => {
    const start = Date.now()
    const timer = window.setInterval(() => setElapsed(Math.floor((Date.now() - start) / 1000)), 500)
    return () => window.clearInterval(timer)
  }, [])
  const [internal, setInternal] = useState(false)
  const expanded = open ?? internal
  function setExpanded(next: boolean): void {
    setInternal(next)
    onOpenChange?.(next)
  }
  const expandable = Boolean(reasoning)
  const row = (
    <>
      <Icons.thinking aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
      <Caption as="span" className="kd-thinking">Thinking</Caption>
      <Caption as="span" aria-hidden className="tabular-nums">{elapsed}s</Caption>
      {expandable ? (
        <Icons.chevronDown aria-hidden className={cn('size-3.5 shrink-0 text-muted-foreground transition-transform duration-180 ease-out', expanded && 'rotate-180')} />
      ) : null}
    </>
  )
  if (!expandable) {
    return (
      <div role="status" aria-label="Agent is replying" className="inline-flex min-h-8 items-center gap-1.5 px-1.5 py-1 pointer-coarse:min-h-10">
        {row}
      </div>
    )
  }
  return (
    <CollapsibleRoot open={expanded} onOpenChange={(next) => { if (typeof next === 'boolean') setExpanded(next) }}>
      <CollapsibleTrigger
        aria-label={`${expanded ? 'Hide' : 'Show'} live reasoning`}
        aria-expanded={expanded}
        className="inline-flex min-h-8 cursor-pointer items-center gap-1.5 rounded-md px-1.5 py-1 text-left transition-colors duration-120 ease-out hover:bg-surface-hover pointer-coarse:min-h-10"
      >
        {row}
      </CollapsibleTrigger>
      <CollapsiblePanel>
        <div className="scroll-slim mt-1 max-h-80 overflow-y-auto border-l-2 border-border pl-3">
          <BodySm className="text-muted-foreground whitespace-pre-wrap">{reasoning}</BodySm>
        </div>
      </CollapsiblePanel>
    </CollapsibleRoot>
  )
}
