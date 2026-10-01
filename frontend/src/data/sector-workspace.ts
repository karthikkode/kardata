import { useRef, useState } from 'react'
import { apiErrorStatus, attachSectorDocument, cancelRun, createSession, deleteSession, listSessions, listThreads, readSectorPlan, renameSession, resumeRun, StagingApiError, type StagingConfig } from './staging-api'
import { rebuildLocalContext, inspectThreadOperation, compactLocalContext, decideGlobalContext, ensureResearchSession, getContextPreview, getGlobalContext, getLocalContext, getResearchProgress, getSectorFileBody, getSectorFiles, hideSectorFile, includeSectorFile, saveGlobalContext, saveLocalContext, type Sections } from './workspace-api'
import { useWorkspaceConversation, useWorkspaceResource } from './useWorkspace'
import { getExecutionRecord, listExecutionRecords } from './workspace-api'

export function useSectorWorkspace(config: StagingConfig | null, sectorId: string | null, sessionId: string | null, requestedThread: string | null, onNavigate: (session: string, thread: string) => void) {
  const [execution, setExecution] = useState<{ thread: string; afterSeq: number; previous: number[]; seq: number | null } | null>(null)
  const [operation, setOperation] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [proposalId, setProposalId] = useState<string | null>(null)
  const [inspection, setInspection] = useState<{ thread: string; operationId: string } | null>(null)
  const [previewFileId, setPreviewFileId] = useState<string | null>(null)
  const deniedInitialization = useRef(new Set<string>())
  const operationLock = useRef(false)
  const sessions = useWorkspaceResource(config, sectorId ? `sessions:${sectorId}` : null, async (cfg) => {
    const rows = await listSessions(cfg, sectorId ?? '')
    const context = await getGlobalContext(cfg, sectorId ?? '')
    let research = rows.find((row) => row.id === context.researchSessionId)
    const key = `${cfg.baseUrl}:${cfg.apiKey}:${sectorId}`
    if (!research && !deniedInitialization.current.has(key)) {
      try { research = await ensureResearchSession(cfg, sectorId ?? '') } catch (error) {
        if (apiErrorStatus(error) === 'denied') deniedInitialization.current.add(key)
        else throw error
      }
    }
    return [...(research ? [{ ...research, kind: 'research' as const }] : []), ...rows.filter((row) => row.id !== research?.id).map((row) => ({ ...row, kind: 'normal' as const }))]
  }, true)
  const selected = sessionId ? sessions.data?.find((session) => session.id === sessionId) : sessions.data?.[0]
  const threads = useWorkspaceResource(config, selected ? `threads:${selected.id}` : null, (cfg) => listThreads(cfg, selected?.id ?? ''), true)
  const activeThread = selected ? !requestedThread || requestedThread === selected.id ? selected.id : threads.data?.some((thread) => thread.key === requestedThread) ? requestedThread : null : null
  const child = threads.data?.find((thread) => thread.key === activeThread && thread.kind === 'subagent')
  const global = useWorkspaceResource(config, sectorId ? `global:${sectorId}` : null, (cfg) => getGlobalContext(cfg, sectorId ?? ''), true)
  const files = useWorkspaceResource(config, sectorId ? `files:${sectorId}` : null, (cfg) => getSectorFiles(cfg, sectorId ?? ''), true)
  const progress = useWorkspaceResource(config, sectorId ? `progress:${sectorId}` : null, (cfg) => getResearchProgress(cfg, sectorId ?? ''), true)
  const plan = useWorkspaceResource(config, sectorId ? `plan:${sectorId}` : null, (cfg) => readSectorPlan(cfg, sectorId ?? ''), true)
  const local = useWorkspaceResource(config, activeThread, (cfg) => getLocalContext(cfg, activeThread ?? ''), true)
  const preview = useWorkspaceResource(config, proposalId && sectorId ? `proposal:${sectorId}:${proposalId}` : null, (cfg) => getContextPreview(cfg, sectorId ?? '', proposalId ?? ''))
  const operationReceipt = useWorkspaceResource(config, inspection?.thread === activeThread ? `operation:${activeThread}:${inspection.operationId}` : null, (cfg) => inspectThreadOperation(cfg, activeThread ?? '', inspection?.operationId ?? ''))
  const chat = useWorkspaceConversation(config, activeThread)
  const currentExecution = execution?.thread === activeThread ? execution : null
  const executionPage = useWorkspaceResource(config, currentExecution ? `execution-page:${activeThread}:${currentExecution.afterSeq}` : null, (cfg) => listExecutionRecords(cfg, activeThread ?? '', currentExecution?.afterSeq ?? 0))
  const executionBody = useWorkspaceResource(config, currentExecution?.seq ? `execution-record:${activeThread}:${currentExecution.seq}` : null, (cfg) => getExecutionRecord(cfg, activeThread ?? '', currentExecution?.seq ?? 0))
  const fileBody = useWorkspaceResource(config, previewFileId && sectorId ? `file-body:${sectorId}:${previewFileId}` : null, (cfg) => getSectorFileBody(cfg, sectorId ?? '', previewFileId ?? ''))
  async function act(name: string, work: (cfg: StagingConfig) => Promise<unknown>) {
    if (!config || operationLock.current) return false
    operationLock.current = true
    setOperation(name); setError(null)
    try { await work(config); return true } catch (failure) { setError(name === 'upload' && failure instanceof StagingApiError && failure.status >= 500 ? 'The upload did not finish. Choose the file again to retry. Existing files are kept.' : failure instanceof Error ? failure.message : 'Could not finish. Try again.'); return false } finally { operationLock.current = false; setOperation(null) }
  }
  return {
    executionPage, executionBody, executionOpen: Boolean(currentExecution), executionSeq: currentExecution?.seq ?? null, executionHasPrevious: Boolean(currentExecution?.previous.length),
    inspectExecution: () => { if (activeThread) setExecution({ thread: activeThread, afterSeq: 0, previous: [], seq: null }) },
    closeExecution: () => setExecution(null), selectExecution: (seq: number) => setExecution((current) => current ? { ...current, seq } : null),
    nextExecutionPage: () => setExecution((current) => current && executionPage.data?.nextAfterSeq ? { ...current, afterSeq: executionPage.data.nextAfterSeq, previous: [...current.previous, current.afterSeq], seq: null } : current),
    previousExecutionPage: () => setExecution((current) => current?.previous.length ? { ...current, afterSeq: current.previous.at(-1)!, previous: current.previous.slice(0, -1), seq: null } : current),
    operationReceipt: inspection?.thread === activeThread ? operationReceipt : undefined, inspectOperation: (operationId: string) => { if (activeThread) { if (inspection?.thread === activeThread && inspection.operationId === operationId) operationReceipt.refresh(); else setInspection({ thread: activeThread, operationId }) } }, sessions, selected, activeThread, threads, child, global, files, progress, plan, local, chat, operation, preview, reviewProposal: setProposalId, fileBody, previewFileId, previewFile: setPreviewFileId,
    error: error ?? (sessionId && sessions.status === 'ready' && !selected ? 'This conversation is not available in this sector.' : requestedThread && threads.status === 'ready' && !activeThread ? 'This subagent does not belong to this conversation.' : null),
    openSession: (id: string) => onNavigate(id, id),
    openThread: (key: string) => { if (selected) onNavigate(selected.id, key) },
    createChat: () => act('create', async (cfg) => { const session = await createSession(cfg, 'New conversation', sectorId ?? undefined); if (sessions.acknowledge([...(sessions.data ?? []), { ...session, kind: 'normal' as const }])) onNavigate(session.id, session.id) }),
    renameChat: (title: string) => act('rename', async (cfg) => { if (selected) await renameSession(cfg, selected.id, title); sessions.refresh() }),
    deleteChat: () => act('delete', async (cfg) => { if (!selected || selected.kind === 'research') return; await deleteSession(cfg, selected.id); sessions.refresh(); const research = sessions.data?.find((session) => session.kind === 'research'); if (research) onNavigate(research.id, research.id) }),
    stop: () => act('stop', async (cfg) => { if (activeThread) await cancelRun(cfg, child ? child.key.replace(/^agent:/, '') : `session-run-${selected?.id}`); chat.stopped() }),
    resume: () => act('resume', async (cfg) => { if (activeThread) await resumeRun(cfg, child ? child.key.replace(/^agent:/, '') : `session-run-${selected?.id}`); threads.refresh(); local.refresh() }),
    saveGlobal: (sections: Sections, baseVersion: number) => act('global', async (cfg) => { if (!sectorId) return; await saveGlobalContext(cfg, sectorId, baseVersion, sections); global.refresh() }),
    decide: (id: string, approve: boolean) => act('approval', async (cfg) => { if (!sectorId) return; await decideGlobalContext(cfg, sectorId, id, approve); global.refresh(); files.refresh() }),
    hideFile: (id: string, hidden: boolean) => act('file', async (cfg) => { if (!sectorId) return; await hideSectorFile(cfg, sectorId, id, hidden); files.refresh() }),
    includeFile: (id: string) => act('file', async (cfg) => { if (!sectorId || !global.data || !activeThread) return; await includeSectorFile(cfg, sectorId, id, global.data.version, activeThread); global.refresh() }),
    upload: (file: File) => act('upload', async (cfg) => {
      if (!sectorId) return
      if (file.size > 8 * 1024 * 1024) throw new Error('This file is larger than 8 MB. Choose a smaller file.')
      const bytes = new Uint8Array(await file.arrayBuffer())
      let text = ''
      for (const byte of bytes) text += String.fromCharCode(byte)
      await attachSectorDocument(cfg, sectorId, { filename: file.name, contentBase64: btoa(text) }); files.refresh()
    }),
    saveLocal: (notes: string, version: number) => act('local', async (cfg) => { if (!activeThread) return; await saveLocalContext(cfg, activeThread, version, notes); local.refresh() }),
    rebuildLocal: (summary: string, version: number) => act('rebuild', async (cfg) => { if (!activeThread) return; try { await rebuildLocalContext(cfg, activeThread, version, summary) } finally { local.refresh() } }),
    compact: () => act('compact', async (cfg) => { if (!activeThread) return; await compactLocalContext(cfg, activeThread); local.refresh() }),
  }
}
export type SectorWorkspaceModel = ReturnType<typeof useSectorWorkspace>
