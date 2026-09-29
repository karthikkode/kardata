// Sector sweep as a durable workflow (Phase 6): exhaustive company
// discovery for one sector. Query templates fan out from the sector
// name/topic plus attached context; each template pages until a full page
// yields zero new domains (or the page cap), and every company lands in
// the master ledger plus the sector projection — deterministic ids/keys,
// so retries and re-sweeps replay instead of duplicating.
//
// Only type-only shapes cross the sandbox: the workflow never hashes,
// fetches, or parses (pure helpers below are unit-tested directly).
// Activities run on the research lane bounds until the sweep lane grows
// stage-length timeouts.
import {
  defineQuery,
  log,
  proxyActivities,
  setHandler,
} from '@temporalio/workflow'
import { buildQueryTemplates, extractNewDomains, isSweepCancellation, sectorSignals } from '../sweep-rules.js'
import { activityOptions } from '../timeouts.js'
import type * as sweepActivitiesModule from '../activities/sweep.js'

const sweep = proxyActivities<typeof sweepActivitiesModule>(activityOptions('research'))

export interface SectorSweepInput {
  sectorId: string
  /** Page cap per template: exhaustiveness is "until no new domains",
   * the cap is the backstop. Defaults to 10. */
  maxPagesPerTemplate?: number
  /** Tenant binding: companies the sweep records carry this scope so
   * scoped reads see them. Sectors are tenant reads; sweeps inherit. */
  scope?: { tenantId: string; projectId: string | null }
}

export interface SweepProgress {
  sectorId: string
  templates: string[]
  templateIndex: number
  companiesFound: number
  status: 'running' | 'complete' | 'failed'
}

export const sweepProgressQuery = defineQuery<SweepProgress>('sweepProgress')

/** Longest page budget: 10 pages x 10 hits covers mid-size sectors;
 * bigger sectors re-sweep with new context, never unbounded loops. */
export const DEFAULT_MAX_PAGES_PER_TEMPLATE = 10

export async function sectorSweep(input: SectorSweepInput): Promise<'complete' | 'failed'> {
  const maxPages = input.maxPagesPerTemplate ?? DEFAULT_MAX_PAGES_PER_TEMPLATE
  const progress: SweepProgress = {
    sectorId: input.sectorId,
    templates: [],
    templateIndex: 0,
    companiesFound: 0,
    status: 'running',
  }
  setHandler(sweepProgressQuery, () => ({ ...progress }))

  let context: Awaited<ReturnType<typeof sweep.loadSweepContextActivity>>
  try {
    context = await sweep.loadSweepContextActivity({ sectorId: input.sectorId, scope: input.scope })
  } catch (error) {
    // Owner pause cancels the scope: the paused state is already recorded
    // by the route, so a cancellation propagates instead of writing failed.
    if (isSweepCancellation(error)) throw error
    log.error('sweep context failed', { sectorId: input.sectorId, error })
    return 'failed'
  }
  progress.templates = buildQueryTemplates(context.name, context.topic)
  try {
    await sweep.setSweepStateActivity({ sectorId: input.sectorId, state: 'running', scope: input.scope })
  } catch (error) {
    if (isSweepCancellation(error)) throw error
    log.error('sweep start transition failed', { sectorId: input.sectorId, error })
    return 'failed'
  }

  const seenDomains: string[] = []
  // Relevance gate: only hits evidencing the sector vocabulary land as
  // companies. Signals come from the topic (never the name stamp).
  const signals = sectorSignals(context.name, context.topic)
  try {
    for (let index = 0; index < progress.templates.length; index += 1) {
      progress.templateIndex = index
      const template = progress.templates[index] ?? ''
      for (let page = 0; page < maxPages; page += 1) {
        const hits = await sweep.searchWebPageActivity({ query: template, page })
        const fresh = extractNewDomains(hits, seenDomains, signals)
        if (fresh.length === 0) break
        for (const company of fresh) {
          seenDomains.push(company.domain)
          await sweep.recordSweepCompanyActivity({
            sectorId: input.sectorId,
            company: { ...company, sectorName: context.name },
            scope: input.scope,
          })
          progress.companiesFound += 1
        }
      }
    }
  } catch (error) {
    if (isSweepCancellation(error)) throw error
    log.error('sweep failed', { sectorId: input.sectorId, error })
    progress.status = 'failed'
    await sweep.setSweepStateActivity({ sectorId: input.sectorId, state: 'failed', scope: input.scope })
    return 'failed'
  }
  progress.status = 'complete'
  await sweep.setSweepStateActivity({ sectorId: input.sectorId, state: 'complete', scope: input.scope })
  return 'complete'
}
