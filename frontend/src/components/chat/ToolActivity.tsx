// Tool activity disclosure (CV-07), shared by the workspace and
// Karbot. Summary row (wrench + "Used N tools" / "Using X..." +
// status + chevron); expanded rows show one humanized tool each with
// duration and state; raw tool ids stay inside the detail block only.
import { useEffect, useState } from 'react'
import { Icons } from '@/lib/icons'
import { toolFamily, toolLabel } from '../../lib/labels'
import { notify } from '../../lib/toast'
import { cn } from '@/lib/utils'
import { BodySm, Caption, Mono } from '../text'
import { IconButton } from '../IconButton'
import { CollapsiblePanel, CollapsibleRoot, CollapsibleTrigger } from '../ui/collapsible'

export interface ActivityTool {
  id: string
  name: string
  detail: string
  state: 'running' | 'done' | 'failed'
  seenAt?: number
}

export function toolActivitySummary(tools: ActivityTool[], live: boolean): string {
  if (live) {
    const running = tools.find((tool) => tool.state === 'running')
    if (running) return `Using ${toolLabel(running.name)}...`
    return tools.length === 1 ? 'Using 1 tool...' : `Using ${tools.length} tools...`
  }
  return tools.length === 1 ? 'Used 1 tool' : `Used ${tools.length} tools`
}

function FamilyIcon({ name, className }: { name: string; className?: string }) {
  const family = toolFamily(name)
  const Icon = family === 'search' ? Icons.search : family === 'web' ? Icons.globalContext : family === 'document' ? Icons.fileDocs : Icons.toolActivity
  return <Icon aria-hidden className={className} />
}

function ToolDetail({ tool }: { tool: ActivityTool }) {
  const [open, setOpen] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  // Transport-echo details ("mcp:name") carry no information; the raw id
  // below already identifies the call.
  const detail = tool.detail === `mcp:${tool.name}` ? '' : tool.detail
  useEffect(() => {
    if (tool.state !== 'running' || tool.seenAt === undefined) return
    const seenAt = tool.seenAt
    const timer = window.setInterval(() => setElapsed(Math.max(0, Math.floor((Date.now() - seenAt) / 1000))), 1000)
    return () => window.clearInterval(timer)
  }, [tool.state, tool.seenAt])
  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText([detail, `id: ${tool.name}`].filter(Boolean).join('\n'))
      notify.success('Copied')
    } catch {
      notify.error('Copy failed. Try again.')
    }
  }
  const failed = tool.state === 'failed'
  return (
    <CollapsibleRoot open={open} onOpenChange={(next) => { if (typeof next === 'boolean') setOpen(next) }}>
      <CollapsibleTrigger
        aria-label={`${open ? 'Hide' : 'Show'} ${toolLabel(tool.name)} detail`}
        aria-expanded={open}
        className="flex w-full cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 text-left transition-colors duration-120 ease-out hover:bg-surface-hover"
      >
        <FamilyIcon name={tool.name} className="size-3.5 shrink-0 text-muted-foreground" />
        <BodySm as="span" className={cn('min-w-0 flex-1 truncate', failed && 'text-warning')}>{toolLabel(tool.name)}</BodySm>
        {failed ? <Caption as="span" className="shrink-0 text-warning">Failed</Caption> : null}
        {tool.state === 'running' && tool.seenAt !== undefined ? (
          <Caption as="span" aria-hidden className="shrink-0 tabular-nums">{elapsed}s</Caption>
        ) : null}
        {tool.state === 'running' ? (
          <Icons.loading aria-hidden className="size-3.5 shrink-0 animate-spin text-muted-foreground" />
        ) : failed ? (
          <Icons.alertWarning aria-hidden className="size-3.5 shrink-0 text-warning" />
        ) : (
          <Icons.approve aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
        )}
        <Icons.chevronDown aria-hidden className={cn('size-3.5 shrink-0 text-muted-foreground transition-transform duration-180 ease-out', open && 'rotate-180')} />
      </CollapsibleTrigger>
      <CollapsiblePanel>
        <div className="relative mt-1 ml-5 rounded-md bg-surface-sunken p-2">
          {detail ? <Mono className="block text-xs whitespace-pre-wrap">{detail}</Mono> : null}
          <Caption as="div" className="mt-1"><Mono>{tool.name}</Mono></Caption>
          <IconButton label={`Copy ${toolLabel(tool.name)} detail`} size="icon-sm" onClick={() => void copy()} className="absolute top-1 right-1">
            <Icons.copy className="size-4" aria-hidden />
          </IconButton>
        </div>
      </CollapsiblePanel>
    </CollapsibleRoot>
  )
}

export function ToolActivity({
  tools,
  live = false,
  open,
  onOpenChange,
  defaultOpen = false,
}: {
  tools: ActivityTool[]
  live?: boolean
  open?: boolean
  onOpenChange?: (open: boolean) => void
  defaultOpen?: boolean
}) {
  const [internal, setInternal] = useState(defaultOpen)
  const expanded = open ?? internal
  function setExpanded(next: boolean): void {
    setInternal(next)
    onOpenChange?.(next)
  }
  if (!tools.length) return null
  const anyRunning = tools.some((tool) => tool.state === 'running')
  const anyFailed = tools.some((tool) => tool.state === 'failed')
  return (
    <CollapsibleRoot open={expanded} onOpenChange={(next) => { if (typeof next === 'boolean') setExpanded(next) }}>
      <CollapsibleTrigger
        aria-label={`${expanded ? 'Hide' : 'Show'} tool activity`}
        aria-expanded={expanded}
        className="inline-flex min-h-8 cursor-pointer items-center gap-1.5 rounded-md px-1.5 py-1 text-left transition-colors duration-120 ease-out hover:bg-surface-hover pointer-coarse:min-h-10"
      >
        <Icons.toolActivity aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
        <Caption as="span">{toolActivitySummary(tools, live)}</Caption>
        {anyRunning ? (
          <Icons.loading aria-hidden className="size-3.5 shrink-0 animate-spin text-muted-foreground" />
        ) : anyFailed ? (
          <Icons.alertWarning aria-hidden className="size-3.5 shrink-0 text-warning" />
        ) : (
          <Icons.approve aria-hidden className="size-3.5 shrink-0 text-success" />
        )}
        <Icons.chevronDown aria-hidden className={cn('size-3.5 shrink-0 text-muted-foreground transition-transform duration-180 ease-out', expanded && 'rotate-180')} />
      </CollapsibleTrigger>
      <CollapsiblePanel>
        <div className="mt-1 space-y-0.5 border-l-2 border-border pl-2">
          {tools.map((tool) => <ToolDetail key={tool.id} tool={tool} />)}
        </div>
      </CollapsiblePanel>
    </CollapsibleRoot>
  )
}
