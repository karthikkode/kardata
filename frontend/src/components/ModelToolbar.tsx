// ModelToolbar: model picker menu bound to one chat session. The trigger
// is a ghost chip (display name plus effort); the menu groups every
// catalog model by provider with the active row checked, effort levels in
// a nested submenu, plus a Reasoning switch. Everything comes from the
// backend (GET /v1/providers catalog, GET session binding); every change
// persists immediately with PATCH /v1/sessions/:id/model. No fixtures,
// no guessed models. Keyboard (arrows, Home/End, Enter, Esc, typeahead)
// and collision-aware placement come from the Base UI menu primitive.
import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { Icons } from '@/lib/icons'
import { getSession } from '../data/api/sessions'
import { setSessionModel, type ProviderEntry } from '../data/api/models'
import { type StagingConfig } from '../data/api/client'
import { useModelCatalog } from '../data/useModelCatalog'
import { providerLabel } from './ModelsPanel'
import { Caption } from './text'
import { Button } from './ui/button'
import { Input } from './ui/input'
import {
  MenuGroup,
  MenuLabel,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuRoot,
  MenuSeparator,
  MenuSubmenuPopup,
  MenuSubmenuRoot,
  MenuSubmenuTrigger,
  MenuTrigger,
} from './ui/menu'
import { SwitchRoot } from './ui/switch'

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
 * instances (header model chip plus composer effort) otherwise stack. */
const MODELS_MENU_OPEN_EVENT = 'kardata:models-menu-open'

function announceModelsMenuOpen() {
  window.dispatchEvent(new CustomEvent(MODELS_MENU_OPEN_EVENT))
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

/** Effort radio group: a real component (not a render-called helper) so
 * picking stays an event-handler closure the hooks rules accept. */
function EffortLevels({ levels, current, onPick }: { levels: string[]; current: string; onPick: (level: string) => void }) {
  return (
    <MenuRadioGroup value={current} onValueChange={(value) => onPick(value)}>
      {levels.map((level) => (
        <MenuRadioItem key={level} value={level} className="capitalize">
          {level}
        </MenuRadioItem>
      ))}
    </MenuRadioGroup>
  )
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
  const catalog = useModelCatalog(config)
  const { providers, status } = catalog
  const [draft, setDraft] = useState<Draft>({ provider: '', model: '', reasoning: false })
  const [boundFor, setBoundFor] = useState<string | null>(null)
  const [bindingFailed, setBindingFailed] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [bindingAttempt, setBindingAttempt] = useState(0)
  const [query, setQuery] = useState('')
  const [menuOpen, setMenuOpen] = useState(false)
  const [effortOpen, setEffortOpen] = useState(false)
  const saveEpoch = useRef(0)

  // Seed the draft from the catalog once providers land (the binding
  // effect below overwrites with the stored selection when present).
  // Render-time, like the query keys: retries keep the user's picks.
  if (draft.provider === '' && providers.length > 0) {
    const seeded = defaultsOf(providers, catalog.defaultProvider)
    const entry = providers.find((item) => item.name === seeded.provider)
    const effort = seedEffort(seeded.model, entry?.models ?? [])
    setDraft(effort === undefined ? seeded : { ...seeded, effort })
  }

  // Another picker instance opening its menu closes this one first, so a
  // split header/composer pair never holds two competing menus.
  useEffect(() => {
    const onModelsMenuOpen = () => {
      setMenuOpen(false)
      setEffortOpen(false)
    }
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
        // A save that resolved after this read started already carries
        // the newer binding: a stale read must not overwrite it.
        if (!live || epoch !== saveEpoch.current) return
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
    catalog.reload()
  }

  function retryBinding() {
    setBindingFailed(false)
    setBindingAttempt((value) => value + 1)
  }

  function openMenu(next: boolean) {
    // Announce first: the broadcast closes other instances (this one is
    // still closed, so its own listener is a no-op), then this opens.
    if (next) announceModelsMenuOpen()
    setMenuOpen(next)
    setEffortOpen(false)
    if (!next) setQuery('')
  }

  function openEffort(next: boolean) {
    if (next) announceModelsMenuOpen()
    setEffortOpen(next)
    setMenuOpen(false)
  }

  /** Persist one selection; the stored response is the truth the draft
   * syncs back to. A failed save re-reads the binding so the picker
   * falls back to the server value instead of the rejected choice. Depth
   * travels only when the model lists the level, defaulting to the
   * server default when the user has not chosen one. */
  function persist(next: Draft) {
    if (!config || !sessionId || saving) return
    // The sent provider is the selected catalog entry's name, never a
    // literal: the picker resolves the choice against the catalog first
    // and bails on a stale draft with no matching entry.
    const entry = providers.find((item) => item.name === next.provider)
    if (!entry) return
    const selected = entry.models.find((model) => model.model === next.model)
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
      provider: entry.name,
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
        : activeModel.displayName
  const triggerEffort = showEffort && display !== 'effort' ? (draft.effort ?? DEFAULT_EFFORT) : null

  /** Search-field keys: arrows move into the list, Enter picks the first
   * match, Escape/Tab bubble to the menu; anything else stays in the
   * field instead of driving menu typeahead. */
  function onSearchKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    const menu = event.currentTarget.closest('[role="menu"]')
    const items = menu
      ? Array.from(menu.querySelectorAll('[role="menuitemradio"],[role="menuitem"]')).filter(
          (element): element is HTMLElement => element instanceof HTMLElement,
        )
      : []
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      const target = event.key === 'ArrowDown' ? items[0] : items[items.length - 1]
      target?.focus()
    } else if (event.key === 'Enter') {
      event.preventDefault()
      items[0]?.click()
    } else if (event.key !== 'Escape' && event.key !== 'Tab') {
      event.stopPropagation()
    }
  }


  return (
    <div className={compact ? 'relative min-w-0' : 'relative px-4 py-2'}>
      {status === 'loading' ? (
        <p role="status" className="text-xs text-muted-foreground">
          Loading models.
        </p>
      ) : status === 'error' ? (
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-xs text-muted-foreground">Models did not load.</p>
          <Button type="button" variant="secondary" size="sm" onClick={retryCatalog}>
            Try again
          </Button>
        </div>
      ) : status === 'denied' ? (
        <p className="text-xs text-muted-foreground">Models are not shared with this key.</p>
      ) : status === 'offline' ? (
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-xs text-muted-foreground">Models need a connection.</p>
          <Button type="button" variant="secondary" size="sm" onClick={retryCatalog}>
            Try again
          </Button>
        </div>
      ) : bindingFailed || boundFor !== sessionId ? (
        <div className="flex flex-wrap items-center gap-2">
          <p role="status" className="text-xs text-muted-foreground">
            {bindingFailed ? 'The current model did not load.' : 'Loading the current model.'}
          </p>
          {bindingFailed ? (
            <Button type="button" variant="secondary" size="sm" onClick={retryBinding}>
              Try again
            </Button>
          ) : null}
        </div>
      ) : display === 'effort' ? activeEfforts.length === 0 ? null : (
        <MenuRoot open={effortOpen} onOpenChange={openEffort}>
          <MenuTrigger
            render={
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-label="Choose reasoning effort"
                disabled={saving}
              >
                <span className="capitalize">{draft.effort ?? DEFAULT_EFFORT}</span>
                <Icons.chevronDown aria-hidden />
              </Button>
            }
          />
          <MenuPopup className="w-44">
            <EffortLevels
              levels={activeEfforts}
              current={draft.effort ?? DEFAULT_EFFORT}
              onPick={(level) => {
                persist({ ...draft, effort: level })
                setEffortOpen(false)
              }}
            />
          </MenuPopup>
        </MenuRoot>
      ) : (
        <div className={bare ? 'flex min-w-0 max-w-40 items-center gap-0.5 sm:max-w-64' : 'flex min-w-0 items-center gap-0.5'}>
          <MenuRoot open={menuOpen} onOpenChange={openMenu}>
            <MenuTrigger
              render={
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  aria-label="Choose a model"
                  disabled={saving || providers.length === 0}
                  // Explicit shrink: the button base sets shrink-0, which
                  // would otherwise fight flex-1 non-deterministically.
                  className="min-w-0 flex-1 shrink"
                >
                  <span className="min-w-0 flex-1 truncate text-left">{triggerLabel}</span>
                  {triggerEffort ? (
                    <Caption as="span" className="shrink-0 capitalize">
                      {triggerEffort}
                    </Caption>
                  ) : null}
                  <Icons.chevronDown aria-hidden className="shrink-0" />
                </Button>
              }
            />
            <MenuPopup className="flex max-h-80 w-80 flex-col overflow-hidden p-0">
              <div className="border-b border-border-subtle p-2">
                <Input
                  aria-label="Search models"
                  value={query}
                  placeholder="Search models"
                  onChange={(event) => setQuery(event.target.value)}
                  onKeyDown={onSearchKeyDown}
                  className="h-8 text-ui"
                />
              </div>
              <div className="scroll-slim min-h-0 flex-1 overflow-y-auto p-1">
                {visibleProviders.length === 0 ? (
                  <p className="px-2 py-4 text-center text-ui text-muted-foreground">
                    No models match this search.
                  </p>
                ) : (
                  visibleProviders.map((entry) => (
                    <MenuGroup key={entry.name}>
                      <div className="flex items-baseline justify-between gap-2">
                        <MenuLabel>{providerLabel(entry.name)}</MenuLabel>
                        {!entry.hasKey ? (
                          <Caption as="span" className="shrink-0 px-2">
                            No key
                          </Caption>
                        ) : null}
                      </div>
                      {matches(entry).map((model) => {
                        const selected = entry.name === draft.provider && model.model === draft.model
                        const hasDepths = model.efforts.length > 0
                        if (!hasDepths) {
                          return (
                            <MenuRadioGroup
                              key={model.model}
                              value={selected ? model.model : ''}
                              onValueChange={() => {
                                persist({
                                  provider: entry.name,
                                  model: model.model,
                                  reasoning: model.reasoning === 'native',
                                  ...(draft.effort === undefined ? {} : { effort: draft.effort }),
                                })
                                setMenuOpen(false)
                              }}
                            >
                              <MenuRadioItem value={model.model}>
                                <span className="min-w-0 flex-1 truncate">{model.displayName}</span>
                                {model.reasoning === 'native' ? (
                                  <Caption as="span" className="shrink-0">
                                    Thinking
                                  </Caption>
                                ) : null}
                              </MenuRadioItem>
                            </MenuRadioGroup>
                          )
                        }
                        const currentLevel = selected ? (draft.effort ?? DEFAULT_EFFORT) : DEFAULT_EFFORT
                        return (
                          <MenuSubmenuRoot key={model.model}>
                            <MenuSubmenuTrigger className="pl-8">
                              <span className="min-w-0 flex-1 truncate">{model.displayName}</span>
                              {selected ? (
                                <span className="flex shrink-0 items-center gap-1 text-muted-foreground">
                                  <Icons.approve aria-hidden className="size-4 text-primary-text" />
                                  <Caption as="span" className="capitalize">
                                    {currentLevel}
                                  </Caption>
                                </span>
                              ) : model.reasoning === 'native' ? (
                                <Caption as="span" className="shrink-0">
                                  Thinking
                                </Caption>
                              ) : null}
                              <Icons.chevronRight aria-hidden className="size-4 text-muted-foreground" />
                            </MenuSubmenuTrigger>
                            <MenuSubmenuPopup className="w-44">
                              <MenuGroup>
                                <MenuLabel>Effort</MenuLabel>
                                <EffortLevels
                                  levels={model.efforts}
                                  current={currentLevel}
                                  onPick={(level) => {
                                    persist({
                                      provider: entry.name,
                                      model: model.model,
                                      reasoning: model.reasoning === 'native',
                                      effort: level,
                                    })
                                    setMenuOpen(false)
                                  }}
                                />
                              </MenuGroup>
                            </MenuSubmenuPopup>
                          </MenuSubmenuRoot>
                        )
                      })}
                    </MenuGroup>
                  ))
                )}
              </div>
              {showThinking || !canReason ? (
                <>
                  <MenuSeparator />
                  <div className="flex items-center gap-2 p-2">
                    <SwitchRoot
                      checked={canReason && draft.reasoning}
                      disabled={!canReason || saving}
                      onCheckedChange={(checked) =>
                        persist({ provider: draft.provider, model: draft.model, reasoning: checked })
                      }
                      aria-label="Reasoning"
                    />
                    <span className="text-ui" aria-hidden>
                      Reasoning
                    </span>
                    {!canReason ? (
                      <Caption as="span" className="ml-auto">
                        Not on this model
                      </Caption>
                    ) : null}
                  </div>
                </>
              ) : null}
            </MenuPopup>
          </MenuRoot>
          {!showEffort && draft.reasoning && canReason && !bare ? (
            <Caption as="span" className="shrink-0 px-1">
              Thinking
            </Caption>
          ) : null}
          {saving ? (
            <Caption as="span" role="status" className="shrink-0 pr-1">
              Saving
            </Caption>
          ) : null}
          {unconfigured ? (
            <Caption as="span" className="shrink-0 pr-1">
              No key
            </Caption>
          ) : null}
        </div>
      )}
      {saveError ? (
        <p role="alert" className="mt-1 text-xs text-danger">
          {saveError}
        </p>
      ) : null}
    </div>
  )
}
