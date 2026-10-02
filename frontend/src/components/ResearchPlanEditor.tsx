import { useId, useState } from 'react'
import { Check, Clock, Compass, FileText, Layers, ListChecks, Pencil, Target, Users } from 'lucide-react'
import { ExecutableResearchPlan, type ExecutableResearchPlan as Plan } from '../data/research-plan'
import { WorkspaceOverlay } from './workspace-parts'
import { Button } from './ui/button'
import { Input } from './ui/input'

export function ExecutablePlanDetails({ plan }: { plan: Plan }) {
  return <section aria-label="Executable research work" className="mt-6 space-y-4 border-t border-border pt-6">
    <div className="flex items-center gap-2">
      <Target className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      <h3 className="text-sm font-semibold tracking-tight">Approved work and limits</h3>
      <span className="ml-auto inline-flex items-center rounded-full border border-border px-2.5 py-0.5 text-xs text-muted-foreground select-none">{plan.researchDepth === 'discovery' ? 'Discovery only' : 'Discovery and research'}</span>
    </div>
    {plan.researchDepth === 'discovery' ? <p className="rounded-lg bg-muted/40 px-3 py-2 text-xs text-muted-foreground">Company deep research will not run in this plan.</p> : null}
    <dl className="grid grid-cols-1 gap-2 sm:grid-cols-3">
      <div className="rounded-lg border border-border bg-background px-3 py-2.5">
        <dt className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-muted-foreground"><Users className="size-3.5 shrink-0" aria-hidden />Companies</dt>
        <dd className="mt-1 font-mono text-sm font-semibold tabular-nums">{plan.discoveryTarget ? `${plan.discoveryTarget.toLocaleString()} companies` : `Up to ${plan.budgets.maxCompanies.toLocaleString()} companies`}</dd>
      </div>
      <div className="rounded-lg border border-border bg-background px-3 py-2.5">
        <dt className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-muted-foreground"><Clock className="size-3.5 shrink-0" aria-hidden />Active time</dt>
        <dd className="mt-1 font-mono text-sm font-semibold tabular-nums">{plan.budgets.maxWallMinutes} min</dd>
      </div>
      <div className="rounded-lg border border-border bg-background px-3 py-2.5">
        <dt className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-muted-foreground"><Layers className="size-3.5 shrink-0" aria-hidden />Researchers</dt>
        <dd className="mt-1 font-mono text-sm font-semibold tabular-nums">{plan.budgets.concurrency} concurrent</dd>
      </div>
    </dl>
    {plan.discovery.map((direction) => <section key={direction.id} aria-label={direction.title} className="rounded-xl border border-border bg-background p-4">
      <div className="flex items-center gap-2">
        <Compass className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        <h4 className="min-w-0 flex-1 truncate text-sm font-semibold">{direction.title}</h4>
        <span className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground">Up to {direction.maxPages} pages/query</span>
      </div>
      <ul className="mt-3 flex flex-wrap gap-1.5">{direction.queries.map((query, index) => <li key={index} className="max-w-full truncate rounded-full border border-border bg-muted/40 px-2.5 py-1 text-xs" title={query}>{query}</li>)}</ul>
    </section>)}
    <section aria-label="Research instructions" className="rounded-xl border border-border bg-background p-4">
      <div className="flex items-center gap-2"><FileText className="size-4 shrink-0 text-muted-foreground" aria-hidden /><h4 className="text-sm font-semibold">Research instructions</h4></div>
      <p className="mt-2 text-sm leading-relaxed break-words whitespace-pre-wrap">{plan.companyBrief}</p>
    </section>
    <section aria-label="Acceptance criteria" className="rounded-xl border border-border bg-background p-4">
      <div className="flex items-center gap-2"><ListChecks className="size-4 shrink-0 text-muted-foreground" aria-hidden /><h4 className="text-sm font-semibold">Acceptance criteria</h4></div>
      <ul className="mt-2 space-y-1.5">{plan.acceptance.map((criterion, index) => <li key={index} className="flex items-start gap-2 text-sm break-words"><Check className="mt-0.5 size-3.5 shrink-0 text-primary" aria-hidden /><span className="min-w-0">{criterion}</span></li>)}</ul>
    </section>
  </section>
}

export function ResearchPlanEditor({ markdown, executable, busy, error, onSave }: {
  markdown: string; executable?: Plan; busy: boolean; error: string | null; onSave(markdown: string): Promise<boolean>
}) {
  const [open, setOpen] = useState(false)
  const formId = useId()
  return <><Button variant="ghost" size="sm" className="mt-3" disabled={busy} onClick={() => setOpen(true)}><Pencil className="size-4 shrink-0" aria-hidden />Edit plan</Button>
    {open ? <WorkspaceOverlay title="Edit research plan" onClose={() => setOpen(false)} footer={<><Button variant="outline" disabled={busy} onClick={() => setOpen(false)}>Cancel</Button><Button type="submit" form={formId} disabled={busy}>{busy ? 'Saving…' : 'Save plan'}</Button></>}>
      <PlanForm formId={formId} markdown={markdown} executable={executable} busy={busy} error={error} onSave={async (text) => { if (await onSave(text)) setOpen(false) }} />
    </WorkspaceOverlay> : null}
  </>
}

function PlanForm({ formId, markdown, executable, busy, error, onSave }: {
  formId: string; markdown: string; executable?: Plan; busy: boolean; error: string | null; onSave(markdown: string): Promise<void>
}) {
  // Freeze the opening version. Background polling never overwrites edits.
  const [draft, setDraft] = useState(markdown)
  const [plan, setPlan] = useState(executable)
  const [validation, setValidation] = useState<string | null>(null)
  const textClass = 'mt-2 block w-full rounded-lg border border-border bg-background p-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
  return <form id={formId} className="space-y-4" onSubmit={(event) => {
    event.preventDefault()
    if (busy) return
    if (!draft.trim()) { setValidation('Plan text is required.'); return }
    if (plan && !ExecutableResearchPlan.safeParse(plan).success) { setValidation('Check the queries, limits and acceptance criteria. All fields must be valid.'); return }
    setValidation(null)
    void onSave(plan ? `${draft.trim()}\n\n\`\`\`research-plan\n${JSON.stringify(plan)}\n\`\`\`` : draft)
  }}>
    <label className="block text-sm font-medium">Plan<textarea rows={8} value={draft} onChange={(event) => setDraft(event.target.value)} className={textClass} /></label>
    {plan ? <>
      <h3 className="text-sm font-semibold">Executable work</h3>
      <label className="block text-sm">Research depth<select value={plan.researchDepth ?? 'company'} onChange={(event) => setPlan({ ...plan, researchDepth: event.target.value === 'discovery' ? 'discovery' : 'company' })} className={textClass}><option value="discovery">Discovery only</option><option value="company">Discovery and company research</option></select></label>
      {plan.researchDepth === 'discovery' ? <label className="block text-sm">Discovery target<Input type="number" min={1} max={plan.budgets.maxCompanies} value={plan.discoveryTarget ?? 1} onChange={(event) => setPlan({ ...plan, discoveryTarget: Number(event.target.value) })} className="mt-2" /></label> : null}
      {plan.discovery.map((direction, index) => <fieldset key={direction.id} className="space-y-3 rounded-lg border border-border p-3">
        <legend className="px-1 text-sm font-medium">{direction.title}</legend>
        <label className="block text-sm">Queries for {direction.title}<textarea rows={3} value={direction.queries.join('\n')} onChange={(event) => setPlan({ ...plan, discovery: plan.discovery.map((item, i) => i === index ? { ...item, queries: event.target.value.split('\n') } : item) })} className={textClass} /></label>
        <label className="block text-sm">Pages per query for {direction.title}<Input type="number" min={1} max={10} value={direction.maxPages} onChange={(event) => setPlan({ ...plan, discovery: plan.discovery.map((item, i) => i === index ? { ...item, maxPages: Number(event.target.value) } : item) })} className="mt-2" /></label>
      </fieldset>)}
      <label className="block text-sm">Company limit<Input type="number" min={1} max={2000} value={plan.budgets.maxCompanies} onChange={(event) => setPlan({ ...plan, budgets: { ...plan.budgets, maxCompanies: Number(event.target.value) } })} className="mt-2" /></label>
      <label className="block text-sm">Active minutes<Input type="number" min={1} max={1440} value={plan.budgets.maxWallMinutes} onChange={(event) => setPlan({ ...plan, budgets: { ...plan.budgets, maxWallMinutes: Number(event.target.value) } })} className="mt-2" /></label>
      <label className="block text-sm">Research instructions<textarea rows={4} value={plan.companyBrief} onChange={(event) => setPlan({ ...plan, companyBrief: event.target.value })} className={textClass} /></label>
      <label className="block text-sm">Acceptance criteria<textarea rows={3} value={plan.acceptance.join('\n')} onChange={(event) => setPlan({ ...plan, acceptance: event.target.value.split('\n') })} className={textClass} /></label>
    </> : <p className="rounded-lg bg-muted p-3 text-xs">This legacy plan has no executable work. Create a new executable plan before starting research.</p>}
    <p className="rounded-lg bg-muted p-3 text-xs text-muted-foreground">Editing an approved plan reopens review. Execution uses the queries and limits shown here.</p>
    {validation || error ? <p role="alert" className="text-sm">{validation ?? error}</p> : null}
  </form>
}
