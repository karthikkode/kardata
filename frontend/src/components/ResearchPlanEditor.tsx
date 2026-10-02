import { useId, useState } from 'react'
import { ExecutableResearchPlan, type ExecutableResearchPlan as Plan } from '../data/research-plan'
import { WorkspaceOverlay } from './workspace-parts'
import { Button } from './ui/button'
import { Input } from './ui/input'

export function ExecutablePlanDetails({ plan }: { plan: Plan }) {
  return <section aria-label="Executable research work" className="space-y-4 rounded-xl border border-border p-4">
    <h3 className="text-sm font-semibold">Approved work and limits</h3>
    <p className="text-sm">{plan.researchDepth === 'discovery' ? 'Discovery only. Company deep research will not run.' : 'Discovery and company research'}</p>
    {plan.discoveryTarget ? <p className="text-sm">Discovery target: {plan.discoveryTarget.toLocaleString()} distinct companies</p> : null}
    <p className="text-xs text-muted-foreground">Up to {plan.budgets.maxCompanies.toLocaleString()} companies · {plan.budgets.maxWallMinutes} active minutes · {plan.budgets.concurrency} concurrent researchers</p>
    {plan.discovery.map((direction) => <section key={direction.id} className="space-y-2">
      <h4 className="text-sm font-medium">{direction.title}</h4>
      <p className="text-xs text-muted-foreground">Up to {direction.maxPages} pages per query</p>
      <ul className="list-disc space-y-1 pl-5 text-sm break-words">{direction.queries.map((query, index) => <li key={index}>{query}</li>)}</ul>
    </section>)}
    <section><h4 className="mb-2 text-sm font-medium">Research instructions</h4><p className="whitespace-pre-wrap text-sm break-words">{plan.companyBrief}</p></section>
    <section><h4 className="mb-2 text-sm font-medium">Acceptance criteria</h4><ul className="list-disc space-y-1 pl-5 text-sm break-words">{plan.acceptance.map((criterion, index) => <li key={index}>{criterion}</li>)}</ul></section>
  </section>
}

export function ResearchPlanEditor({ markdown, executable, busy, error, onSave }: {
  markdown: string; executable?: Plan; busy: boolean; error: string | null; onSave(markdown: string): Promise<boolean>
}) {
  const [open, setOpen] = useState(false)
  const formId = useId()
  return <><Button variant="ghost" size="sm" className="mt-3" disabled={busy} onClick={() => setOpen(true)}>Edit plan</Button>
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
