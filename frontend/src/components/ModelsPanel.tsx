// Models tab: provider catalog plus the per-session model binding. Every
// row comes from the backend: GET /v1/providers for the catalog (key
// presence only, never key material) and the session read/write pair for
// the binding. No fixtures, no guessed models.
import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowLeft } from 'lucide-react'
import {
  getSession,
  listProviders,
  listSessions,
  setSessionModel,
  apiErrorStatus,
  StagingApiError,
  type ProviderEntry,
  type Session,
  type SessionModelSelection,
  type StagingConfig,
} from '../data/staging-api'
import { DeniedNotice, PanelError, SkeletonRows, UnavailableNotice } from './research-parts'
import { StatusPill } from './StatusPill'
import { Button } from './ui/button'

type LoadStatus = 'loading' | 'ready' | 'error' | 'denied' | 'offline'

function statusOf(error: unknown): LoadStatus {
  return apiErrorStatus(error)
}

/** Provider ids stay server spellings on the wire; the card shows the
 * plain-language label. */
export function providerLabel(name: string): string {
  if (name === 'meta') return 'Meta'
  return name
}

function saveErrorOf(error: unknown): string {
  if (error instanceof StagingApiError && error.status === 400) {
    return 'That model is not selectable for this provider. Pick another model and try again.'
  }
  if (error instanceof StagingApiError && error.status === 404) {
    return 'This session no longer exists. Pick another session.'
  }
  if (
    error instanceof StagingApiError &&
    (error.status === 401 || error.status === 403)
  ) {
    return 'This key cannot change models. Ask an admin for access, or check the API key.'
  }
  return 'The model did not save. Check your connection and try again.'
}

// One provider card: key state, model picker, reasoning control, and the
// save that binds the selection to the active session. The reasoning
// checkbox stays visible but disabled where the selected model has no
// reasoning capability, so the choice is prevented, not just explained.
// Models with listed depths (Meta effort) show an effort picker instead
// of the on/off checkbox, since their thinking is mandatory.
function ProviderCard({
  entry,
  isDefault,
  modelId,
  reasoning,
  effort,
  saving,
  saveError,
  onModel,
  onReasoning,
  onEffort,
  onSave,
}: {
  entry: ProviderEntry
  isDefault: boolean
  modelId: string
  reasoning: boolean
  effort?: string
  saving: boolean
  saveError: string | null
  onModel: (model: string) => void
  onReasoning: (value: boolean) => void
  onEffort: (value: string) => void
  onSave: () => void
}) {
  const selected = entry.models.find((model) => model.model === modelId)
  const canReason = selected?.reasoning === 'native'
  const listedEfforts = selected?.efforts ?? []
  const modelInputId = `models-model-${entry.name}`
  const reasoningInputId = `models-reasoning-${entry.name}`
  const effortInputId = `models-effort-${entry.name}`
  return (
    <li className="flex flex-col gap-3 rounded-xl border border-border bg-background px-4 py-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <p className="min-w-0 flex-1 text-sm font-medium">{providerLabel(entry.name)}</p>
        {isDefault ? (
          <span className="inline-flex h-6 shrink-0 cursor-default items-center rounded-full border border-border px-2.5 text-xs select-none">
            Server default
          </span>
        ) : null}
        <StatusPill tone={entry.hasKey ? 'ok' : 'idle'} label={entry.hasKey ? 'Live' : 'Unconfigured'} />
      </div>
      <p className="text-xs text-muted-foreground">
        {entry.hasKey
          ? `Key configured. Default model: ${entry.defaultModel}.`
          : 'No API key configured for this provider. Selections still save.'}
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor={modelInputId} className="mb-1 block text-sm font-medium">
            Model
          </label>
          <select
            id={modelInputId}
            value={modelId}
            disabled={saving || entry.models.length === 0}
            onChange={(event) => onModel(event.target.value)}
            className="h-9 w-full cursor-pointer rounded-lg border border-border bg-background px-2.5 text-sm disabled:pointer-events-none disabled:opacity-50"
          >
            {entry.models.map((model) => (
              <option key={`${model.model}-${model.displayName}`} value={model.model}>
                {model.displayName}
              </option>
            ))}
          </select>
        </div>
        {listedEfforts.length > 0 ? (
          <div>
            <label htmlFor={effortInputId} className="mb-1 block text-sm font-medium">
              Effort
            </label>
            <select
              id={effortInputId}
              value={effort && listedEfforts.includes(effort) ? effort : 'high'}
              disabled={saving}
              onChange={(event) => onEffort(event.target.value)}
              className="h-9 w-full cursor-pointer rounded-lg border border-border bg-background px-2.5 text-sm capitalize disabled:pointer-events-none disabled:opacity-50"
            >
              {listedEfforts.map((level) => (
                <option key={level} value={level}>
                  {level}
                </option>
              ))}
            </select>
          </div>
        ) : (
          <div>
            <label
              htmlFor={reasoningInputId}
              className={`mb-1 block text-sm font-medium ${canReason ? '' : 'text-muted-foreground'}`}
            >
              Reasoning
            </label>
            <div className="flex h-9 items-center gap-2">
              <input
                id={reasoningInputId}
                type="checkbox"
                checked={canReason && reasoning}
                disabled={!canReason || saving}
                onChange={(event) => onReasoning(event.target.checked)}
                className="size-4 shrink-0 cursor-pointer disabled:pointer-events-none"
              />
              <span className="text-xs text-muted-foreground">
                {canReason
                  ? 'Reason before answering.'
                  : 'Not available on this model.'}
              </span>
            </div>
          </div>
        )}
      </div>
      {saveError ? (
        <p role="alert" className="text-sm text-muted-foreground">
          {saveError}
        </p>
      ) : null}
      <div className="mt-auto flex justify-end">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={saving || entry.models.length === 0}
          onClick={onSave}
        >
          {saving ? 'Saving' : 'Save to session'}
        </Button>
      </div>
    </li>
  )
}

export function ModelsPanel({
  config,
  onBack,
}: {
  /** Null until the staging flag carries credentials: the catalog and
   * the binding are backend-only, so without a config the view explains
   * instead of inventing providers. */
  config: StagingConfig | null
  onBack: () => void
}) {
  const [status, setStatus] = useState<LoadStatus>(() => (config ? 'loading' : 'ready'))
  const [sessions, setSessions] = useState<Session[]>([])
  const [providers, setProviders] = useState<ProviderEntry[]>([])
  const [defaultProvider, setDefaultProvider] = useState('')
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)
  const [binding, setBinding] = useState<SessionModelSelection | null>(null)
  const [boundFor, setBoundFor] = useState<string | null>(null)
  const [bindingFailed, setBindingFailed] = useState(false)
  const [drafts, setDrafts] = useState<Record<string, { model: string; reasoning: boolean; effort?: string }>>({})
  const [saving, setSaving] = useState<string | null>(null)
  const [saveErrors, setSaveErrors] = useState<Record<string, string | null>>({})
  const [attempt, setAttempt] = useState(0)
  const [bindingAttempt, setBindingAttempt] = useState(0)
  // A save that lands after its session read started leaves fresher
  // state than the read; the read then stays out of the way.
  const saveEpoch = useRef(0)

  // Catalog fetch with no synchronous state writes, so the effect below
  // only subscribes. Retries set the loading state from their own event
  // handlers instead.
  const fetchCatalog = useCallback(() => {
    if (!config) return undefined
    let live = true
    Promise.all([listSessions(config), listProviders(config)])
      .then(([rows, catalog]) => {
        if (!live) return
        setSessions(rows)
        setProviders(catalog.providers)
        setDefaultProvider(catalog.defaultProvider)
        setDrafts(
          Object.fromEntries(
            catalog.providers.map((entry) => [
              entry.name,
              { model: entry.defaultModel, reasoning: entry.models.find((model) => model.model === entry.defaultModel)?.reasoning === 'native', effort: 'high' },
            ]),
          ),
        )
        setActiveSessionId((current) => {
          if (current && rows.some((row) => row.id === current)) return current
          return rows[0]?.id ?? null
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

  function retryCatalog() {
    setStatus('loading')
    setAttempt((value) => value + 1)
  }

  // The binding follows the active session: the session read carries the
  // latest stored selection, absent until PATCH sets one. The banner
  // renders from boundFor, so a session switch shows a loading line until
  // its own read lands instead of the previous session's binding.
  useEffect(() => {
    if (!config || !activeSessionId) return undefined
    let live = true
    const epoch = saveEpoch.current
    getSession(config, activeSessionId)
      .then((session) => {
        if (!live) return
        if (epoch !== saveEpoch.current) return
        setBinding(session.model ?? null)
        setBoundFor(activeSessionId)
        setBindingFailed(false)
        const stored = session.model
        if (stored) {
          setDrafts((current) => ({
            ...current,
            [stored.provider]: {
              model: stored.model,
              reasoning: stored.reasoning,
              ...(stored.effort === undefined ? {} : { effort: stored.effort }),
            },
          }))
        }
      })
      .catch(() => {
        if (!live) return
        setBindingFailed(true)
      })
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config?.baseUrl, config?.apiKey, activeSessionId, bindingAttempt])

  function retryBinding() {
    setBindingFailed(false)
    setBindingAttempt((value) => value + 1)
  }

  function save(entry: ProviderEntry) {
    if (!config || !activeSessionId || saving) return
    const draft = drafts[entry.name] ?? { model: entry.defaultModel, reasoning: true, effort: 'high' }
    const selected = entry.models.find((model) => model.model === draft.model)
    const listed = selected?.efforts ?? []
    const effort =
      listed.length === 0
        ? undefined
        : draft.effort && listed.includes(draft.effort)
          ? draft.effort
          : 'high'
    setSaving(entry.name)
    setSaveErrors((current) => ({ ...current, [entry.name]: null }))
    setSessionModel(config, activeSessionId, {
      provider: entry.name,
      model: draft.model,
      reasoning: selected?.reasoning === 'native' ? draft.reasoning : false,
      ...(effort === undefined ? {} : { effort }),
    })
      .then((stored) => {
        saveEpoch.current += 1
        setBinding(stored)
        setBoundFor(activeSessionId)
        setBindingFailed(false)
        setDrafts((current) => ({
          ...current,
          [stored.provider]: {
            model: stored.model,
            reasoning: stored.reasoning,
            ...(stored.effort === undefined ? {} : { effort: stored.effort }),
          },
        }))
      })
      .catch((error: unknown) => {
        setSaveErrors((current) => ({ ...current, [entry.name]: saveErrorOf(error) }))
      })
      .finally(() => {
        setSaving(null)
      })
  }

  const activeSession = sessions.find((session) => session.id === activeSessionId) ?? null
  const defaultEntry = providers.find((entry) => entry.name === defaultProvider)
  const bindingText = !activeSession
    ? null
    : binding
      ? `${activeSession.title} uses ${providerLabel(binding.provider)} ${binding.model}, reasoning ${binding.reasoning ? 'on' : 'off'}${binding.effort === undefined ? '' : `, effort ${binding.effort}`}.`
      : defaultEntry
        ? `${activeSession.title} uses default ${providerLabel(defaultEntry.name)} ${defaultEntry.defaultModel}, effort high.`
        : `${activeSession.title} has no configured model.`

  return (
    <div className="space-y-6">
      <Button type="button" variant="ghost" size="sm" onClick={onBack}>
        <ArrowLeft className="size-4" aria-hidden />
        Back to Overview
      </Button>
      <section
        aria-label="Models"
        className="rounded-xl border border-border bg-background px-4 py-3"
      >
        {!config ? (
          <div className="rounded-lg border border-dashed border-border p-4">
            <p className="text-sm font-medium">Models need a backend connection.</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Set the staging API URL and key, then reload.
            </p>
          </div>
        ) : status === 'loading' ? (
          <SkeletonRows label="Models are loading" />
        ) : status === 'error' ? (
          <PanelError
            heading="Models did not load."
            detail="Check your connection and try again."
            onRetry={retryCatalog}
          />
        ) : status === 'denied' ? (
          <DeniedNotice heading="Models are not shared with this key." />
        ) : status === 'offline' ? (
          <UnavailableNotice onRetry={retryCatalog} />
        ) : (
          <div className="space-y-4">
            <div className="max-w-sm">
              <label htmlFor="models-session" className="mb-1 block text-sm font-medium">
                Session
              </label>
              {sessions.length === 0 ? (
                <div className="rounded-lg border border-dashed border-border p-4">
                  <p className="text-sm text-muted-foreground">
                    No sessions yet. Start one from chat to bind a model.
                  </p>
                </div>
              ) : (
                <select
                  id="models-session"
                  value={activeSessionId ?? ''}
                  onChange={(event) => setActiveSessionId(event.target.value || null)}
                  className="h-9 w-full cursor-pointer rounded-lg border border-border bg-background px-2.5 text-sm"
                >
                  {sessions.map((session) => (
                    <option key={session.id} value={session.id}>
                      {session.title}
                    </option>
                  ))}
                </select>
              )}
            </div>
            {activeSession ? (
              <div className="rounded-lg border border-border p-4">
                {bindingFailed && boundFor !== activeSessionId ? (
                  <div className="flex flex-wrap items-center gap-3">
                    <p className="min-w-0 flex-1 text-sm text-muted-foreground">
                      The current model did not load.
                    </p>
                    <Button type="button" variant="outline" size="sm" onClick={retryBinding}>
                      Try again
                    </Button>
                  </div>
                ) : boundFor !== activeSessionId ? (
                  <p role="status" className="text-sm text-muted-foreground">
                    Loading the current model.
                  </p>
                ) : (
                  <p aria-live="polite" className="text-sm">
                    {bindingText}
                  </p>
                )}
              </div>
            ) : null}
            {providers.length === 0 ? (
              <div className="rounded-lg border border-dashed border-border p-4">
                <p className="text-sm text-muted-foreground">
                  No providers listed. The catalog is empty on the server.
                </p>
              </div>
            ) : (
              <ul className="grid gap-3 lg:grid-cols-2">
                {providers.map((entry) => {
                  const draft = drafts[entry.name] ?? {
                    model: entry.defaultModel,
                    reasoning: false,
                  }
                  return (
                    <ProviderCard
                      key={entry.name}
                      entry={entry}
                      isDefault={defaultProvider === entry.name}
                      modelId={draft.model}
                      reasoning={draft.reasoning}
                      effort={draft.effort}
                      saving={saving === entry.name}
                      saveError={saveErrors[entry.name] ?? null}
                      onModel={(model) =>
                        setDrafts((current) => ({
                          ...current,
                          [entry.name]: {
                            model,
                            reasoning: current[entry.name]?.reasoning ?? false,
                            ...(current[entry.name]?.effort === undefined
                              ? {}
                              : { effort: current[entry.name]?.effort }),
                          },
                        }))
                      }
                      onReasoning={(value) =>
                        setDrafts((current) => ({
                          ...current,
                          [entry.name]: {
                            model: current[entry.name]?.model ?? entry.defaultModel,
                            reasoning: value,
                            ...(current[entry.name]?.effort === undefined
                              ? {}
                              : { effort: current[entry.name]?.effort }),
                          },
                        }))
                      }
                      onEffort={(value) =>
                        setDrafts((current) => ({
                          ...current,
                          [entry.name]: {
                            model: current[entry.name]?.model ?? entry.defaultModel,
                            reasoning: current[entry.name]?.reasoning ?? false,
                            effort: value,
                          },
                        }))
                      }
                      onSave={() => save(entry)}
                    />
                  )
                })}
              </ul>
            )}
          </div>
        )}
      </section>
    </div>
  )
}
