import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { Icons } from '@/lib/icons'
import { cn } from '@/lib/utils'
import { ExecutableResearchPlan, type ExecutableResearchPlan as Plan } from '../data/research-plan'
import { CounterTile, WorkspaceOverlay } from './workspace-parts'
import { Markdown, planSectionIcon } from './Markdown'
import { planSectionLabel } from '../lib/labels'
import { formatCount, formatDurationMs } from '../lib/format'
import { BodySm, Caption, CardTitle, Description, Label, Mono } from './text'
import { Badge } from './ui/badge'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Textarea } from './ui/textarea'
import { SelectItem, SelectPopup, SelectRoot, SelectTrigger } from './ui/select'
import { CollapsiblePanel, CollapsibleRoot, CollapsibleTrigger } from './ui/collapsible'
import { List, ListRow } from './ui/list'
import { ConfirmAction } from './ui/alert-dialog'
import { PlanSteps, type PlanStep, type PlanStepTone } from './plan/PlanSteps'

/** Work-item fields the running-state step mapping reads. Structural so
 * both the live progress type and fixtures fit without coupling. */
export interface PlanWorkItemRef {
  id: string
  title: string
  state: string
}

/**
 * Running-state tone by work-item linkage: an item links to a direction
 * when its id carries the direction id or its title names the direction.
 * Unlinked steps stay neutral (never guessed).
 */
function directionTone(direction: { id: string; title: string }, items: PlanWorkItemRef[]): PlanStepTone {
  const needle = direction.title.toLowerCase()
  const linked = items.filter(
    (item) => item.id === direction.id || item.id.startsWith(`${direction.id}:`) || item.title.toLowerCase().includes(needle),
  )
  if (!linked.length) return 'default'
  if (linked.some((item) => item.state === 'running')) return 'running'
  if (linked.every((item) => item.state === 'complete')) return 'success'
  return 'default'
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`
}

function QueryList({ lines }: { lines: string[] }) {
  return (
    <ol className="flex min-w-0 flex-col gap-2">
      {lines.map((line, index) => (
        <li key={index} className="flex min-w-0 gap-2.5">
          <Mono aria-hidden className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-primary-soft text-xs text-primary-text tabular-nums">
            {index + 1}
          </Mono>
          <BodySm as="span" className="min-w-0 flex-1 [overflow-wrap:anywhere]">
            {line}
          </BodySm>
        </li>
      ))}
    </ol>
  )
}

/** At-a-glance tiles (PL-02): limits and counts above the steps. */
function PlanGlance({ plan }: { plan: Plan }) {
  const queryCount = plan.discovery.reduce((total, direction) => total + direction.queries.length, 0)
  return (
    <div>
      <div role="group" aria-label="Plan limits" className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <CounterTile label="Target" value={plan.discoveryTarget ? `${formatCount(plan.discoveryTarget)} companies` : `Up to ${formatCount(plan.budgets.maxCompanies)}`} />
        <CounterTile label="Company limit" value={formatCount(plan.budgets.maxCompanies)} />
        <CounterTile label="Active time" value={`${formatDurationMs(plan.budgets.maxWallMinutes * 60_000)} max`} />
        <CounterTile label="Researchers" value={`${plan.budgets.concurrency} at a time`} />
        <CounterTile label="Search directions" value={plan.discovery.length} />
        <CounterTile label="Queries" value={queryCount} />
      </div>
      {plan.researchDepth === 'discovery' ? (
        <Caption className="mt-2">Discovery only: company deep research will not run in this plan.</Caption>
      ) : null}
    </div>
  )
}

/** Executable work as glance tiles plus the steps timeline (PL-02/PL-03).
 * `workItems` drives running-state medallions; `onStart` renders the
 * inline Start research action on the final step when approved. */
export function ExecutablePlanDetails({
  plan,
  workItems = [],
  researchState,
  onStart,
}: {
  plan: Plan
  workItems?: PlanWorkItemRef[]
  researchState?: string
  onStart?(): void
}) {
  const steps: PlanStep[] = [
    ...plan.discovery.map((direction, index) => ({
      id: direction.id,
      title: direction.title,
      meta: `${plural(direction.queries.length, 'query', 'queries')} · ${direction.maxPages} ${direction.maxPages === 1 ? 'page' : 'pages'} each`,
      stepNumber: index + 1,
      tone: directionTone(direction, workItems),
      body: <QueryList lines={direction.queries} />,
    })),
    {
      id: 'instructions',
      title: 'Research instructions',
      icon: Icons.fileDocs,
      body: <BriefText text={plan.companyBrief} />,
    },
    {
      id: 'acceptance',
      title: 'Acceptance criteria',
      icon: Icons.plan,
      body: <QueryList lines={plan.acceptance} />,
    },
    {
      id: 'ready',
      title: 'Ready to start',
      icon: Icons.play,
      body: (
        <div className="flex min-w-0 flex-col gap-3">
          <Description>Research runs within the limits above once you press Start research.</Description>
          {researchState === 'approved' && onStart ? (
            <div>
              <Button type="button" variant="primary" size="sm" onClick={onStart}>
                <Icons.play aria-hidden />
                Start research
              </Button>
            </div>
          ) : null}
        </div>
      ),
    },
  ]
  return (
    <section aria-label="Executable research work" className="mt-6 border-t border-border-subtle pt-6">
      <PlanGlance plan={plan} />
      <div className="mt-6">
        <PlanSteps steps={steps} label="Executable research steps" />
      </div>
    </section>
  )
}

export interface BriefSection {
 heading: string
 level: number
 body: string
}

/** Split a narrative brief into its heading-led sections. Fenced code is
 * opaque (a `#` inside a code block never starts a section), ATX headings
 * of any level split, and every line (including sparse bodies like
 * "None.") is preserved verbatim. Styling only: sections are never
 * interpreted for scope or authority. */
export function splitBriefSections(markdown: string): { intro: string; sections: BriefSection[] } {
 const intro: string[] = []
 const sections: BriefSection[] = []
 let parts: string[] | null = null
 let fenced = false
 const trim = (text: string) => text.replace(/^\n+/, '').replace(/\s+$/, '')
 for (const line of markdown.split('\n')) {
 if (/^\s*```/.test(line)) {
 fenced = !fenced
 }
 const match = !fenced ? /^\s{0,3}(#{1,4})\s+(.+?)\s*$/.exec(line) : null
 if (match) {
 parts = []
 sections.push({ heading: match[2]!, level: match[1]!.length, body: '' })
 continue
 }
 if (parts) {
 parts.push(line)
 sections[sections.length - 1]!.body = trim(parts.join('\n'))
 } else {
 intro.push(line)
 }
 }
 return { intro: trim(intro.join('\n')), sections }
}

/**
 * The narrative brief as a curated timeline (PL-04): every heading-led
 * section gets a medallion step with a humanized title and compact body.
 * Arbitrary valid headings and all text survive untouched; the timeline
 * is pure presentation. Used everywhere a plan brief appears so
 * workspace, progress dialog, and legacy views read identically.
 */
export function PlanBriefTimeline({ text }: { text: string }) {
 const { intro, sections } = splitBriefSections(text)
 if (!sections.length) return <Markdown text={text} variant="compact" />
 return (
 <div>
 {intro ? (
 <div className="mb-5">
 <Markdown text={intro} variant="compact" />
 </div>
 ) : null}
 <PlanSteps
 label="Plan brief"
 steps={sections.map((section, index) => ({
 id: `${index}:${section.heading}`,
 title: planSectionLabel(section.heading),
 icon: planSectionIcon(section.heading),
 body: section.body ? <Markdown text={section.body} variant="compact" /> : undefined,
 }))}
 />
 </div>
 )
}

/** Narrative-only warning (PL-04): shown with the brief when no
 * executable block exists. */
export function NarrativePlanWarning({ onEdit }: { onEdit?(): void }) {
 return (
 <div role="alert" className="flex gap-2 rounded-md border border-warning-border bg-warning-soft p-3">
 <span className="flex h-5 shrink-0 items-center">
 <Icons.alertWarning aria-hidden className="size-4 text-warning" />
 </span>
 <div className="min-w-0 flex-1">
 <BodySm as="span">This plan has no executable search steps yet. Edit the plan or ask the agent to regenerate it before starting.</BodySm>
 {onEdit ? (
 <div className="mt-2">
 <Button type="button" variant="secondary" size="sm" onClick={onEdit}>
 <Icons.edit aria-hidden />
 Edit plan
 </Button>
 </div>
 ) : null}
 </div>
 </div>
 )
}

function BriefText({ text }: { text: string }) {
 const [expanded, setExpanded] = useState(false)
 const long = text.length > 500
 return (
 <div>
 <div className={cn('overflow-hidden transition-[max-height] duration-180 ease-out motion-reduce:transition-none', long && !expanded ? 'max-h-[120px]' : 'max-h-[4000px]')}>
 <BodySm className="break-words whitespace-pre-wrap [overflow-wrap:anywhere]">{text}</BodySm>
 </div>
 {long ? (
 <Button type="button" variant="link" size="sm" className="mt-1 px-0" onClick={() => setExpanded((value) => !value)}>
 {expanded ? 'Show less' : 'Show full instructions'}
 </Button>
 ) : null}
 </div>
 )
}

/** Edit plan entry (PL-07): secondary trigger plus the 640px edit
 * sheet. Controlled when `open`/`onOpenChange` are given (so the
 * narrative warning can open the sheet); uncontrolled otherwise. */
export function ResearchPlanEditor({
 markdown,
 executable,
 busy,
 error,
 onSave,
 open: controlledOpen,
 onOpenChange,
}: {
 markdown: string; executable?: Plan; busy: boolean; error: string | null; onSave(markdown: string): Promise<boolean>
 open?: boolean; onOpenChange?(open: boolean): void
}) {
 const [uncontrolled, setUncontrolled] = useState(false)
 const [dirty, setDirty] = useState(false)
 const [confirming, setConfirming] = useState(false)
 const formId = useId()
 const open = controlledOpen ?? uncontrolled
 function setOpen(next: boolean) {
 if (controlledOpen === undefined) setUncontrolled(next)
 onOpenChange?.(next)
 }
 function requestClose() {
 // Pending saves cannot be closed; dirty drafts confirm first.
 if (busy) return
 if (dirty) {
 setConfirming(true)
 return
 }
 setOpen(false)
 }
 return (
 <>
 <Button type="button" variant="secondary" size="sm" disabled={busy} onClick={() => { setDirty(false); setOpen(true) }}>
 <Icons.edit aria-hidden />
 Edit plan
 </Button>
 <WorkspaceOverlay
 title="Edit research plan"
 side
 popupClassName="w-[min(92vw,640px)]"
 open={open}
 onClose={requestClose}
 footer={
 <>
 <Button type="button" variant="secondary" disabled={busy} onClick={requestClose}>Cancel</Button>
 <Button type="submit" form={formId} pending={busy}>Save plan</Button>
 </>
 }
 >
 {open ? (
 <PlanForm
 formId={formId}
 markdown={markdown}
 executable={executable}
 busy={busy}
 error={error}
 onDirtyChange={setDirty}
 onSave={async (text) => { if (await onSave(text)) { setDirty(false); setOpen(false) } }}
 />
 ) : null}
 </WorkspaceOverlay>
 <ConfirmAction
 open={confirming}
 onOpenChange={setConfirming}
 title="Discard changes?"
 description="Your edits will be lost."
 confirmLabel="Discard"
 onConfirm={() => { setDirty(false); setConfirming(false); setOpen(false) }}
 />
 </>
 )
}

function PlanForm({ formId, markdown, executable, busy, error, onDirtyChange, onSave }: {
 formId: string; markdown: string; executable?: Plan; busy: boolean; error: string | null; onDirtyChange(dirty: boolean): void; onSave(markdown: string): Promise<void>
}) {
 // Freeze the opening version. Background polling never overwrites edits.
 const [draft, setDraft] = useState(markdown)
 // Numeric drafts stay strings while editing: a temporary blank is empty,
 // never coerced to an unintended zero. Parsing happens only on submit.
 const [depth, setDepth] = useState(executable?.researchDepth ?? 'company')
 // Whether a discovery target was ever set: clearing a populated target
 // is an explicit removal and must error, while a target that was never
 // set stays unset (the schema leaves it optional). Neither case coerces
 // a blank to a silent default.
 const [initialTarget] = useState(executable?.discoveryTarget?.toString() ?? '')
 const [discoveryTarget, setDiscoveryTarget] = useState(executable?.discoveryTarget?.toString() ?? '')
 const [queries, setQueries] = useState<Record<string, string>>(() =>
 Object.fromEntries((executable?.discovery ?? []).map((direction) => [direction.id, direction.queries.join('\n')])),
 )
 const [maxPages, setMaxPages] = useState<Record<string, string>>(() =>
 Object.fromEntries((executable?.discovery ?? []).map((direction) => [direction.id, direction.maxPages.toString()])),
 )
 const [maxCompanies, setMaxCompanies] = useState(executable?.budgets.maxCompanies.toString() ?? '')
 const [maxWallMinutes, setMaxWallMinutes] = useState(executable?.budgets.maxWallMinutes.toString() ?? '')
 const [companyBrief, setCompanyBrief] = useState(executable?.companyBrief ?? '')
 const [acceptance, setAcceptance] = useState(executable?.acceptance.join('\n') ?? '')
 const [errors, setErrors] = useState<Record<string, string>>({})
 const summaryRef = useRef<HTMLDivElement>(null)
 const fieldRefs = useRef<Record<string, HTMLElement | null>>({})
 // The summary mounts with the errors, so focus follows the commit rather
 // than the submit handler (the node does not exist yet when validating).
 useEffect(() => {
 if (Object.keys(errors).length) summaryRef.current?.focus()
 }, [errors])
 const baseId = useId()
 const fieldId = (key: string) => `${baseId}-${key.replace(/[^a-z0-9]+/gi, '-')}`
 const errorId = (key: string) => `${fieldId(key)}-error`
 const hintId = (key: string) => `${fieldId(key)}-hint`

 function parseIntInRange(value: string, min: number, max: number): number | null {
 const trimmed = value.trim()
 if (!trimmed || !/^\d+$/.test(trimmed)) return null
 const parsed = Number(trimmed)
 if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) return null
 return parsed
 }

 function labelFor(key: string): string {
 if (key === 'plan') return 'Plan text'
 if (key === 'discoveryTarget') return 'Discovery target'
 if (key === 'maxCompanies') return 'Company limit'
 if (key === 'maxWallMinutes') return 'Active minutes'
 if (key === 'companyBrief') return 'Research instructions'
 if (key === 'acceptance') return 'Acceptance criteria'
 if (executable) {
 const [kind, id] = key.split(':')
 const direction = executable.discovery.find((entry) => entry.id === id)
 if (direction) {
 if (kind === 'queries') return `Queries for ${direction.title}`
 if (kind === 'maxPages') return `Pages per query for ${direction.title}`
 }
 }
 return 'Plan text'
 }

 function markDirty() {
 onDirtyChange(true)
 }

 function submit(event: FormEvent) {
 event.preventDefault()
 if (busy) return
 const next: Record<string, string> = {}
 if (!draft.trim()) next.plan = 'Plan text is required.'
 let parsed: Plan | undefined
 if (executable) {
 // Blank stays blank until submit: no temporary empty ever coerces to
 // an unintended default. An explicitly cleared target errors instead
 // of silently becoming one; a never-set target stays unset.
 const parsedTarget =
 depth === 'discovery'
 ? discoveryTarget === ''
 ? initialTarget === '' ? undefined : null
 : parseIntInRange(discoveryTarget, 1, 2000)
 : undefined
 if (depth === 'discovery' && parsedTarget === null) next.discoveryTarget = 'Enter a discovery target from 1 to 2000.'
 const parsedCompanies = parseIntInRange(maxCompanies, 1, 2000)
 if (parsedCompanies === null) next.maxCompanies = 'Enter a company limit from 1 to 2000.'
 const parsedMinutes = parseIntInRange(maxWallMinutes, 1, 1440)
 if (parsedMinutes === null) next.maxWallMinutes = 'Enter active minutes from 1 to 1440.'
 if (parsedTarget !== undefined && parsedTarget !== null && parsedCompanies !== null && parsedTarget > parsedCompanies) {
 next.discoveryTarget = 'Discovery target must not exceed the company limit.'
 }
 const parsedDirections: Plan['discovery'] = []
 for (const direction of executable.discovery) {
 const lines = (queries[direction.id] ?? '').split('\n').map((line) => line.trim()).filter(Boolean)
 if (!lines.length || lines.length > 30 || lines.some((line) => line.length > 300)) {
 next[`queries:${direction.id}`] = `Enter 1 to 30 queries for ${direction.title}, each under 300 characters.`
 continue
 }
 const pages = parseIntInRange(maxPages[direction.id] ?? '', 1, 10)
 if (pages === null) {
 next[`maxPages:${direction.id}`] = `Enter pages per query from 1 to 10 for ${direction.title}.`
 continue
 }
 parsedDirections.push({ ...direction, queries: lines, maxPages: pages })
 }
 const brief = companyBrief.trim()
 if (!brief || brief.length > 12000) next.companyBrief = 'Enter research instructions under 12,000 characters.'
 const criteria = acceptance.split('\n').map((line) => line.trim()).filter(Boolean)
 if (!criteria.length || criteria.length > 20) next.acceptance = 'Enter 1 to 20 acceptance criteria.'
 if (!Object.keys(next).length) {
 // Invariant backstop, not a default: every null above already
 // recorded its field error, so reaching here with one is
 // impossible; it surfaces as a form error, never a silent value.
 if (parsedTarget === null || parsedCompanies === null || parsedMinutes === null) {
 next.plan = 'Check the queries, limits and acceptance criteria. All fields must be valid.'
 } else {
 parsed = {
 researchDepth: depth,
 discoveryTarget: depth === 'discovery' ? parsedTarget : undefined,
 discovery: parsedDirections,
 companyBrief: brief,
 budgets: { maxCompanies: parsedCompanies, maxWallMinutes: parsedMinutes, concurrency: 2 },
 acceptance: criteria,
 }
 if (!ExecutableResearchPlan.safeParse(parsed).success) next.plan = 'Check the queries, limits and acceptance criteria. All fields must be valid.'
 }
 }
 }
 setErrors(next)
 if (Object.keys(next).length) {
 return
 }
 void onSave(parsed ? `${draft.trim()}\n\n\`\`\`research-plan\n${JSON.stringify(parsed)}\n\`\`\`` : draft)
 }

 function fieldError(key: string) {
 const message = errors[key]
 if (!message) return null
 return <span role="alert" id={errorId(key)} className="text-xs text-danger">{message}</span>
 }

 return (
 <form id={formId} className="flex min-w-0 flex-col gap-4" noValidate onSubmit={submit}>
 {executable && Object.keys(errors).length ? (
 <div ref={summaryRef} tabIndex={-1} role="alert" className="rounded-md border border-danger-border bg-danger-soft p-3 outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
 <BodySm as="span" className="font-medium text-danger">Fix {Object.keys(errors).length === 1 ? 'this field' : 'these fields'} before saving.</BodySm>
 <ul className="mt-1.5 flex flex-col gap-1">
 {Object.keys(errors).map((key) => (
 <li key={key}>
 <Button type="button" variant="link" size="sm" className="h-auto p-0 text-left text-danger" onClick={() => fieldRefs.current[key]?.focus()}>
 {labelFor(key)}: {errors[key]}
 </Button>
 </li>
 ))}
 </ul>
 </div>
 ) : null}
 <section aria-label="Plan text" className="flex min-w-0 flex-col gap-1.5">
 <Label as="label" htmlFor={fieldId('plan')}>Plan text</Label>
 <Textarea
 id={fieldId('plan')}
 rows={10}
 value={draft}
 onChange={(event) => { markDirty(); setDraft(event.target.value) }}
 invalid={Boolean(errors.plan)}
 aria-describedby={hintId('plan')}
 ref={(node) => { fieldRefs.current.plan = node }}
 />
 <Caption id={hintId('plan')}>Markdown supported.</Caption>
 {fieldError('plan')}
 </section>
 {executable ? (
 <>
 <section aria-label="Search" className="flex min-w-0 flex-col gap-4 border-t border-border-subtle pt-4">
 <CardTitle>Search</CardTitle>
 <div className="flex min-w-0 flex-col gap-1.5">
 <Label as="label" htmlFor={fieldId('depth')}>Research depth</Label>
 <SelectRoot value={depth} onValueChange={(value) => { markDirty(); setDepth(value === 'discovery' ? 'discovery' : 'company') }}>
 <SelectTrigger id={fieldId('depth')} ref={(node) => { fieldRefs.current.depth = node }} />
 <SelectPopup>
 <SelectItem value="discovery">Discovery only</SelectItem>
 <SelectItem value="company">Discovery and company research</SelectItem>
 </SelectPopup>
 </SelectRoot>
 </div>
 {depth === 'discovery' ? (
 <div className="flex min-w-0 flex-col gap-1.5">
 <Label as="label" htmlFor={fieldId('discoveryTarget')}>Discovery target</Label>
 <Input
 id={fieldId('discoveryTarget')}
 type="number"
 min={1}
 max={2000}
 value={discoveryTarget}
 placeholder="1"
 onChange={(event) => { markDirty(); setDiscoveryTarget(event.target.value) }}
 aria-invalid={errors.discoveryTarget ? true : undefined}
 aria-describedby={errors.discoveryTarget ? errorId('discoveryTarget') : undefined}
 ref={(node) => { fieldRefs.current.discoveryTarget = node }}
 />
 {fieldError('discoveryTarget')}
 </div>
 ) : null}
 </section>
 <section aria-label="Search directions" className="flex min-w-0 flex-col gap-3 border-t border-border-subtle pt-4">
 <CardTitle>Search directions</CardTitle>
 {executable.discovery.map((direction) => {
 const lineCount = (queries[direction.id] ?? '').split('\n').map((line) => line.trim()).filter(Boolean).length
 return (
 <fieldset key={direction.id} className="flex min-w-0 flex-col gap-3 rounded-lg border border-border p-3">
 <legend className="px-1"><Label as="span">{direction.title}</Label></legend>
 <div className="flex min-w-0 flex-col gap-1.5">
 <Label as="label" htmlFor={fieldId(`queries:${direction.id}`)}>Queries for {direction.title}</Label>
 <Textarea
 id={fieldId(`queries:${direction.id}`)}
 rows={3}
 value={queries[direction.id] ?? ''}
 onChange={(event) => { markDirty(); setQueries((current) => ({ ...current, [direction.id]: event.target.value })) }}
 invalid={Boolean(errors[`queries:${direction.id}`])}
 aria-describedby={`${hintId(`queries:${direction.id}`)}${errors[`queries:${direction.id}`] ? ` ${errorId(`queries:${direction.id}`)}` : ''}`}
 ref={(node) => { fieldRefs.current[`queries:${direction.id}`] = node }}
 />
 <Caption id={hintId(`queries:${direction.id}`)} aria-live="polite" className="tabular-nums">{lineCount} of 30 queries</Caption>
 {fieldError(`queries:${direction.id}`)}
 </div>
 <div className="flex min-w-0 flex-col gap-1.5">
 <Label as="label" htmlFor={fieldId(`maxPages:${direction.id}`)}>Pages per query for {direction.title}</Label>
 <Input
 id={fieldId(`maxPages:${direction.id}`)}
 type="number"
 min={1}
 max={10}
 value={maxPages[direction.id] ?? ''}
 placeholder="2"
 onChange={(event) => { markDirty(); setMaxPages((current) => ({ ...current, [direction.id]: event.target.value })) }}
 aria-invalid={errors[`maxPages:${direction.id}`] ? true : undefined}
 aria-describedby={errors[`maxPages:${direction.id}`] ? errorId(`maxPages:${direction.id}`) : undefined}
 ref={(node) => { fieldRefs.current[`maxPages:${direction.id}`] = node }}
 />
 {fieldError(`maxPages:${direction.id}`)}
 </div>
 </fieldset>
 )
 })}
 </section>
 <section aria-label="Limits" className="flex min-w-0 flex-col gap-4 border-t border-border-subtle pt-4">
 <CardTitle>Limits</CardTitle>
 <div className="grid gap-4 sm:grid-cols-2">
 <div className="flex min-w-0 flex-col gap-1.5">
 <Label as="label" htmlFor={fieldId('maxCompanies')}>Company limit</Label>
 <Input
 id={fieldId('maxCompanies')}
 type="number"
 min={1}
 max={2000}
 value={maxCompanies}
 placeholder="2000"
 onChange={(event) => { markDirty(); setMaxCompanies(event.target.value) }}
 aria-invalid={errors.maxCompanies ? true : undefined}
 aria-describedby={errors.maxCompanies ? errorId('maxCompanies') : undefined}
 ref={(node) => { fieldRefs.current.maxCompanies = node }}
 />
 {fieldError('maxCompanies')}
 </div>
 <div className="flex min-w-0 flex-col gap-1.5">
 <Label as="label" htmlFor={fieldId('maxWallMinutes')}>Active minutes</Label>
 <Input
 id={fieldId('maxWallMinutes')}
 type="number"
 min={1}
 max={1440}
 value={maxWallMinutes}
 placeholder="60"
 onChange={(event) => { markDirty(); setMaxWallMinutes(event.target.value) }}
 aria-invalid={errors.maxWallMinutes ? true : undefined}
 aria-describedby={errors.maxWallMinutes ? errorId('maxWallMinutes') : undefined}
 ref={(node) => { fieldRefs.current.maxWallMinutes = node }}
 />
 {fieldError('maxWallMinutes')}
 </div>
 </div>
 </section>
 <section aria-label="Research instructions" className="flex min-w-0 flex-col gap-1.5 border-t border-border-subtle pt-4">
 <Label as="label" htmlFor={fieldId('companyBrief')}>Research instructions</Label>
 <Textarea
 id={fieldId('companyBrief')}
 rows={4}
 value={companyBrief}
 onChange={(event) => { markDirty(); setCompanyBrief(event.target.value) }}
 invalid={Boolean(errors.companyBrief)}
 aria-describedby={errors.companyBrief ? errorId('companyBrief') : undefined}
 ref={(node) => { fieldRefs.current.companyBrief = node }}
 />
 {fieldError('companyBrief')}
 </section>
 <section aria-label="Acceptance criteria" className="flex min-w-0 flex-col gap-1.5 border-t border-border-subtle pt-4">
 <Label as="label" htmlFor={fieldId('acceptance')}>Acceptance criteria</Label>
 <Textarea
 id={fieldId('acceptance')}
 rows={3}
 value={acceptance}
 onChange={(event) => { markDirty(); setAcceptance(event.target.value) }}
 invalid={Boolean(errors.acceptance)}
 aria-describedby={`${hintId('acceptance')}${errors.acceptance ? ` ${errorId('acceptance')}` : ''}`}
 ref={(node) => { fieldRefs.current.acceptance = node }}
 />
 <Caption id={hintId('acceptance')} aria-live="polite" className="tabular-nums">
 {acceptance.split('\n').map((line) => line.trim()).filter(Boolean).length} of 20 criteria, one per line
 </Caption>
 {fieldError('acceptance')}
 </section>
 </>
 ) : (
 <div className="rounded-md border border-border bg-surface-sunken p-3">
 <BodySm as="span">This legacy plan has no executable work. Create a new executable plan before starting research.</BodySm>
 </div>
 )}
 <Description>Editing an approved plan reopens review. Execution uses the queries and limits shown here.</Description>
 {error ? (
 <p role="alert" className="flex gap-2 rounded-md border border-danger-border bg-danger-soft p-3 text-ui text-danger">
 <Icons.alertError aria-hidden className="size-4 shrink-0" />
 {error}
 </p>
 ) : null}
 </form>
 )
}

export function PlanVersionTimeline({ versions, latestVersion, approvedVersion }: {
 versions: { version: number; at: string }[]
 latestVersion: number
 approvedVersion?: number | null
}) {
 if (versions.length < 2) return null
 const ordered = [...versions].sort((a, b) => b.version - a.version)
 return (
 <CollapsibleRoot>
 <CollapsibleTrigger>
 <Icons.history aria-hidden className="size-4 shrink-0 text-muted-foreground" />
 <span className="min-w-0 flex-1 text-left">Version history</span>
 <Caption as="span" className="shrink-0 tabular-nums">{versions.length} versions</Caption>
 <Icons.chevronDown data-chevron aria-hidden className="size-4 shrink-0 text-muted-foreground" />
 </CollapsibleTrigger>
 <CollapsiblePanel>
 <div className="px-2 pt-1 pb-2">
 <List aria-label="Plan versions">
 {ordered.map((entry) => (
 <ListRow key={entry.version} density="dense">
 <Mono className="shrink-0 tabular-nums">v{entry.version}</Mono>
 <Caption as="span" className="min-w-0 flex-1 truncate">
 <time dateTime={entry.at} title={new Date(entry.at).toLocaleString()}>
 {new Date(entry.at).toLocaleString()}
 </time>
 </Caption>
 {approvedVersion === entry.version ? (
 <Badge tone="success"><Icons.approve aria-hidden />Approved</Badge>
 ) : null}
 {entry.version === latestVersion && approvedVersion !== entry.version ? (
 <Badge tone="neutral">Current</Badge>
 ) : null}
 </ListRow>
 ))}
 </List>
 </div>
 </CollapsiblePanel>
 </CollapsibleRoot>
 )
}
