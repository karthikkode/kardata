// ModelToolbar: model picker menu bound to one chat session. The trigger
// shows the current provider and model; the menu groups every catalog
// model by provider with the active row checked, plus a Thinking switch.
// Everything comes from the backend (GET /v1/providers catalog, GET
// session binding); every change persists immediately with
// PATCH /v1/sessions/:id/model. No fixtures, no guessed models.
import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, ChevronDown } from 'lucide-react'
import { popoverEnter, popoverExit, useExitState } from '@/lib/motion'
import {
  getSession,
  listProviders,
  setSessionModel,
  apiErrorStatus,
  type ProviderEntry,
  type StagingConfig,
} from '../data/staging-api'
import { providerLabel } from './ModelsPanel'

type LoadStatus = 'loading' | 'ready' | 'error' | 'denied' | 'offline'

function statusOf(error: unknown): LoadStatus {
  return apiErrorStatus(error)
}

interface Draft {
  provider: string
  model: string
  reasoning: boolean
  effort?: string
}

/** Server default depth (mirrors backend DEFAULT_EFFORT): used when the
 * user picks an effort-model without choosing a level yet. */
const DEFAULT_EFFORT = 'high'

/** Opening a picker menu anywhere closes every other picker menu: split
 * instances (header model chip plus composer effort) otherwise stack
 * invisible dismiss overlays that swallow each other's clicks. */
const MODELS_MENU_OPEN_EVENT = 'kardata:models-menu-open'

/** Effort flyout width (w-44): used to pick the side with viewport room. */
const FLYOUT_WIDTH = 176

function announceModelsMenuOpen() {
  window.dispatchEvent(new CustomEvent(MODELS_MENU_OPEN_EVENT))
}

/** Collision-aware menu placement: open above the trigger when the space
 * below cannot fit the menu, so bottom-docked composers never push the
 * list off-screen where it cannot be selected. Pure for tests. */
export function shouldOpenAbove(
  rect: { top: number; bottom: number },
  viewportHeight: number,
  needed = 340,
): boolean {
  return viewportHeight - rect.bottom < needed && rect.top >= needed
}

function defaultsOf(providers: ProviderEntry[], defaultProvider: string): Draft {
  const entry = providers.find((item) => item.name === defaultProvider) ?? providers[0]
  if (!entry) return { provider: '', model: '', reasoning: false }
  return {
    provider: entry.name,
    model: entry.defaultModel,
    reasoning: entry.models.find((model) => model.model === entry.defaultModel)?.reasoning === 'native',
  }
}

/** Seed depth for a model: stored level, else the default when the model
 * lists depths, else unset. */
function seedEffort(
  modelId: string,
  models: ProviderEntry['models'],
  stored?: string,
): string | undefined {
  const listed = models.find((model) => model.model === modelId)?.efforts ?? []
  if (listed.length === 0) return undefined
  if (stored && listed.includes(stored)) return stored
  return DEFAULT_EFFORT
}

export function ModelToolbar({
  config,
  sessionId,
  compact = false,
  bare = false,
  display = 'all',
  modelLabel = 'name',
}: {
  /** Null until the staging flag carries credentials: without a config the
   * toolbar stays out of the way instead of inventing providers. */
  config: StagingConfig | null
  /** Null until a session is active: the binding is per-session. */
  sessionId: string | null
  /** Composer-inline pill: truncated model name, menus open upward. */
  compact?: boolean
  /** No outer pill container: the buttons sit directly inside the parent
   * composer's own pill. */
  bare?: boolean
  /** Narrow docks split the picker: 'model' keeps only the model button,
   * 'effort' keeps only the effort dropdown. */
  display?: 'all' | 'model' | 'effort'
  /** 'generic' shows a short Model placeholder instead of the full model
   * name, for composers with no room to spare. */
  modelLabel?: 'name' | 'generic'
}) {
  const [status, setStatus] = useState<LoadStatus>(() => (config ? 'loading' : 'ready'))
  const [providers, setProviders] = useState<ProviderEntry[]>([])
  const [draft, setDraft] = useState<Draft>({ provider: '', model: '', reasoning: false })
  const [boundFor, setBoundFor] = useState<string | null>(null)
  const [bindingFailed, setBindingFailed] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [bindingAttempt, setBindingAttempt] = useState(0)
  const [query, setQuery] = useState('')
  /** Model row with its effort flyout open (hover or keyboard focus).
   * Touch users get the same flyout by tapping the row's effort button. */
  const [expandedKey, setExpandedKey] = useState<string | null>(null)
  const [menuAbove, setMenuAbove] = useState(false)
  const [effortAbove, setEffortAbove] = useState(false)
  const [flyoutTop, setFlyoutTop] = useState(0)
  const [flyoutRight, setFlyoutRight] = useState<number | null>(null)
  const [flyoutLeft, setFlyoutLeft] = useState<number | null>(null)
  const collapseTimer = useRef<number | null>(null)
  const menu = useExitState()
  const effortMenu = useExitState()
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const effortTriggerRef = useRef<HTMLButtonElement | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const menuWasMounted = useRef(false)
  const saveEpoch = useRef(0)

  const fetchCatalog = useCallback(() => {
    if (!config) return undefined
    let live = true
    listProviders(config)
      .then((catalog) => {
        if (!live) return
        setProviders(catalog.providers)
        setDraft((current) => {
          if (current.provider) return current
          const seeded = defaultsOf(catalog.providers, catalog.defaultProvider)
          const entry = catalog.providers.find((item) => item.name === seeded.provider)
          const effort = seedEffort(seeded.model, entry?.models ?? [])
          return effort === undefined ? seeded : { ...seeded, effort }
        })
        setStatus('ready')
      })
      .catch((error: unknown) => {
        if (!live) return
        setStatus(statusOf(error))
      })
    return () => {
      live = false
    }
  }, [config?.baseUrl, config?.apiKey, attempt]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => fetchCatalog(), [fetchCatalog])

  useEffect(
    () => () => {
      if (collapseTimer.current !== null) window.clearTimeout(collapseTimer.current)
    },
    [],
  )

  // Opening the models menu moves focus into it (never the search field,
  // which would steal typing context): Escape then bubbles to the menu
  // handler, which closes and returns focus to the trigger. Focus-once per
  // mount so later typing stays in the search field.
  useEffect(() => {
    if (menu.mounted && !menuWasMounted.current) menuRef.current?.focus({ preventScroll: true })
    menuWasMounted.current = menu.mounted
  })

  // Another picker instance opening its menu closes this one first, so a
  // split header/composer pair never holds two competing dismiss overlays.
  // The ref tracks the latest close (never read during render).
  const closeLatest = useRef(() => {})
  useEffect(() => {
    closeLatest.current = closeMenu
  })
  useEffect(() => {
    const onModelsMenuOpen = () => closeLatest.current()
    window.addEventListener(MODELS_MENU_OPEN_EVENT, onModelsMenuOpen)
    return () => window.removeEventListener(MODELS_MENU_OPEN_EVENT, onModelsMenuOpen)
  }, [])

  // The draft follows the session: the session read carries the latest
  // stored selection, absent until PATCH sets one. A session switch shows
  // a loading line until its own read lands, never the old binding.
  useEffect(() => {
    if (!config || !sessionId) return undefined
    let live = true
    const epoch = saveEpoch.current
    // No synchronous resets here: the parent keys this component by
    // session, so a switch remounts with fresh error state instead of
    // cascading renders.
    getSession(config, sessionId)
      .then((session) => {
        if (!live) return
        if (epoch !== saveEpoch.current) return
        const stored = session.model ?? null
        if (stored) {
          // Before the catalog lands there is nothing to validate
          // against: keep the stored level, re-seeded when providers
          // arrive (the effect re-runs on providers).
          const entry = providers.find((item) => item.name === stored.provider)
          const effort = entry
            ? seedEffort(stored.model, entry.models, stored.effort)
            : stored.effort
          setDraft({
            provider: stored.provider,
            model: stored.model,
            reasoning: stored.reasoning,
            ...(effort === undefined ? {} : { effort }),
          })
        } else {
          setDraft((current) => {
            if (current.provider) return current
            const seeded = defaultsOf(providers, providers[0]?.name ?? '')
            const entry = providers.find((item) => item.name === seeded.provider)
            const effort = seedEffort(seeded.model, entry?.models ?? [])
            return effort === undefined ? seeded : { ...seeded, effort }
          })
        }
        setBoundFor(sessionId)
      })
      .catch(() => {
        if (!live) return
        setBindingFailed(true)
      })
    return () => {
      live = false
    }
    // providers is a real input: the seed needs the catalog to fall back
    // to server defaults, so the effect re-runs when the catalog lands.
  }, [config?.baseUrl, config?.apiKey, sessionId, bindingAttempt, providers]) // eslint-disable-line react-hooks/exhaustive-deps

  function retryCatalog() {
    setStatus('loading')
    setAttempt((value) => value + 1)
  }

  function retryBinding() {
    setBindingFailed(false)
    setBindingAttempt((value) => value + 1)
  }

  function closeMenu() {
    menu.set(false)
    effortMenu.set(false)
    setQuery('')
    setExpandedKey(null)
    if (collapseTimer.current !== null) {
      window.clearTimeout(collapseTimer.current)
      collapseTimer.current = null
    }
  }

  /** Open the side flyout anchored to a row element. The flyout lives in
   * a portal (fixed positioning), so it never clips inside the menu's
   * scroll container and never overlaps the list. It opens left of the
   * row, or right when a narrow dock leaves no room on the left. */
  function openFlyout(key: string, anchor: HTMLElement) {
    if (collapseTimer.current !== null) {
      window.clearTimeout(collapseTimer.current)
      collapseTimer.current = null
    }
    const rect = anchor.getBoundingClientRect()
    // Room for the w-44 card plus a gap, clamped into the viewport with
    // room for roughly five levels.
    setFlyoutTop(Math.max(8, Math.min(rect.top - 4, window.innerHeight - 240)))
    const roomLeft = rect.left - 8
    const roomRight = window.innerWidth - rect.right - 8
    if (roomLeft < FLYOUT_WIDTH + 8 && roomRight >= roomLeft) {
      setFlyoutLeft(Math.max(8, rect.right + 8))
      setFlyoutRight(null)
    } else {
      setFlyoutRight(Math.max(8, window.innerWidth - rect.left + 8))
      setFlyoutLeft(null)
    }
    setExpandedKey(key)
  }

  function scheduleCollapse(key: string) {
    if (collapseTimer.current !== null) window.clearTimeout(collapseTimer.current)
    collapseTimer.current = window.setTimeout(() => {
      setExpandedKey((current) => (current === key ? null : current))
    }, 120)
  }

  /** Persist one selection; the stored response is the truth the draft
   * syncs back to. A failed save re-reads the binding so the picker
   * falls back to the server value instead of the rejected choice. Depth
   * travels only when the model lists the level, defaulting to the
   * server default when the user has not chosen one. */
  function persist(next: Draft) {
    if (!config || !sessionId || saving) return
    const entry = providers.find((item) => item.name === next.provider)
    const selected = entry?.models.find((model) => model.model === next.model)
    const canReason = selected?.reasoning === 'native'
    const listed = selected?.efforts ?? []
    const effort =
      listed.length === 0
        ? undefined
        : next.effort && listed.includes(next.effort)
          ? next.effort
          : DEFAULT_EFFORT
    const outgoing: Draft = {
      provider: next.provider,
      model: next.model,
      reasoning: canReason ? next.reasoning : false,
      ...(effort === undefined ? {} : { effort }),
    }
    setDraft(outgoing)
    setSaving(true)
    setSaveError(null)
    setSessionModel(config, sessionId, {
      provider: 'meta',
      model: next.model,
      reasoning: outgoing.reasoning,
      ...(outgoing.effort === undefined ? {} : { effort: outgoing.effort }),
    })
      .then((stored) => {
        saveEpoch.current += 1
        setDraft({
          provider: stored.provider,
          model: stored.model,
          reasoning: stored.reasoning,
          ...(stored.effort === undefined ? {} : { effort: stored.effort }),
        })
        setBoundFor(sessionId)
        setBindingFailed(false)
      })
      .catch(() => {
        setSaveError('The model did not save. Check your connection and try again.')
        retryBinding()
      })
      .finally(() => {
        setSaving(false)
      })
  }

  if (!config || !sessionId) return null

  const activeEntry = providers.find((item) => item.name === draft.provider) ?? null
  const activeModel = activeEntry?.models.find((model) => model.model === draft.model) ?? null
  const canReason = activeModel?.reasoning === 'native'
  const activeEfforts = activeModel?.efforts ?? []
  // Meta-style mandatory thinking: depth levels replace the on/off
  // switch, which only fits models with optional reasoning.
  const showEffort = activeEfforts.length > 0
  const showThinking = canReason && !showEffort
  const unconfigured = activeEntry && !activeEntry.hasKey
  const lowered = query.trim().toLowerCase()
  const matches = (entry: ProviderEntry) =>
    entry.models.filter(
      (model) =>
        !lowered ||
        model.displayName.toLowerCase().includes(lowered) ||
        model.model.toLowerCase().includes(lowered) ||
        providerLabel(entry.name).toLowerCase().includes(lowered),
    )
  const visibleProviders = providers.filter((entry) => matches(entry).length > 0)
  const triggerLabel =
    status !== 'ready' || boundFor !== sessionId || !activeEntry || !activeModel
      ? 'Choose a model'
      : modelLabel === 'generic'
        ? 'Model'
        : compact
          ? activeModel.displayName
          : `${providerLabel(activeEntry.name)} ${activeModel.displayName}`

  /** Portal anchor for the side flyout: the expanded row's provider and
   * model, resolved from the catalog so levels never come from UI state. */
  const flyoutTarget = (() => {
    if (expandedKey === null) return null
    for (const entry of providers) {
      const model = entry.models.find((item) => `${entry.name}:${item.model}` === expandedKey)
      if (model && model.efforts.length > 0) return { key: expandedKey, entry, model }
    }
    return null
  })()

  return (
    <div className={compact ? 'relative min-w-0 shrink-0' : 'relative border-b border-border px-4 py-2'}>
      {status === 'loading' ? (
        <p role="status" className="text-xs text-muted-foreground">
          Loading models.
        </p>
      ) : status === 'error' ? (
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-xs text-muted-foreground">Models did not load.</p>
          <button
            type="button"
            onClick={retryCatalog}
            className="h-8 pointer-coarse:h-10 shrink-0 cursor-pointer rounded-md border border-border px-2 text-xs"
          >
            Try again
          </button>
        </div>
      ) : status === 'denied' ? (
        <p className="text-xs text-muted-foreground">Models are not shared with this key.</p>
      ) : status === 'offline' ? (
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-xs text-muted-foreground">Models need a connection.</p>
          <button
            type="button"
            onClick={retryCatalog}
            className="h-8 pointer-coarse:h-10 shrink-0 cursor-pointer rounded-md border border-border px-2 text-xs"
          >
            Try again
          </button>
        </div>
      ) : bindingFailed || boundFor !== sessionId ? (
        <div className="flex flex-wrap items-center gap-2">
          <p role="status" className="text-xs text-muted-foreground">
            {bindingFailed ? 'The current model did not load.' : 'Loading the current model.'}
          </p>
          {bindingFailed ? (
            <button
              type="button"
              onClick={retryBinding}
              className="h-8 pointer-coarse:h-10 shrink-0 cursor-pointer rounded-md border border-border px-2 text-xs"
            >
              Try again
            </button>
          ) : null}
        </div>
      ) : (
        <div
          className={
            bare
              ? 'flex min-w-0 max-w-32 items-center gap-0.5 sm:max-w-52'
              : `flex items-center gap-0.5 rounded-full border border-border bg-background py-1 pr-1.5 pl-1.5 ${compact ? 'max-w-44 sm:max-w-60' : ''}`
          }
        >
          {display === 'effort' ? null : (
            <button
              ref={triggerRef}
              type="button"
              aria-haspopup="menu"
              aria-expanded={menu.open}
              aria-label="Choose a model"
              disabled={saving || providers.length === 0}
              onClick={() => {
                effortMenu.set(false)
                if (menu.open) closeMenu()
                else {
                  announceModelsMenuOpen()
                  const rect = triggerRef.current?.getBoundingClientRect()
                  setMenuAbove(rect ? shouldOpenAbove(rect, window.innerHeight) : false)
                  menu.set(true)
                }
              }}
              className="flex h-8 pointer-coarse:h-10 min-w-0 flex-1 cursor-pointer items-center gap-1 rounded-full px-2.5 text-xs font-medium hover:bg-muted disabled:pointer-events-none disabled:opacity-50"
            >
              <span className="min-w-0 flex-1 truncate text-left">{triggerLabel}</span>
              <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
            </button>
          )}
          {showEffort && display !== 'model' ? (
            <>
              {display === 'all' ? (
                <span aria-hidden className="h-4 w-px shrink-0 bg-border" />
              ) : null}
              <button
                ref={effortTriggerRef}
                type="button"
                aria-haspopup="menu"
                aria-expanded={effortMenu.open}
                aria-label="Choose reasoning effort"
                disabled={saving}
                onClick={() => {
                  menu.set(false)
                  if (effortMenu.open) closeMenu()
                  else {
                    announceModelsMenuOpen()
                    const rect = effortTriggerRef.current?.getBoundingClientRect()
                    setEffortAbove(rect ? shouldOpenAbove(rect, window.innerHeight, 240) : false)
                    effortMenu.set(true)
                  }
                }}
                className="flex h-8 pointer-coarse:h-10 shrink-0 cursor-pointer items-center gap-0.5 rounded-full px-2.5 text-xs capitalize text-muted-foreground hover:bg-muted disabled:pointer-events-none disabled:opacity-50"
              >
                {draft.effort ?? DEFAULT_EFFORT}
                <ChevronDown className="size-3.5 shrink-0" aria-hidden />
              </button>
            </>
          ) : !showEffort && draft.reasoning && canReason && !bare ? (
            <span className="shrink-0 px-1 text-xs text-muted-foreground">Thinking</span>
          ) : null}
          {saving ? (
            <span role="status" className="shrink-0 pr-1 text-xs text-muted-foreground">
              Saving
            </span>
          ) : null}
          {unconfigured ? (
            <span className="shrink-0 pr-1 text-xs text-muted-foreground">No key</span>
          ) : null}
        </div>
      )}
      {effortMenu.mounted && status === 'ready' && boundFor === sessionId && showEffort ? (
        <>
          <button
            type="button"
            aria-label="Dismiss reasoning effort"
            onClick={closeMenu}
            className="fixed inset-0 z-40 cursor-default bg-transparent"
          />
          <div
            role="menu"
            aria-label="Reasoning effort"
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.stopPropagation()
                closeMenu()
                effortTriggerRef.current?.focus()
              }
            }}
            className={`z-50 mb-2 w-44 overflow-hidden rounded-xl border border-border bg-muted p-2 shadow-xl ${compact || effortAbove ? 'absolute right-0 bottom-full' : 'absolute right-4 top-full'} ${effortMenu.closing ? popoverExit : popoverEnter}`}
          >
            {activeEfforts.map((level) => {
              const active = (draft.effort ?? DEFAULT_EFFORT) === level
              return (
                <button
                  key={level}
                  type="button"
                  role="menuitemradio"
                  aria-checked={active}
                  onClick={() => {
                    persist({ ...draft, effort: level })
                    closeMenu()
                  }}
                  className="flex w-full cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs capitalize hover:bg-background"
                >
                  <span className="w-4 shrink-0">
                    {active ? <Check className="size-3.5" aria-hidden /> : null}
                  </span>
                  <span className="min-w-0 flex-1 truncate font-medium">{level}</span>
                </button>
              )
            })}
          </div>
        </>
      ) : null}
      {saveError ? (
        <p role="alert" className="mt-1 text-xs text-muted-foreground">
          {saveError}
        </p>
      ) : null}
      {menu.mounted && status === 'ready' && boundFor === sessionId ? (
        <>
          <button
            type="button"
            aria-label="Dismiss models"
            onClick={closeMenu}
            className="fixed inset-0 z-40 cursor-default bg-transparent"
          />
          <div
            role="menu"
            aria-label="Models"
            ref={menuRef}
            tabIndex={-1}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.stopPropagation()
                closeMenu()
                triggerRef.current?.focus()
              }
            }}
            className={`z-50 flex max-h-80 flex-col overflow-hidden rounded-xl border border-border bg-muted shadow-xl ${compact || menuAbove ? 'absolute right-0 bottom-full mb-2 w-72' : 'absolute inset-x-4 top-full mt-2'} ${menu.closing ? popoverExit : popoverEnter}`}
          >
            <div className="border-b border-border p-2">
              <input
                aria-label="Search models"
                value={query}
                placeholder="Search models"
                onChange={(event) => setQuery(event.target.value)}
                className="h-8 w-full rounded-md border border-border bg-background px-2 text-xs outline-none placeholder:text-muted-foreground focus:border-muted-foreground"
              />
            </div>
            <div
              className="scroll-slim min-h-0 flex-1 overflow-y-auto p-2"
              onScroll={() => {
                // The flyout is viewport-anchored: scrolling the list
                // would detach it, so collapse instead of chasing.
                setExpandedKey(null)
              }}
            >
              {visibleProviders.length === 0 ? (
                <p className="px-2 py-4 text-center text-xs text-muted-foreground">
                  No models match this search.
                </p>
              ) : (
                visibleProviders.map((entry) => (
                  <div key={entry.name} className="mb-1 last:mb-0">
                    <div className="flex items-baseline justify-between gap-2 px-2 pt-1.5 pb-0.5">
                      <p className="text-xs font-semibold tracking-wide text-muted-foreground">
                        {providerLabel(entry.name)}
                      </p>
                      {!entry.hasKey ? (
                        <p className="text-xs text-muted-foreground">No key</p>
                      ) : null}
                    </div>
                    {matches(entry).map((model) => {
                      const selected = entry.name === draft.provider && model.model === draft.model
                      const key = `${entry.name}:${model.model}`
                      const expanded = expandedKey === key
                      const hasDepths = model.efforts.length > 0
                      const currentLevel =
                        selected && draft.effort && model.efforts.includes(draft.effort)
                          ? draft.effort
                          : null
                      return (
                        <div
                          key={model.model}
                          data-flyout-row={key}
                          onMouseEnter={(event) => {
                            if (hasDepths && selected) openFlyout(key, event.currentTarget)
                          }}
                          onMouseLeave={() => {
                            if (hasDepths && selected) scheduleCollapse(key)
                          }}
                        >
                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              role="menuitemradio"
                              aria-checked={selected}
                              onFocus={(event) => {
                                if (hasDepths && selected) {
                                  const row = event.currentTarget.closest('[data-flyout-row]')
                                  if (row instanceof HTMLElement) openFlyout(key, row)
                                }
                              }}
                              onClick={() => {
                                persist({
                                  provider: entry.name,
                                  model: model.model,
                                  reasoning: model.reasoning === 'native',
                                  ...(draft.effort === undefined ? {} : { effort: draft.effort }),
                                })
                                closeMenu()
                              }}
                              className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs hover:bg-background"
                            >
                              <span className="w-4 shrink-0">
                                {selected ? <Check className="size-3.5" aria-hidden /> : null}
                              </span>
                              <span className="min-w-0 flex-1 truncate font-medium">
                                {model.displayName}
                              </span>
                              {model.reasoning === 'native' && !hasDepths ? (
                                <span className="shrink-0 text-xs text-muted-foreground">
                                  Thinking
                                </span>
                              ) : null}
                            </button>
                            {hasDepths ? (
                              <button
                                type="button"
                                aria-label={`Effort for ${model.displayName}`}
                                aria-expanded={expanded}
                                onClick={(event) => {
                                  if (expanded) {
                                    setExpandedKey(null)
                                    return
                                  }
                                  const row = event.currentTarget.closest('[data-flyout-row]')
                                  if (row instanceof HTMLElement) openFlyout(key, row)
                                  else setExpandedKey(key)
                                }}
                                className="h-8 pointer-coarse:h-10 shrink-0 cursor-pointer rounded-md border border-border px-1.5 text-xs capitalize text-muted-foreground hover:border-muted-foreground"
                              >
                                {currentLevel ?? 'Effort'}
                              </button>
                            ) : null}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                ))
              )}
            </div>
            {flyoutTarget
              ? createPortal(
                  <div
                    role="menu"
                    aria-label={`Effort for ${flyoutTarget.model.displayName}`}
                    onMouseEnter={() => {
                      if (collapseTimer.current !== null) {
                        window.clearTimeout(collapseTimer.current)
                        collapseTimer.current = null
                      }
                    }}
                    onMouseLeave={() => scheduleCollapse(flyoutTarget.key)}
                    className={`fixed z-[60] w-44 rounded-xl border border-border bg-muted p-2 shadow-xl ${popoverEnter}`}
                    style={{
                      top: flyoutTop,
                      ...(flyoutLeft === null ? { right: flyoutRight ?? 8 } : { left: flyoutLeft }),
                    }}
                  >
                    <p className="px-2 pt-1 pb-0.5 text-xs font-semibold tracking-wide text-muted-foreground">
                      Effort
                    </p>
                    {flyoutTarget.model.efforts.map((level) => {
                      const targetSelected =
                        flyoutTarget.entry.name === draft.provider &&
                        flyoutTarget.model.model === draft.model
                      const active =
                        (targetSelected ? (draft.effort ?? DEFAULT_EFFORT) : DEFAULT_EFFORT) ===
                        level
                      return (
                        <button
                          key={level}
                          type="button"
                          role="menuitemradio"
                          aria-checked={targetSelected && active}
                          onClick={() => {
                            persist({
                              provider: flyoutTarget.entry.name,
                              model: flyoutTarget.model.model,
                              reasoning: flyoutTarget.model.reasoning === 'native',
                              effort: level,
                            })
                            closeMenu()
                          }}
                          title={
                            targetSelected
                              ? `Effort ${level}`
                              : `Switch to ${flyoutTarget.model.displayName} at ${level} effort`
                          }
                          className="flex w-full cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs capitalize hover:bg-background"
                        >
                          <span className="w-4 shrink-0">
                            {targetSelected && active ? (
                              <Check className="size-3.5" aria-hidden />
                            ) : null}
                          </span>
                          <span className="min-w-0 flex-1 truncate font-medium">{level}</span>
                        </button>
                      )
                    })}
                  </div>,
                  document.body,
                )
              : null}
            <div className="border-t border-border p-2">
              {showThinking || !canReason ? (
                <button
                  type="button"
                  role="switch"
                  aria-checked={canReason && draft.reasoning}
                  aria-label="Thinking"
                  disabled={!canReason || saving}
                  title={canReason ? 'Reason before answering.' : 'Not available on this model.'}
                  onClick={() =>
                    persist({ provider: draft.provider, model: draft.model, reasoning: !draft.reasoning })
                  }
                  className="flex w-full cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs disabled:pointer-events-none disabled:opacity-50 hover:bg-background"
                >
                  <span
                    aria-hidden
                    className={`relative h-4 w-7 shrink-0 rounded-full transition-colors ${canReason && draft.reasoning ? 'bg-foreground' : 'bg-border'}`}
                  >
                    <span
                      className={`absolute top-0.5 size-3 rounded-full bg-background transition-all ${canReason && draft.reasoning ? 'left-3.5' : 'left-0.5'}`}
                    />
                  </span>
                  <span className="font-medium">Thinking</span>
                  {!canReason ? (
                    <span className="ml-auto text-xs text-muted-foreground">
                      Not on this model
                    </span>
                  ) : null}
                </button>
              ) : null}
            </div>
          </div>
        </>
      ) : null}
    </div>
  )
}
