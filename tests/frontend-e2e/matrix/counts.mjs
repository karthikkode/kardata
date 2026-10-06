// P6-M4: per-state row/text expectations for matrix count states.
// Pure numbers (no TS imports) so matrix-sync.mjs and vitest share them.
// Derivations (verified against product + fixture code):
// - companies: useStagingCompanies first window COMPANY_WINDOW=100; the
//   footer always reads "Showing <items> of <total>".
// - sectors: ResearchesPage SECTOR_WINDOW=50 client window + footer;
//   Dashboard slices to overviewPreviewCount=6.
// - messages: listMessages drains every 200-row page, so n1000 renders
//   1000 bubbles; typical keeps the 40-row showcase thread (28 texts).
// - threads: SubagentsPanel takes kind=subagent only (ChatPanel:142)
//   behind a closed toggle reading "<N> subagents".
// - karbot sessions (SessionsPanel): data.karbotSessions replaces base.
// - sector sessions (SectorWorkspace): 4 base normal + data.sessions,
//   group=normal via the route session (limit 50).
const COUNT = { one: 1, typical: 8, n100: 100, n1000: 1000 }
const fmt = (n) => n.toLocaleString('en-AU')
const isDashboard = (caseId) => caseId.endsWith('.Dashboard')
const isWorkspace = (caseId) => caseId.endsWith('.SectorWorkspace')

/** Rows the component renders, or null when the case asserts texts only. */
export function expectedRowCount(caseId, primary, state) {
  if (state === 'partial' || state === 'longtext') {
    if (primary === 'sectors') return 1 // baseline [matrixSector]
    if (primary === 'companies') return 1 // longtext single row
    if (primary === 'messages') return 2 // longtext: 5k + URL bubbles
    if (primary === 'sessions' && isWorkspace(caseId)) return 9 // 6 base + 3 baseline
    return null // ChatPanel (closed) / ModelsPanel (no rows) / detail views
  }
  const n = COUNT[state]
  if (n === undefined) return null
  switch (primary) {
    case 'companies':
      return Math.min(100, n)
    case 'sectors':
      return isDashboard(caseId) ? Math.min(6, n) : Math.min(50, n)
    case 'messages':
      return state === 'typical' ? 28 : n
    case 'sessions':
      return isWorkspace(caseId) ? n + 4 : n
    case 'runs':
      return n
    default:
      return null // threads: toggle text; sector: detail
  }
}

/** Exact texts (footers, toggle labels) for the state. */
export function expectedCountTexts(caseId, primary, state, countTextTemplate) {
  if (countTextTemplate) {
    const n = COUNT[state]
    return n === undefined ? [] : [{ text: countTextTemplate.replace('{n}', String(n)), exact: true }]
  }
  if (state === 'longtext' && primary === 'companies') {
    return [{ text: 'Showing 1 of 1', exact: true }]
  }
  const n = COUNT[state]
  if (n === undefined) return []
  if (primary === 'companies') {
    return [{ text: `Showing ${Math.min(100, n)} of ${fmt(n)}`, exact: true }]
  }
  if (primary === 'sectors' && !isDashboard(caseId) && n > 50) {
    return [{ text: `Showing 50 of ${fmt(n)}`, exact: true }]
  }
  return []
}
