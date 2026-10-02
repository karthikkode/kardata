// v2 e2e API router: intercepts **/v1/** and serves fixture envelopes.
// One `serveApi(page, overrides?)` call per spec; per-route state flags
// (loading/error/denied/offline/empty/notfound) drive state screenshots.

import type { Page, Route } from '@playwright/test'
import {
  alerts, allSectors, artifacts, companies, executablePlan, executionBody, executionPage,
  FILE_MARKDOWN, fileUnits, globalFor, karbotSessions, largeLibrary, libraryFiles,
  localFor, planView, planVersions, progressFor, providers, providersEmpty, providersNoKey,
  runs, sectorActivity, sectorById, sectorSessions, sessionById, sessionThreads, skills,
  threadMessages, HEX64, type FixtureCompany, type FixtureMessage, type FixtureSector,
  type FixtureSession, type ResearchState,
} from './fixtures'

export type RouteMode = 'ok' | 'loading' | 'error' | 'denied' | 'offline' | 'empty' | 'notfound'

export type RouteKey =
  | 'sectors' | 'sectorMutations' | 'sector' | 'companies' | 'sessions' | 'threads'
  | 'messages' | 'events' | 'commands' | 'runs' | 'providers' | 'skills' | 'artifacts'
  | 'global' | 'files' | 'fileBody' | 'local' | 'progress' | 'plan' | 'researchSession'
  | 'operations' | 'execution' | 'workReview' | 'alerts' | 'context'

export interface ApiData {
  sectors?: FixtureSector[]
  companies?: FixtureCompany[]
  karbotSessions?: FixtureSession[]
  runs?: typeof runs
  alerts?: typeof alerts
  providersVariant?: 'default' | 'nokey' | 'empty'
  filesVariant?: 'default' | 'large' | 'empty'
  planVariant?: 'approved' | 'legacy' | 'empty'
  progressVariant?: 'running' | 'complete' | 'empty' | 'large'
  globalVariant?: 'full' | 'empty'
  localVariant?: 'full' | 'empty' | 'blocked' | 'pending'
  messages?: FixtureMessage[]
  subagents?: number
}

export interface ApiOptions {
  modes?: Partial<Record<RouteKey, RouteMode>>
  data?: ApiData
  /** static: fulfill frames then close. live: held-open stream, auto-primed.
   * quiet: held-open stream, test pushes frames itself. */
  stream?: 'static' | 'live' | 'quiet'
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

async function ok(route: Route, data: unknown, extra?: Record<string, unknown>): Promise<void> {
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, data, ...extra }) })
}

async function fail(route: Route, status: number, code: string, message: string): Promise<void> {
  await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify({ ok: false, error: { code, message } }) })
}

export async function serveApi(page: Page, options: ApiOptions = {}): Promise<void> {
  const data = options.data ?? {}
  const modes = options.modes ?? {}
  const streamMode = options.stream ?? 'live'
  const mode = (key: RouteKey): RouteMode => modes[key] ?? 'ok'

  // Mutable world: mutations apply so action specs see consistent reads.
  const sectorStates = new Map<string, ResearchState>()
  const baseSectors = data.sectors ?? allSectors
  for (const sector of baseSectors) sectorStates.set(sector.id, sector.state)
  const customSectors: FixtureSector[] = []
  const extraSessions: FixtureSession[] = []
  const deletedIds = new Set<string>()
  const renamedTitles = new Map<string, string>()
  const hiddenFiles = new Map<string, boolean>()
  let commandNonce = 0
  let sectorNonce = 0

  const liveSectors = (): FixtureSector[] => [...baseSectors, ...customSectors]
    .filter((sector) => !deletedIds.has(sector.id))
    .map((sector) => ({ ...sector, state: sectorStates.get(sector.id) ?? sector.state }))
  const liveSector = (id: string): FixtureSector | undefined => liveSectors().find((sector) => sector.id === id)
  const liveCompanies = (): FixtureCompany[] => data.companies ?? companies
  const liveSessions = (): FixtureSession[] => {
    const rows: FixtureSession[] = []
    for (const sector of liveSectors()) rows.push(...sectorSessions(sector).filter((session) => !deletedIds.has(session.id)))
    rows.push(...(data.karbotSessions ?? karbotSessions).filter((session) => !deletedIds.has(session.id)))
    rows.push(...extraSessions.filter((session) => !deletedIds.has(session.id)))
    return rows.map((session) => renamedTitles.has(session.id) ? { ...session, title: renamedTitles.get(session.id) as string } : session)
  }

  async function gate(route: Route, key: RouteKey): Promise<RouteMode> {
    const state = mode(key)
    if (state === 'loading') await sleep(1500)
    else if (state === 'error') await fail(route, 500, 'internal', 'Something went wrong on purpose.')
    else if (state === 'denied') await fail(route, 403, 'permission_denied', 'This key cannot read this resource.')
    else if (state === 'offline') await route.abort('internetdisconnected')
    else if (state === 'notfound') await fail(route, 404, 'not_found', 'Nothing lives at this address.')
    return state
  }

  // Held-open stream mode: override fetch for /events? before page scripts run.
  if (streamMode !== 'static') {
    const prime = streamMode === 'live' ? (data.messages ?? threadMessages('primed')) : []
    const frames = prime.map((message, i) => ({ seq: i + 1, threadKey: 'primed', type: 'message', at: message.at ?? '', payload: message }))
    await page.addInitScript((primed: unknown[]) => {
      const nativeFetch = window.fetch.bind(window)
      const controllers = new Set<ReadableStreamDefaultController<Uint8Array>>()
      window.fetch = (input, init) => {
        if (String(input).includes('/events?')) {
          return Promise.resolve(new Response(new ReadableStream<Uint8Array>({
            start(controller) {
              controllers.add(controller)
              const encoder = new TextEncoder()
              for (const frame of primed) controller.enqueue(encoder.encode(`data: ${JSON.stringify(frame)}\n\n`))
            },
          }), { status: 200, headers: { 'content-type': 'text/event-stream' } }))
        }
        return nativeFetch(input, init)
      }
      Object.assign(window, {
        pushChatFrame(frame: unknown) {
          const bytes = new TextEncoder().encode(`data: ${JSON.stringify(frame)}\n\n`)
          for (const controller of controllers) {
            try { controller.enqueue(bytes) } catch { controllers.delete(controller) }
          }
        },
      })
    }, frames)
  }

  await page.route('**/v1/**', async (route) => {
    const url = new URL(route.request().url())
    const method = route.request().method()
    const path = url.pathname.replace(/^\/v1/, '') || '/'
    const body = (): Record<string, unknown> => {
      try { return (route.request().postDataJSON() ?? {}) as Record<string, unknown> } catch { return {} }
    }

    // -- sectors ---------------------------------------------------------
    if (path === '/sectors' && method === 'GET') {
      const state = await gate(route, 'sectors')
      if (state !== 'ok' && state !== 'loading') return
      let rows = liveSectors()
      if (mode('sectors') === 'empty') rows = []
      const wanted = url.searchParams.get('state')
      const needle = (url.searchParams.get('query') ?? '').toLowerCase()
      if (wanted) rows = rows.filter((sector) => sector.state === wanted)
      if (needle) rows = rows.filter((sector) => `${sector.name} ${sector.topic}`.toLowerCase().includes(needle))
      await ok(route, rows)
      return
    }
    if (path === '/sectors' && method === 'POST') {
      const state = await gate(route, 'sectorMutations')
      if (state !== 'ok' && state !== 'loading') return
      sectorNonce += 1
      const input = body()
      const created: FixtureSector = {
        id: `sector-custom-${sectorNonce}`, name: String(input['name'] ?? 'Untitled sector'),
        topic: String(input['topic'] ?? ''), companiesFound: 0,
        state: (input['state'] as ResearchState) ?? 'draft',
        researchSessionId: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      }
      customSectors.push(created)
      sectorStates.set(created.id, created.state)
      await ok(route, created)
      return
    }
    const sectorMatch = /^\/sectors\/([^/]+)(\/.*)?$/.exec(path)
    if (sectorMatch) {
      const sectorId = decodeURIComponent(sectorMatch[1] as string)
      const rest = sectorMatch[2] ?? ''
      const sector = liveSector(sectorId)
      if (!sector) { await fail(route, 404, 'not_found', 'Sector not found.'); return }

      if (rest === '' && method === 'GET') {
        const state = await gate(route, 'sector')
        if (state !== 'ok' && state !== 'loading') return
        const rows = liveCompanies().filter((company) => company.sectorId === sectorId)
        await ok(route, {
          ...sector, companiesFound: mode('sector') === 'empty' ? 0 : rows.length,
          companies: (mode('sector') === 'empty' ? [] : rows).slice(0, 100),
          companiesTotal: mode('sector') === 'empty' ? 0 : rows.length,
          activity: sectorActivity(sectorId), activityTotal: 8,
        })
        return
      }
      const transition = (next: ResearchState): void => { sectorStates.set(sectorId, next) }
      if (rest === '/start' && method === 'POST') {
        const state = await gate(route, 'sectorMutations')
        if (state !== 'ok' && state !== 'loading') return
        transition('queued'); await ok(route, { ...sector, state: 'queued' }); return
      }
      if (rest === '/restart' && method === 'POST') {
        const state = await gate(route, 'sectorMutations')
        if (state !== 'ok' && state !== 'loading') return
        transition('running'); await ok(route, { ...sector, state: 'running' }); return
      }
      if (rest === '/pause' && method === 'POST') {
        const state = await gate(route, 'sectorMutations')
        if (state !== 'ok' && state !== 'loading') return
        transition('paused'); await ok(route, { ...sector, state: 'paused' }); return
      }
      if (rest === '/resume' && method === 'POST') {
        const state = await gate(route, 'sectorMutations')
        if (state !== 'ok' && state !== 'loading') return
        transition('running'); await ok(route, { ...sector, state: 'running' }); return
      }
      if (rest === '/plan' && method === 'POST') {
        const state = await gate(route, 'sectorMutations')
        if (state !== 'ok' && state !== 'loading') return
        transition('planning'); await ok(route, { ...sector, state: 'planning' }); return
      }
      if (rest === '/approve' && method === 'POST') {
        const state = await gate(route, 'sectorMutations')
        if (state !== 'ok' && state !== 'loading') return
        transition('approved'); await ok(route, { ...sector, state: 'approved' }); return
      }
      if (rest === '/plan' && method === 'GET') {
        const state = await gate(route, 'plan')
        if (state !== 'ok' && state !== 'loading') return
        await ok(route, planView(sectorId, mode('plan') === 'empty' ? 'empty' : (data.planVariant ?? 'approved')))
        return
      }
      if (rest === '/plan' && method === 'PATCH') {
        const state = await gate(route, 'sectorMutations')
        if (state !== 'ok' && state !== 'loading') return
        await ok(route, { version: planVersions.length + 1 })
        return
      }
      if (rest === '/progress' && method === 'GET') {
        const state = await gate(route, 'progress')
        if (state !== 'ok' && state !== 'loading') return
        const progress = progressFor(sectorId, mode('progress') === 'empty' ? 'empty' : (data.progressVariant ?? 'running'))
        await ok(route, { ...progress, state: sector.state })
        return
      }
      const reviewMatch = /^\/work\/([^/]+)\/review$/.exec(rest)
      if (reviewMatch && method === 'POST') {
        const state = await gate(route, 'workReview')
        if (state !== 'ok' && state !== 'loading') return
        const input = body()
        await ok(route, {
          id: decodeURIComponent(reviewMatch[1] as string), kind: 'discovery', title: 'Screen Parramatta results page 2',
          receiptVersion: HEX64, state: input['decision'] === 'exclude' ? 'excluded' : 'running',
          attempts: 4, childId: null, evidence: ['Licensed crew named on the roster page.'],
          detail: input['decision'] === 'exclude' ? 'Excluded by the owner.' : 'Retrying after owner review.',
          sourceUrl: 'https://example.com/contractor-7',
        })
        return
      }
      if (rest === '/research-session' && method === 'POST') {
        const state = await gate(route, 'researchSession')
        if (state !== 'ok' && state !== 'loading') return
        await ok(route, { id: `session-${sectorId}-research`, title: 'Research', sectorId, kind: 'research', createdAt: sector.createdAt, updatedAt: sector.updatedAt })
        return
      }
      if (rest === '/global-context' && method === 'GET') {
        const state = await gate(route, 'global')
        if (state !== 'ok' && state !== 'loading') return
        await ok(route, globalFor(sectorId, mode('global') === 'empty' ? 'empty' : (data.globalVariant ?? 'full')))
        return
      }
      if (rest === '/global-context' && method === 'PATCH') {
        const state = await gate(route, 'global')
        if (state !== 'ok' && state !== 'loading') return
        const input = body()
        await ok(route, { id: 'change-saved', baseVersion: input['baseVersion'] ?? 3, sections: input['sections'], sourceThread: 'owner', author: 'Owner', state: 'approved', version: 4, at: new Date().toISOString(), fileRef: null })
        return
      }
      if (rest === '/global-context/proposals' && method === 'POST') {
        const state = await gate(route, 'global')
        if (state !== 'ok' && state !== 'loading') return
        await ok(route, { id: 'change-proposed', baseVersion: 3, sections: (body())['sections'], sourceThread: 'session-x', author: 'Research agent 1', state: 'pending', version: null, at: new Date().toISOString(), fileRef: null })
        return
      }
      const proposalMatch = /^\/global-context\/proposals\/([^/]+)(\/decision)?$/.exec(rest)
      if (proposalMatch && method === 'GET') {
        const state = await gate(route, 'global')
        if (state !== 'ok' && state !== 'loading') return
        const global = globalFor(sectorId, 'full')
        const change = global.changes.find((entry) => entry.id === decodeURIComponent(proposalMatch[1] as string)) ?? global.changes[0]
        await ok(route, {
          change,
          units: [0, 1, 2, 3].map((ord) => ({ ord, text: `Proposed unit ${ord + 1} from the crew notes.`, uncertain: false })),
          sources: change?.fileRef ? [{ ref: { fileId: change.fileRef.fileId, filename: change.fileRef.filename, hash: change.fileRef.hash, ords: change.fileRef.ords }, units: Array.from({ length: 14 }, (_, ord) => ({ ord, text: `Source unit ${ord + 1} from the crew notes.`, uncertain: ord % 5 === 0 })) }] : [],
        })
        return
      }
      if (proposalMatch && method === 'POST') {
        const state = await gate(route, 'global')
        if (state !== 'ok' && state !== 'loading') return
        const approved = (body())['approve'] === true
        await ok(route, { id: decodeURIComponent(proposalMatch[1] as string), baseVersion: 2, sections: globalFor(sectorId, 'full').sections, sourceThread: 'session-electrical-research', author: 'Research agent 1', state: approved ? 'approved' : 'denied', version: approved ? 4 : null, at: new Date().toISOString(), fileRef: null })
        return
      }
      if (rest === '/files' && method === 'GET') {
        const state = await gate(route, 'files')
        if (state !== 'ok' && state !== 'loading') return
        const rows = mode('files') === 'empty' ? [] : data.filesVariant === 'large' ? largeLibrary() : libraryFiles
        await ok(route, rows.map((file) => hiddenFiles.has(file.id) ? { ...file, hidden: hiddenFiles.get(file.id) } : file))
        return
      }
      const fileMatch = /^\/files\/([^/]+)(\/.*)?$/.exec(rest)
      if (fileMatch) {
        const fileId = decodeURIComponent(fileMatch[1] as string)
        const fileRest = fileMatch[2] ?? ''
        const library = data.filesVariant === 'large' ? largeLibrary() : libraryFiles
        const file = library.find((entry) => entry.id === fileId)
        if (!file) { await fail(route, 404, 'not_found', 'File not found.'); return }
        if (fileRest === '' && method === 'PATCH') {
          const state = await gate(route, 'files')
          if (state !== 'ok' && state !== 'loading') return
          hiddenFiles.set(fileId, (body())['hidden'] === true)
          await ok(route, { ...file, hidden: hiddenFiles.get(fileId) })
          return
        }
        if (fileRest === '/body' && method === 'GET') {
          const state = await gate(route, 'fileBody')
          if (state !== 'ok' && state !== 'loading') return
          const mediaType = file.filename.endsWith('.pdf') ? 'application/pdf' : file.filename.endsWith('.csv') ? 'text/csv' : file.filename.endsWith('.json') ? 'application/json' : file.filename.endsWith('.png') ? 'image/png' : 'text/markdown'
          await ok(route, { filename: file.filename, mediaType, text: file.filename.endsWith('.png') ? '' : FILE_MARKDOWN, originalAvailable: true, fullChars: FILE_MARKDOWN.length, textTruncated: false })
          return
        }
        if (fileRest === '/units' && method === 'GET') {
          const state = await gate(route, 'fileBody')
          if (state !== 'ok' && state !== 'loading') return
          await ok(route, fileUnits(Number(url.searchParams.get('fromOrd') ?? 0)))
          return
        }
        if (fileRest === '/retry' && method === 'POST') {
          const state = await gate(route, 'files')
          if (state !== 'ok' && state !== 'loading') return
          await ok(route, { jobId: 'job-pdf-2', state: 'processing', revision: 3, totalImages: 6, completedImages: 2, failedImages: 0, uncertainImages: 0, errorCode: null, retryRequiresApproval: false })
          return
        }
        if (fileRest === '/context' && method === 'POST') {
          const state = await gate(route, 'files')
          if (state !== 'ok' && state !== 'loading') return
          await ok(route, { id: 'change-file-1', baseVersion: 3, sections: globalFor(sectorId, 'full').sections, sourceThread: 'session-electrical-research', author: 'Owner', state: 'pending', version: null, at: new Date().toISOString(), fileRef: { fileId: file.id, filename: file.filename, hash: file.hash, ords: [0] } })
          return
        }
      }
      if (rest === '/documents' && (method === 'GET' || method === 'POST')) {
        const state = await gate(route, 'files')
        if (state !== 'ok' && state !== 'loading') return
        if (method === 'GET') { await ok(route, []); return }
        const input = body()
        await ok(route, { id: 'sdoc-1', sectorId, filename: String(input['filename'] ?? 'upload.md'), mediaType: 'text/markdown', chars: 120, sha256: HEX64, createdAt: new Date().toISOString(), status: 'indexed', unitCount: 1 })
        return
      }
      if (rest === '/context' && method === 'GET') {
        const state = await gate(route, 'context')
        if (state !== 'ok' && state !== 'loading') return
        await ok(route, { sectorId, digest: { version: 'v3', text: 'Crew notes digest.' }, segments: { system: '', references: [], history: [], tail: [] }, usage: { system: { messages: 0, estimatedTokens: 0 }, references: { messages: 0, estimatedTokens: 0 }, history: { messages: 0, estimatedTokens: 0 }, tail: { messages: 0, estimatedTokens: 0 }, totalEstimatedTokens: 0 }, files: [], notes: [] })
        return
      }
      if ((rest === '/context' && method === 'PATCH') || (rest === '/context/compact' && method === 'POST')) {
        const state = await gate(route, 'context')
        if (state !== 'ok' && state !== 'loading') return
        await ok(route, rest.endsWith('compact') ? { sectorId, compacted: true } : { sectorId, digest: { version: 'v3', text: '' }, segments: { system: '', references: [], history: [], tail: [] }, usage: { system: { messages: 0, estimatedTokens: 0 }, references: { messages: 0, estimatedTokens: 0 }, history: { messages: 0, estimatedTokens: 0 }, tail: { messages: 0, estimatedTokens: 0 }, totalEstimatedTokens: 0 }, files: [], notes: [] })
        return
      }
    }

    // -- companies -------------------------------------------------------
    if (path === '/companies' && method === 'GET') {
      const state = await gate(route, 'companies')
      if (state !== 'ok' && state !== 'loading') return
      let rows = mode('companies') === 'empty' ? [] : liveCompanies()
      const wanted = url.searchParams.get('state')
      const needle = (url.searchParams.get('query') ?? '').toLowerCase()
      const sectorId = url.searchParams.get('sectorId')
      if (wanted) rows = rows.filter((company) => company.state === wanted)
      if (sectorId) rows = rows.filter((company) => company.sectorId === sectorId)
      if (needle) rows = rows.filter((company) => company.name.toLowerCase().includes(needle))
      const limit = Number(url.searchParams.get('limit') ?? 100)
      const offset = Number(url.searchParams.get('offset') ?? 0)
      await ok(route, { companies: rows.slice(offset, offset + limit), total: rows.length })
      return
    }

    // -- sessions --------------------------------------------------------
    if (path === '/sessions' && method === 'GET') {
      const state = await gate(route, 'sessions')
      if (state !== 'ok' && state !== 'loading') return
      let rows = mode('sessions') === 'empty' ? [] : liveSessions()
      const sectorId = url.searchParams.get('sectorId')
      rows = sectorId ? rows.filter((session) => session.sectorId === sectorId) : rows.filter((session) => !session.sectorId)
      await ok(route, rows)
      return
    }
    if (path === '/sessions' && method === 'POST') {
      const state = await gate(route, 'sessions')
      if (state !== 'ok' && state !== 'loading') return
      const input = body()
      const created: FixtureSession = {
        id: `session-custom-${Date.now()}`, title: String(input['title'] ?? 'New conversation'),
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
        ...(typeof input['sectorId'] === 'string' ? { sectorId: input['sectorId'] as string, kind: 'normal' as const } : {}),
      }
      extraSessions.push(created)
      await ok(route, created)
      return
    }
    const sessionMatch = /^\/sessions\/([^/]+)(\/.*)?$/.exec(path)
    if (sessionMatch) {
      const sessionId = decodeURIComponent(sessionMatch[1] as string)
      const rest = sessionMatch[2] ?? ''
      const session = liveSessions().find((entry) => entry.id === sessionId) ?? sessionById(sessionId)
      if (!session || deletedIds.has(sessionId)) { await fail(route, 404, 'not_found', 'Session not found.'); return }
      if (rest === '' && method === 'GET') {
        const state = await gate(route, 'sessions')
        if (state !== 'ok' && state !== 'loading') return
        await ok(route, session)
        return
      }
      if (rest === '' && method === 'DELETE') {
        const state = await gate(route, 'sessions')
        if (state !== 'ok' && state !== 'loading') return
        deletedIds.add(sessionId)
        await ok(route, { id: sessionId, deleted: true })
        return
      }
      if (rest === '/rename' && method === 'POST') {
        const state = await gate(route, 'sessions')
        if (state !== 'ok' && state !== 'loading') return
        renamedTitles.set(sessionId, String((body())['title'] ?? session.title))
        await ok(route, { ...session, title: renamedTitles.get(sessionId) })
        return
      }
      if (rest === '/model' && method === 'PATCH') {
        const state = await gate(route, 'sessions')
        if (state !== 'ok' && state !== 'loading') return
        const input = body()
        await ok(route, { provider: 'meta', model: input['model'], reasoning: input['reasoning'] ?? false, ...(typeof input['effort'] === 'string' ? { effort: input['effort'] } : {}) })
        return
      }
      if (rest === '/compact' && method === 'POST') {
        const state = await gate(route, 'sessions')
        if (state !== 'ok' && state !== 'loading') return
        await ok(route, { sessionId, compacted: true, messageCount: 40 })
        return
      }
      if (rest === '/threads' && method === 'GET') {
        const state = await gate(route, 'threads')
        if (state !== 'ok' && state !== 'loading') return
        const count = mode('threads') === 'empty' ? 0 : (data.subagents ?? (sessionId.includes('research') ? 6 : 0))
        await ok(route, sessionThreads(sessionId, count))
        return
      }
      if (rest === '/artifacts' && method === 'GET') {
        const state = await gate(route, 'artifacts')
        if (state !== 'ok' && state !== 'loading') return
        await ok(route, mode('artifacts') === 'empty' ? [] : artifacts)
        return
      }
      if (rest === '/artifacts' && method === 'POST') {
        const state = await gate(route, 'artifacts')
        if (state !== 'ok' && state !== 'loading') return
        const input = body()
        await ok(route, { artifactId: `art-${Date.now()}`, name: String(input['name'] ?? 'file.md'), kind: 'file', bytes: String(input['content'] ?? '').length, sha256: HEX64, indexed: true })
        return
      }
      const artifactMatch = /^\/artifacts\/([^/]+)(\/body)?$/.exec(rest)
      if (artifactMatch && method === 'GET') {
        const state = await gate(route, 'artifacts')
        if (state !== 'ok' && state !== 'loading') return
        const found = artifacts.find((entry) => entry.artifactId === decodeURIComponent(artifactMatch[1] as string))
        if (!found) { await fail(route, 404, 'not_found', 'File not found.'); return }
        await ok(route, artifactMatch[2] ? { body: FILE_MARKDOWN, meta: { name: found.name } } : found)
        return
      }
      if (rest === '/artifacts/references' && method === 'POST') {
        const state = await gate(route, 'artifacts')
        if (state !== 'ok' && state !== 'loading') return
        await ok(route, { artifactId: 'art-1', name: 'shortlist.md', kind: 'report', indexed: true })
        return
      }
    }

    // -- threads ---------------------------------------------------------
    const threadMatch = /^\/threads\/([^/]+)(\/.*)?$/.exec(path)
    if (threadMatch) {
      const threadKey = decodeURIComponent(threadMatch[1] as string)
      const rest = threadMatch[2] ?? ''
      const messages = data.messages ?? threadMessages(threadKey)
      if (rest === '/messages' && method === 'GET') {
        const state = await gate(route, 'messages')
        if (state !== 'ok' && state !== 'loading') return
        const rows = mode('messages') === 'empty' ? [] : messages
        const afterSeq = Number(url.searchParams.get('afterSeq') ?? 0)
        const limit = Number(url.searchParams.get('limit') ?? 200)
        const page = rows.filter((message) => message.seq > afterSeq).slice(0, limit)
        const next = page.length ? (page[page.length - 1]?.seq as number) : afterSeq
        await ok(route, page, { nextAfterSeq: next })
        return
      }
      if (rest === '/steering-receipts' && method === 'GET') {
        const state = await gate(route, 'messages')
        if (state !== 'ok' && state !== 'loading') return
        await ok(route, { items: [], nextAfterId: null })
        return
      }
      if (rest === '/events' && method === 'GET') {
        const state = await gate(route, 'events')
        if (state !== 'ok' && state !== 'loading') return
        const rows = mode('events') === 'empty' ? [] : messages
        const frames = rows.map((message, i) => ({ seq: i + 1, threadKey, type: 'message', at: message.at ?? '', payload: message }))
        await route.fulfill({ status: 200, contentType: 'text/event-stream', body: frames.map((frame) => `data: ${JSON.stringify(frame)}\n\n`).join('') })
        return
      }
      if (rest === '/context' && method === 'GET') {
        const state = await gate(route, 'local')
        if (state !== 'ok' && state !== 'loading') return
        await ok(route, localFor(threadKey, mode('local') === 'empty' ? 'empty' : (data.localVariant ?? 'full')))
        return
      }
      if (rest === '/context' && method === 'PATCH') {
        const state = await gate(route, 'local')
        if (state !== 'ok' && state !== 'loading') return
        const base = localFor(threadKey, data.localVariant ?? 'full')
        await ok(route, { ...base, notes: String((body())['notes'] ?? base.notes), version: base.version + 1 })
        return
      }
      if (rest === '/context/compact' && method === 'POST') {
        const state = await gate(route, 'local')
        if (state !== 'ok' && state !== 'loading') return
        await ok(route, { compacted: true, context: localFor(threadKey, data.localVariant ?? 'full') })
        return
      }
      if (rest === '/context/rebuild' && method === 'POST') {
        const state = await gate(route, 'local')
        if (state !== 'ok' && state !== 'loading') return
        await ok(route, localFor(threadKey, 'full'))
        return
      }
      const opMatch = /^\/operations\/([^/]+)$/.exec(rest)
      if (opMatch && method === 'GET') {
        const state = await gate(route, 'operations')
        if (state !== 'ok' && state !== 'loading') return
        const operationId = decodeURIComponent(opMatch[1] as string)
        const unresolved = operationId.includes('f1e2')
        await ok(route, { operationId, toolName: 'db.mark_company_found', state: unresolved ? 'unresolved' : 'confirmed', reason: unresolved ? 'The stream dropped before the confirmation.' : 'The reply was verified.', recordedAt: new Date().toISOString() })
        return
      }
      if (rest === '/execution-records' && method === 'GET') {
        const state = await gate(route, 'execution')
        if (state !== 'ok' && state !== 'loading') return
        await ok(route, mode('execution') === 'empty' ? { records: [], nextAfterSeq: null } : executionPage(Number(url.searchParams.get('afterSeq') ?? 0)))
        return
      }
      const execMatch = /^\/execution-records\/(\d+)$/.exec(rest)
      if (execMatch && method === 'GET') {
        const state = await gate(route, 'execution')
        if (state !== 'ok' && state !== 'loading') return
        await ok(route, executionBody(Number(execMatch[1])))
        return
      }
    }

    // -- commands --------------------------------------------------------
    if (path.startsWith('/commands/') && method === 'POST') {
      const state = await gate(route, 'commands')
      if (state !== 'ok' && state !== 'loading') return
      commandNonce += 1
      if (path === '/commands/approve') { await ok(route, { commandId: `cmd-${commandNonce}` }); return }
      await ok(route, { commandId: `cmd-${commandNonce}`, state: 'accepted' })
      return
    }

    // -- runs / providers / skills / artifacts / alerts ------------------
    if (path === '/runs' && method === 'GET') {
      const state = await gate(route, 'runs')
      if (state !== 'ok' && state !== 'loading') return
      let rows = mode('runs') === 'empty' ? [] : (data.runs ?? runs)
      const sessionId = url.searchParams.get('sessionId')
      if (sessionId) rows = rows.filter((run) => run.sessionId === sessionId)
      await ok(route, rows)
      return
    }
    if (path === '/providers' && method === 'GET') {
      const state = await gate(route, 'providers')
      if (state !== 'ok' && state !== 'loading') return
      const variant = mode('providers') === 'empty' ? 'empty' : (data.providersVariant ?? 'default')
      await ok(route, variant === 'empty' ? providersEmpty : variant === 'nokey' ? providersNoKey : providers)
      return
    }
    if (path === '/skills' && method === 'GET') {
      const state = await gate(route, 'skills')
      if (state !== 'ok' && state !== 'loading') return
      await ok(route, mode('skills') === 'empty' ? [] : skills)
      return
    }
    if (path === '/artifacts' && method === 'GET') {
      const state = await gate(route, 'artifacts')
      if (state !== 'ok' && state !== 'loading') return
      await ok(route, mode('artifacts') === 'empty' ? [] : artifacts)
      return
    }
    if (path === '/alerts' && method === 'GET') {
      const state = await gate(route, 'alerts')
      if (state !== 'ok' && state !== 'loading') return
      const rows = [...(mode('alerts') === 'empty' ? [] : (data.alerts ?? alerts))].sort((a, b) => b.seq - a.seq)
      const limit = Number(url.searchParams.get('limit') ?? 20)
      const before = url.searchParams.get('beforeSeq')
      const eligible = before ? rows.filter((alert) => alert.seq < Number(before)) : rows
      const page = eligible.slice(0, limit)
      await ok(route, { items: page, nextBeforeSeq: eligible.length > page.length ? (page[page.length - 1]?.seq ?? null) : null })
      return
    }

    await fail(route, 404, 'not_found', `No fixture serves ${method} ${path}.`)
  })
}

/** Push one frame into a live/quiet held-open stream. */
export async function pushFrame(page: Page, frame: unknown): Promise<void> {
  await page.evaluate((value) => {
    (window as unknown as { pushChatFrame(frame: unknown): void }).pushChatFrame(value)
  }, frame)
}

export { executablePlan }
