// Sector context drawer: the Context button payload in clear text. Fetched
// on open only; shows the verbatim system/references segments with the
// token meter, per-file units with include/exclude toggles, user notes with
// add, and deliberate loading/empty/error/denied states.
import { useEffect, useState } from 'react'
import { Eye, EyeOff, Plus } from 'lucide-react'
import {
  getSectorContext,
  patchSectorContext,
  type ContextFileView,
  type SectorContextView,
  type StagingConfig,
} from '../data/staging-api'
import { Button } from './ui/button'
import { Input } from './ui/input'

type DrawerState =
  | { status: 'closed' }
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'denied' }
  | { status: 'ready'; view: SectorContextView }

function errorKind(error: unknown): 'denied' | 'error' {
  const message = error instanceof Error ? error.message : ''
  return /403|forbidden|denied/i.test(message) ? 'denied' : 'error'
}

/** Backend-mismatch guard: a 200 with the wrong shape (stale backend,
 * proxy page, sector payload) becomes an error state, never a crash. */
function isSectorContextView(data: unknown): data is SectorContextView {
  if (typeof data !== 'object' || data === null) return false
  const segments = (data as { segments?: unknown }).segments
  if (typeof segments !== 'object' || segments === null) return false
  const refs = (segments as { references?: unknown }).references
  return typeof (segments as { system?: unknown }).system === 'string' && Array.isArray(refs)
}

function MeterBar({ view }: { view: SectorContextView }) {
  // Model window the meter scales against (muse-spark class, 1M tokens).
  // Usage reads come from the backend view; only the scale lives here.
  const WINDOW_TOKENS = 1_000_000
  const total = view.usage.totalEstimatedTokens
  const percent = ((total / WINDOW_TOKENS) * 100).toFixed(2)
  const parts = [
    { label: 'Stable', tokens: view.usage.system.estimatedTokens + view.usage.references.estimatedTokens },
    { label: 'History', tokens: view.usage.history.estimatedTokens },
    { label: 'Tail', tokens: view.usage.tail.estimatedTokens },
  ]
  return (
    <div>
      <div
        role="img"
        aria-label={`Context meter: ${total} of ${WINDOW_TOKENS} estimated tokens (${percent} percent of context)`}
        className="flex h-2.5 w-full overflow-hidden rounded-full border border-border"
      >
        {parts.map((part) => (
          <span
            key={part.label}
            title={`${part.label}: ${part.tokens} tokens`}
            className="h-full bg-muted-foreground/60 first:bg-foreground"
            style={{ width: `${(part.tokens / Math.max(1, WINDOW_TOKENS)) * 100}%` }}
          />
        ))}
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        {total.toLocaleString()} / {WINDOW_TOKENS.toLocaleString()} tokens · {percent}% of context · digest{' '}
        {view.digest.version} · {view.segments.references.length} references
      </p>
    </div>
  )
}

function FileBlock({
  file,
  onToggleUnit,
  toggling,
}: {
  file: ContextFileView
  onToggleUnit: (documentId: string, ord: number | undefined, excluded: boolean) => void
  toggling: string | null
}) {
  const [open, setOpen] = useState(false)
  return (
    <li className="rounded-lg border border-border px-3 py-2">
      <div className="flex items-center gap-2 text-sm">
        <button
          type="button"
          className="min-w-0 flex-1 truncate text-left font-medium underline-offset-4 hover:underline"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          {file.filename}
        </button>
        {file.status === 'needs-ocr' ? (
          <span className="shrink-0 rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground">
            needs OCR
          </span>
        ) : null}
        {file.excluded ? (
          <span className="shrink-0 text-xs text-muted-foreground">excluded</span>
        ) : null}
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={toggling !== null}
          onClick={() => onToggleUnit(file.id, undefined, !file.excluded)}
          aria-label={file.excluded ? `Include ${file.filename}` : `Exclude ${file.filename}`}
        >
          {file.excluded ? <Eye className="size-4" aria-hidden /> : <EyeOff className="size-4" aria-hidden />}
        </Button>
      </div>
      <p className="mt-1 font-mono text-xs text-muted-foreground">
        {file.units.length} {file.units.length === 1 ? 'unit' : 'units'} · {(file.chars / 1000).toFixed(1)}k chars
      </p>
      {open ? (
        <ul className="mt-2 max-h-64 space-y-2 overflow-y-auto pr-1">
          {file.units.map((unit) => (
            <li key={unit.ord} className={unit.excluded ? 'opacity-60' : undefined}>
              <div className="flex items-center gap-2">
                <span className="font-mono text-xs text-muted-foreground">
                  [{file.filename}:{unit.ord}] {unit.kind}
                  {unit.uncertain ? ' · uncertain' : ''}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={toggling !== null}
                  onClick={() => onToggleUnit(file.id, unit.ord, !unit.excluded)}
                  aria-label={unit.excluded ? `Include unit ${unit.ord}` : `Exclude unit ${unit.ord}`}
                >
                  {unit.excluded ? <Eye className="size-4" aria-hidden /> : <EyeOff className="size-4" aria-hidden />}
                </Button>
              </div>
              <p className="mt-0.5 whitespace-pre-wrap text-sm">{unit.text}</p>
            </li>
          ))}
        </ul>
      ) : null}
    </li>
  )
}

export function SectorContextDrawer({
  config,
  sectorId,
  sectorName,
}: {
  config: StagingConfig | null
  sectorId: string
  sectorName: string
}) {
  const [state, setState] = useState<DrawerState>({ status: 'closed' })
  const [note, setNote] = useState('')
  const [toggling, setToggling] = useState<string | null>(null)
  const [savingNote, setSavingNote] = useState(false)
  const [patchError, setPatchError] = useState<string | null>(null)
  const [reloadAttempt, setReloadAttempt] = useState(0)

  function fail(error: unknown): void {
    const kind = errorKind(error)
    setState(kind === 'denied' ? { status: 'denied' } : { status: 'error', message: error instanceof Error ? error.message : 'Context did not load.' })
  }

  // Docked panel mode: resets happen during render (ChatPanel sessionQuery
  // pattern); the effect only subscribes to the fetch, so no setState runs
  // synchronously inside it.
  const panelKey = config ? `${config.baseUrl} ${config.apiKey} ${sectorId}` : null
  const [activePanelKey, setActivePanelKey] = useState<string | null>(null)
  if (activePanelKey !== panelKey) {
    setActivePanelKey(panelKey)
    setState(panelKey ? { status: 'loading' } : { status: 'closed' })
    setPatchError(null)
  }
  useEffect(() => {
    if (!config) return
    let live = true
    getSectorContext(config, sectorId).then(
      (view) => {
        if (!live) return
        if (!isSectorContextView(view)) {
          setState({ status: 'error', message: 'Context response was not a context view. Rebuild the backend and retry.' })
          return
        }
        setState({ status: 'ready', view })
      },
      (error: unknown) => {
        if (!live) return
        fail(error)
      },
    )
    return () => {
      live = false
    }
  }, [config?.baseUrl, config?.apiKey, sectorId, reloadAttempt])

  function retry() {
    setReloadAttempt((attempt) => attempt + 1)
  }

  async function toggleUnit(documentId: string, ord: number | undefined, excluded: boolean) {
    if (!config || state.status !== 'ready') return
    const key = `${documentId}:${ord ?? 'doc'}`
    setToggling(key)
    setPatchError(null)
    try {
      const ref = ord === undefined ? { documentId } : { documentId, ord }
      const view = await patchSectorContext(config, sectorId, excluded ? { exclude: [ref] } : { include: [ref] })
      setState({ status: 'ready', view })
    } catch (error: unknown) {
      setPatchError(error instanceof Error ? error.message : 'Update failed.')
    } finally {
      setToggling(null)
    }
  }

  async function addNote() {
    if (!config || state.status !== 'ready' || !note.trim() || savingNote) return
    setSavingNote(true)
    setPatchError(null)
    try {
      setState({ status: 'ready', view: await patchSectorContext(config, sectorId, { notes: [note.trim()] }) })
      setNote('')
    } catch (error: unknown) {
      setPatchError(error instanceof Error ? error.message : 'Note failed.')
    } finally {
      setSavingNote(false)
    }
  }

  if (state.status === 'closed') {
    return <p className="text-sm text-muted-foreground">Context needs the staging backend first.</p>
  }

  return (
    <div role="region" aria-label={`Context for ${sectorName}`} className="flex min-h-0 flex-col px-4 py-3">
      <div className="flex items-center gap-2">
        <h2 className="flex-1 text-base font-semibold">Context</h2>
      </div>
      {state.status === 'loading' ? <p className="mt-2 text-sm text-muted-foreground">Loading context…</p> : null}
      {state.status === 'error' ? (
        <div className="mt-2">
          <p role="alert" className="text-sm text-muted-foreground">{state.message}</p>
          <Button type="button" variant="outline" size="sm" className="mt-2" onClick={retry}>
            Retry
          </Button>
        </div>
      ) : null}
      {state.status === 'denied' ? (
        <p className="mt-2 text-sm text-muted-foreground">This key cannot read sector context.</p>
      ) : null}
      {state.status === 'ready' ? (
        <div className="mt-2 min-h-0 flex-1 space-y-4">
          <div className="sticky top-0 z-10 border-b border-border bg-background/95 py-2 backdrop-blur">
            <MeterBar view={state.view} />
          </div>
          <section aria-label="System prompt">
            <h3 className="text-sm font-medium">System</h3>
            <p className="mt-1 whitespace-pre-wrap text-sm">{state.view.segments.system}</p>
          </section>
          <section aria-label="Pinned references">
            <h3 className="text-sm font-medium">References</h3>
            {state.view.segments.references.length ? (
              <ul className="mt-2 space-y-1">
                {state.view.segments.references.map((text, index) => (
                  <li key={index} className="whitespace-pre-wrap text-sm">
                    <span className="font-mono text-xs text-muted-foreground">[ref:{index}] </span>
                    {text}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-1 text-sm text-muted-foreground">No pinned reference texts.</p>
            )}
            {state.view.files.length ? (
              <ul className="mt-2 space-y-2">
                {state.view.files.map((file) => (
                  <FileBlock key={file.id} file={file} onToggleUnit={toggleUnit} toggling={toggling} />
                ))}
              </ul>
            ) : (
              <p className="mt-1 text-sm text-muted-foreground">No files attached. References grow here as files attach.</p>
            )}
            {state.view.notes.length ? (
              <ul className="mt-2 space-y-1">
                {state.view.notes.map((item, index) => (
                  <li key={item.id} className="text-sm">
                    <span className="font-mono text-xs text-muted-foreground">[note:{index + 1}] </span>
                    {item.text}
                  </li>
                ))}
              </ul>
            ) : null}
          </section>
          <section aria-label="Conversation history">
            <h3 className="text-sm font-medium">History</h3>
            {state.view.segments.history.length ? (
              <ul className="mt-2 space-y-1">
                {state.view.segments.history.map((text, index) => (
                  <li key={index} className="whitespace-pre-wrap text-sm">
                    <span className="font-mono text-xs text-muted-foreground">[history:{index}] </span>
                    {text}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-1 text-sm text-muted-foreground">No history pinned.</p>
            )}
          </section>
          <section aria-label="Context tail">
            <h3 className="text-sm font-medium">Tail</h3>
            {state.view.segments.tail.length ? (
              <ul className="mt-2 space-y-1">
                {state.view.segments.tail.map((text, index) => (
                  <li key={index} className="whitespace-pre-wrap text-sm">
                    <span className="font-mono text-xs text-muted-foreground">[tail:{index}] </span>
                    {text}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-1 text-sm text-muted-foreground">No tail pinned.</p>
            )}
          </section>
          <section aria-label="Add a context note" className="sticky bottom-0 z-10 border-t border-border bg-background/95 py-2 backdrop-blur">
            <h3 className="text-sm font-medium">Add note</h3>
            <div className="mt-1 flex gap-2">
              <Input
                aria-label="Context note"
                placeholder="Focus on pricing evidence."
                className="ring-offset-background focus-visible:ring-2 focus-visible:ring-offset-2"
                value={note}
                onChange={(event) => setNote(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') void addNote()
                }}
              />
              <Button type="button" variant="outline" size="sm" disabled={savingNote || !note.trim()} onClick={() => void addNote()}>
                <Plus className="size-4" aria-hidden />
                Add
              </Button>
            </div>
          </section>
          {patchError ? (
            <p role="alert" className="text-sm text-muted-foreground">{patchError}</p>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
