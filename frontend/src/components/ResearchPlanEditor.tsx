import { useEffect, useId, useRef, useState } from 'react'
import { Icons } from '@/lib/icons'
import { ExecutableResearchPlan, type ExecutableResearchPlan as Plan } from '../data/research-plan'
import { WorkspaceOverlay } from './workspace-parts'
import { Markdown, planSectionIcon } from './Markdown'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Textarea } from './ui/textarea'
import { CollapsiblePanel, CollapsibleRoot, CollapsibleTrigger } from './ui/collapsible'

export function ExecutablePlanDetails({ plan }: { plan: Plan }) {
 return <section aria-label="Executable research work" className="mt-6 border-t border-border pt-6">
 <div className="flex items-center gap-2">
 <Icons.target className="size-4 shrink-0 text-muted-foreground" aria-hidden />
 <h3 className="text-sm font-medium">Approved work and limits</h3>
 <span className="ml-auto inline-flex items-center rounded-full border border-border px-2.5 py-0.5 text-xs text-muted-foreground select-none">{plan.researchDepth === 'discovery' ? 'Discovery only' : 'Discovery and research'}</span>
 </div>
 {plan.researchDepth === 'discovery' ? <p className="mt-2 rounded-lg bg-muted/40 px-3 py-2 text-xs text-muted-foreground">Company deep research will not run in this plan.</p> : null}
 <ol className="relative mt-5 ml-3.5 space-y-6 border-l-2 border-border pl-6">
 <li className="relative">
 <span aria-hidden className="absolute top-0 -left-6 flex size-7 -translate-x-1/2 items-center justify-center rounded-full border border-primary/25 bg-primary/10 text-primary">
 <Icons.users className="size-3.5" aria-hidden />
 </span>
 <h4 className="text-sm font-medium">Scope and budget</h4>
 <dl className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
 <div className="rounded-lg border border-border bg-background px-3 py-2.5">
 <dt className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Companies</dt>
 <dd className="mt-1 font-mono text-sm font-medium tabular-nums">{plan.discoveryTarget ? `${plan.discoveryTarget.toLocaleString()} companies` : `Up to ${plan.budgets.maxCompanies.toLocaleString()} companies`}</dd>
 </div>
 <div className="rounded-lg border border-border bg-background px-3 py-2.5">
 <dt className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-muted-foreground"><Icons.queued className="size-3.5 shrink-0" aria-hidden />Active time</dt>
 <dd className="mt-1 font-mono text-sm font-medium tabular-nums">{plan.budgets.maxWallMinutes} min</dd>
 </div>
 <div className="rounded-lg border border-border bg-background px-3 py-2.5">
 <dt className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-muted-foreground"><Icons.sector className="size-3.5 shrink-0" aria-hidden />Researchers</dt>
 <dd className="mt-1 font-mono text-sm font-medium tabular-nums">{plan.budgets.concurrency} concurrent</dd>
 </div>
 </dl>
 {plan.discoveryTarget ? (
 <p className="mt-2 text-xs text-muted-foreground">Target <span className="font-mono tabular-nums">{plan.discoveryTarget.toLocaleString()}</span> of up to <span className="font-mono tabular-nums">{plan.budgets.maxCompanies.toLocaleString()}</span> companies</p>
 ) : null}
 </li>
 {plan.discovery.map((direction) => <li key={direction.id} className="relative">
 <span aria-hidden className="absolute top-0 -left-6 flex size-7 -translate-x-1/2 items-center justify-center rounded-full border border-primary/25 bg-primary/10 text-primary">
 <Icons.steer className="size-3.5" aria-hidden />
 </span>
 <section aria-label={direction.title}>
 <div className="flex flex-wrap items-baseline gap-x-2">
 <h4 className="min-w-0 flex-1 text-sm font-medium break-words">{direction.title}</h4>
 <span className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground">Up to {direction.maxPages} pages/query</span>
 </div>
 <ol className="mt-2 space-y-2">{direction.queries.map((query, index) => <li key={index} className="flex gap-2.5"><span aria-hidden className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-primary/10 font-mono text-xs font-medium text-primary tabular-nums">{index + 1}</span><span className="min-w-0 flex-1 text-xs leading-relaxed text-foreground [overflow-wrap:anywhere]">{query}</span></li>)}</ol>
 </section>
 </li>)}
 <li className="relative">
 <span aria-hidden className="absolute top-0 -left-6 flex size-7 -translate-x-1/2 items-center justify-center rounded-full border border-primary/25 bg-primary/10 text-primary">
 <Icons.fileDocs className="size-3.5" aria-hidden />
 </span>
 <section aria-label="Research instructions">
 <h4 className="text-sm font-medium">Research instructions</h4>
 <BriefText text={plan.companyBrief} />
 </section>
 </li>
 <li className="relative">
 <span aria-hidden className="absolute top-0 -left-6 flex size-7 -translate-x-1/2 items-center justify-center rounded-full border border-primary/25 bg-primary/10 text-primary">
 <Icons.plan className="size-3.5" aria-hidden />
 </span>
 <section aria-label="Acceptance criteria">
 <h4 className="text-sm font-medium">Acceptance criteria</h4>
 <ol className="mt-2 space-y-2">{plan.acceptance.map((criterion, index) => <li key={index} className="flex gap-2.5"><span aria-hidden className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-primary/10 font-mono text-xs font-medium text-primary tabular-nums">{index + 1}</span><span className="min-w-0 flex-1 text-sm leading-relaxed text-foreground [overflow-wrap:anywhere]">{criterion}</span></li>)}</ol>
 </section>
 </li>
 </ol>
 </section>
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
 * The narrative brief as a curated timeline: every heading-led section
 * gets an icon medallion on a connecting rail (keyword glyphs, neutral
 * document icon for custom sections), with its body rendered underneath.
 * Arbitrary valid headings and all text survive untouched; the rail is
 * pure presentation. Used everywhere a plan brief appears so workspace,
 * progress dialog, and legacy views read identically.
 */
export function PlanBriefTimeline({ text }: { text: string }) {
 const { intro, sections } = splitBriefSections(text)
 if (!sections.length) return <Markdown text={text} />
 return (
 <div>
 {intro ? (
 <div className="mb-1 text-sm leading-relaxed text-muted-foreground">
 <Markdown text={intro} />
 </div>
 ) : null}
 <ol className="relative ml-3.5 space-y-5 border-l-2 border-border pl-6">
 {sections.map((section, index) => {
 const Icon = planSectionIcon(section.heading)
 const Tag = `h${Math.min(6, Math.max(2, section.level))}` as 'h2' | 'h3' | 'h4' | 'h5' | 'h6'
 const size = section.level <= 2 ? 'text-base' : section.level === 3 ? 'text-sm' : 'text-xs'
 return (
 <li key={`${index}:${section.heading}`} className="relative">
 <span aria-hidden className="absolute top-0 -left-6 flex size-7 -translate-x-1/2 items-center justify-center rounded-full border border-primary/25 bg-primary/10 text-primary">
 <Icon className="size-3.5" aria-hidden />
 </span>
 <div className="min-w-0">
 <Tag className={`font-medium ${size}`}>{section.heading}</Tag>
 {section.body ? (
 <div className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
 <Markdown text={section.body} />
 </div>
 ) : null}
 </div>
 </li>
 )
 })}
 </ol>
 </div>
 )
}

function BriefText({ text }: { text: string }) {
 const [expanded, setExpanded] = useState(false)
 const long = text.length > 500
 return (
 <div className="mt-2">
 <p className={`text-sm leading-relaxed break-words whitespace-pre-wrap [overflow-wrap:anywhere] ${long && !expanded ? 'line-clamp-6' : ''}`}>{text}</p>
 {long ? (
 <Button type="button" variant="ghost" size="sm" className="mt-1" onClick={() => setExpanded((value) => !value)}>
 {expanded ? 'Show less' : 'Show full instructions'}
 </Button>
 ) : null}
 </div>
 )
}

export function ResearchPlanEditor({ markdown, executable, busy, error, onSave }: {
 markdown: string; executable?: Plan; busy: boolean; error: string | null; onSave(markdown: string): Promise<boolean>
}) {
 const [open, setOpen] = useState(false)
 const formId = useId()
 return <><Button variant="ghost" size="sm" className="mt-3" disabled={busy} onClick={() => setOpen(true)}><Icons.edit className="size-4 shrink-0" aria-hidden />Edit plan</Button>
 <WorkspaceOverlay title="Edit research plan" open={open} onClose={() => setOpen(false)} footer={<><Button variant="outline" disabled={busy} onClick={() => setOpen(false)}>Cancel</Button><Button type="submit" form={formId} disabled={busy}>{busy ? 'Saving…' : 'Save plan'}</Button></>}>
 <PlanForm formId={formId} markdown={markdown} executable={executable} busy={busy} error={error} onSave={async (text) => { if (await onSave(text)) setOpen(false) }} />
 </WorkspaceOverlay>
 </>
}

function PlanForm({ formId, markdown, executable, busy, error, onSave }: {
 formId: string; markdown: string; executable?: Plan; busy: boolean; error: string | null; onSave(markdown: string): Promise<void>
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
 // The summary mounts with the errors, so focus follows the commit rather
 // than the submit handler (the node does not exist yet when validating).
 useEffect(() => {
 if (Object.keys(errors).length) summaryRef.current?.focus()
 }, [errors])
 const textClass = 'mt-2 block w-full rounded-lg border border-border bg-background p-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
 const errorClass = 'mt-1 text-xs text-destructive'

 function parseIntInRange(value: string, min: number, max: number): number | null {
 const trimmed = value.trim()
 if (!trimmed || !/^\d+$/.test(trimmed)) return null
 const parsed = Number(trimmed)
 if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) return null
 return parsed
 }

 return <form id={formId} className="space-y-4" noValidate onSubmit={(event) => {
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
 }}>
 <label className="block text-sm font-medium">Plan<Textarea rows={8} value={draft} onChange={(event) => setDraft(event.target.value)} aria-invalid={Boolean(errors.plan && !executable)} className="mt-2" /></label>
 {errors.plan && !executable ? <p role="alert" className="text-sm text-destructive">{errors.plan}</p> : null}
 {executable ? <>
 <h3 className="text-sm font-medium">Executable work</h3>
 <div className="focus:outline-none">
 {Object.keys(errors).length ? (
 <div ref={summaryRef} tabIndex={-1} role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 focus:outline-none focus-visible:ring-2 focus-visible:ring-destructive">
 <p className="text-sm font-medium text-destructive">Fix {Object.keys(errors).length === 1 ? 'this field' : 'these fields'} before saving.</p>
 <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm text-destructive">
 {Object.values(errors).map((message, index) => <li key={index}>{message}</li>)}
 </ul>
 </div>
 ) : null}
 </div>
 <label className="block text-sm">Research depth<select value={depth} onChange={(event) => setDepth(event.target.value === 'discovery' ? 'discovery' : 'company')} className={textClass}><option value="discovery">Discovery only</option><option value="company">Discovery and company research</option></select></label>
 {depth === 'discovery' ? <label className="block text-sm">Discovery target<Input type="number" min={1} max={2000} value={discoveryTarget} placeholder="1" onChange={(event) => setDiscoveryTarget(event.target.value)} aria-invalid={Boolean(errors.discoveryTarget)} className="mt-2" />{errors.discoveryTarget ? <span role="alert" className={errorClass}>{errors.discoveryTarget}</span> : null}</label> : null}
 {executable.discovery.map((direction) => <fieldset key={direction.id} className="space-y-3 rounded-lg border border-border p-3">
 <legend className="px-1 text-sm font-medium">{direction.title}</legend>
 <label className="block text-sm">Queries for {direction.title}<Textarea rows={3} value={queries[direction.id] ?? ''} onChange={(event) => setQueries((current) => ({ ...current, [direction.id]: event.target.value }))} aria-invalid={Boolean(errors[`queries:${direction.id}`])} className="mt-2" />{errors[`queries:${direction.id}`] ? <span role="alert" className={errorClass}>{errors[`queries:${direction.id}`]}</span> : null}</label>
 <label className="block text-sm">Pages per query for {direction.title}<Input type="number" min={1} max={10} value={maxPages[direction.id] ?? ''} placeholder="2" onChange={(event) => setMaxPages((current) => ({ ...current, [direction.id]: event.target.value }))} aria-invalid={Boolean(errors[`maxPages:${direction.id}`])} className="mt-2" />{errors[`maxPages:${direction.id}`] ? <span role="alert" className={errorClass}>{errors[`maxPages:${direction.id}`]}</span> : null}</label>
 </fieldset>)}
 <label className="block text-sm">Company limit<Input type="number" min={1} max={2000} value={maxCompanies} placeholder="2000" onChange={(event) => setMaxCompanies(event.target.value)} aria-invalid={Boolean(errors.maxCompanies)} className="mt-2" />{errors.maxCompanies ? <span role="alert" className={errorClass}>{errors.maxCompanies}</span> : null}</label>
 <label className="block text-sm">Active minutes<Input type="number" min={1} max={1440} value={maxWallMinutes} placeholder="60" onChange={(event) => setMaxWallMinutes(event.target.value)} aria-invalid={Boolean(errors.maxWallMinutes)} className="mt-2" />{errors.maxWallMinutes ? <span role="alert" className={errorClass}>{errors.maxWallMinutes}</span> : null}</label>
 <label className="block text-sm">Research instructions<Textarea rows={4} value={companyBrief} onChange={(event) => setCompanyBrief(event.target.value)} aria-invalid={Boolean(errors.companyBrief)} className="mt-2" />{errors.companyBrief ? <span role="alert" className={errorClass}>{errors.companyBrief}</span> : null}</label>
 <label className="block text-sm">Acceptance criteria<Textarea rows={3} value={acceptance} onChange={(event) => setAcceptance(event.target.value)} aria-invalid={Boolean(errors.acceptance)} className="mt-2" />{errors.acceptance ? <span role="alert" className={errorClass}>{errors.acceptance}</span> : null}</label>
 </> : <p className="rounded-lg bg-muted p-3 text-xs">This legacy plan has no executable work. Create a new executable plan before starting research.</p>}
 <p className="rounded-lg bg-muted p-3 text-xs text-muted-foreground">Editing an approved plan reopens review. Execution uses the queries and limits shown here.</p>
 {error ? <p role="alert" className="text-sm">{error}</p> : null}
 </form>
}

export function PlanVersionTimeline({ versions, latestVersion, approvedVersion }: {
 versions: { version: number; at: string }[]
 latestVersion: number
 approvedVersion?: number | null
}) {
 if (versions.length < 2) return null
 const ordered = [...versions].sort((a, b) => b.version - a.version)
 return (
 <CollapsibleRoot className="rounded-xl border border-border bg-background">
 <CollapsibleTrigger>
 <Icons.history className="size-4 shrink-0 text-muted-foreground" aria-hidden />
 <span className="min-w-0 flex-1 font-medium">Plan history</span>
 <span className="inline-flex shrink-0 items-center rounded-full border border-border px-2 py-0.5 font-mono text-xs tabular-nums text-muted-foreground select-none">{versions.length} versions</span>
 <Icons.chevronDown data-chevron className="size-4 shrink-0 text-muted-foreground" aria-hidden />
 </CollapsibleTrigger>
 <CollapsiblePanel>
 <ol className="space-y-1 border-t border-border px-4 py-3">
 {ordered.map((entry) => (
 <li key={entry.version} className="flex items-center gap-2 text-sm">
 <span className="inline-flex shrink-0 items-center rounded-full border border-border px-2 py-0.5 font-mono text-xs tabular-nums text-muted-foreground select-none">v{entry.version}</span>
 <time dateTime={entry.at} title={new Date(entry.at).toLocaleString()} className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
 {new Date(entry.at).toLocaleString()}
 </time>
 {approvedVersion === entry.version ? (
 <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary select-none">
 <Icons.approve className="size-3 shrink-0" aria-hidden />Approved
 </span>
 ) : null}
 {entry.version === latestVersion && approvedVersion !== entry.version ? (
 <span className="shrink-0 text-xs text-muted-foreground">Current</span>
 ) : null}
 </li>
 ))}
 </ol>
 </CollapsiblePanel>
 </CollapsibleRoot>
 )
}
