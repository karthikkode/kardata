// Models tab: provider catalog plus the per-session model binding. Every
// row comes from the backend: GET /v1/providers for the catalog (key
// presence only, never key material) and the session read/write pair for
// the binding. No fixtures, no guessed models.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Icons } from '@/lib/icons'
import { humanizeKey } from '@/lib/format'
import { notify } from '@/lib/toast'
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
import { DeniedNotice, PanelError, UnavailableNotice } from './research-parts'
import { BodySm, Caption, CardTitle } from './text'
import { Button } from './ui/button'
import { FieldDescription, FieldLabel, FieldRoot } from './ui/field'
import { SelectItem, SelectPopup, SelectRoot, SelectTrigger } from './ui/select'
import { Skeleton } from './ui/skeleton'
import { SwitchRoot } from './ui/switch'

type LoadStatus = 'loading' | 'ready' | 'error' | 'denied' | 'offline'

function statusOf(error: unknown): LoadStatus {
  return apiErrorStatus(error)
}

/** Provider ids stay server spellings on the wire; the card shows the
 * plain-language label, humanized when the provider is unknown. */
export function providerLabel(name: string): string {
  if (name === 'meta') return 'Meta'
  return humanizeKey(name)
}

/** Display name from the catalog; the model id when the catalog lacks it. */
function modelDisplayName(providers: ProviderEntry[], provider: string, model: string): string {
  return providers.find((entry) => entry.name === provider)?.models.find((candidate) => candidate.model === model)?.displayName ?? model
}

function effortLabel(effort: string): string {
  return `${effort.charAt(0).toUpperCase()}${effort.slice(1)} effort`
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
// switch stays visible but disabled where the selected model has no
// reasoning capability, so the choice is prevented, not just explained.
// Models with listed depths (Meta effort) show an effort picker instead
// of the on/off switch, since their thinking is mandatory.
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
  // Stable option identities: the shared Select matches by reference, so
  // the catalogue maps once per model list instead of per render.
  const modelOptions = useMemo(
    () => entry.models.map((model) => ({ value: model.model, label: model.displayName })),
    [entry.models],
  )
  const label = providerLabel(entry.name)
  const initials = label.replace(/[^A-Za-z]/g, '').slice(0, 2).toUpperCase() || '??'
  return (
    <li className="flex flex-col gap-3 rounded-xl border border-border bg-background px-4 py-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span aria-hidden className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-xs font-medium text-muted-foreground">
          {initials}
        </span>
        <CardTitle className="min-w-0 flex-auto">{label}</CardTitle>
        {isDefault ? <Caption as="span" className="shrink-0">Default</Caption> : null}
        <span aria-hidden className={`size-2 shrink-0 rounded-full ${entry.hasKey ? 'bg-success' : 'bg-muted-foreground'}`} />
        <BodySm as="span" className="shrink-0">{entry.hasKey ? 'Key configured' : 'No key'}</BodySm>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <FieldRoot>
          <FieldLabel id={modelInputId}>Model</FieldLabel>
          <SelectRoot
            value={modelOptions.find((option) => option.value === modelId) ?? null}
            onValueChange={(option) => {
              if (option) onModel(option.value)
            }}
            disabled={saving || entry.models.length === 0}
          >
            <SelectTrigger aria-labelledby={modelInputId} />
            <SelectPopup>
              {modelOptions.map((option) => (
                <SelectItem key={option.value} value={option}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectPopup>
          </SelectRoot>
        </FieldRoot>
        {listedEfforts.length > 0 ? (
          <FieldRoot>
            <FieldLabel id={effortInputId}>Effort</FieldLabel>
            <SelectRoot
              value={effort && listedEfforts.includes(effort) ? effort : 'high'}
              onValueChange={(option) => {
                if (option) onEffort(option)
              }}
              disabled={saving}
            >
              <SelectTrigger aria-labelledby={effortInputId} className="capitalize" />
              <SelectPopup>
                {listedEfforts.map((level) => (
                  <SelectItem key={level} value={level}>
                    {level}
                  </SelectItem>
                ))}
              </SelectPopup>
            </SelectRoot>
          </FieldRoot>
        ) : (
          <FieldRoot>
            <FieldLabel id={reasoningInputId} className={canReason ? undefined : 'text-muted-foreground'}>Reasoning</FieldLabel>
            <FieldDescription>
              {canReason
                ? 'Reason before answering.'
                : 'Not available on this model.'}
            </FieldDescription>
            <SwitchRoot
              aria-labelledby={reasoningInputId}
              checked={canReason && reasoning}
              disabled={!canReason || saving}
              onCheckedChange={(checked) => onReasoning(checked === true)}
            />
          </FieldRoot>
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
          variant="primary"
          size="sm"
          disabled={saving || entry.models.length === 0}
          onClick={onSave}
        >
          {saving ? 'Saving…' : 'Save to session'}
        </Button>
      </div>
    </li>
  )
}

export function ModelsPanel({
  config,
}: {
  /** Null until the staging flag carries credentials: the catalog and
   * the binding are backend-only, so without a config the view explains
   * instead of inventing providers. */
  config: StagingConfig | null
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
        notify.success('Saved')
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
      ? `${activeSession.title} uses ${providerLabel(binding.provider)} · ${modelDisplayName(providers, binding.provider, binding.model)} · ${binding.effort === undefined ? `Reasoning ${binding.reasoning ? 'on' : 'off'}` : effortLabel(binding.effort)}`
      : defaultEntry
        ? `${activeSession.title} uses default ${providerLabel(defaultEntry.name)} · ${modelDisplayName(providers, defaultEntry.name, defaultEntry.defaultModel)} · ${effortLabel('high')}`
        : `${activeSession.title} has no configured model.`

  return (
    <div className="space-y-6">
      <section
        aria-label="Models"
        className="rounded-xl border border-border bg-background px-4 py-3"
      >
        {!config ? (
          <div className="rounded-lg border border-border p-4">
            <p className="text-sm font-medium">Models need a backend connection.</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Set the staging API URL and key, then reload.
            </p>
          </div>
        ) : status === 'loading' ? (
          <div role="status" aria-label="Models are loading">
            <span className="sr-only">Loading Models</span>
            <div aria-hidden className="grid gap-3 lg:grid-cols-2">
              {[0, 1].map((tile) => (
                <div key={tile} className="flex flex-col gap-3 rounded-xl border border-border bg-background px-4 py-3">
                  <div className="flex items-center gap-3">
                    <Skeleton className="size-8 rounded-md" />
                    <Skeleton className="h-4 flex-1" />
                    <Skeleton className="h-4 w-16" />
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Skeleton className="h-10" />
                    <Skeleton className="h-10" />
                  </div>
                </div>
              ))}
            </div>
          </div>
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
            <FieldRoot className="max-w-sm">
              <FieldLabel id="models-session-label">Session</FieldLabel>
              {sessions.length === 0 ? (
                <div className="rounded-lg border border-border p-4">
                  <p className="text-sm text-muted-foreground">
                    No sessions yet. Start one from chat to bind a model.
                  </p>
                </div>
              ) : (
                <SelectRoot
                  value={sessions.find((session) => session.id === activeSessionId) ?? null}
                  onValueChange={(option) => {
                    if (option) setActiveSessionId(option.id)
                  }}
                  itemToStringLabel={(option) => option.title}
                  itemToStringValue={(option) => option.id}
                >
                  <SelectTrigger aria-labelledby="models-session-label" />
                  <SelectPopup>
                    {sessions.map((session) => (
                      <SelectItem key={session.id} value={session}>
                        {session.title}
                      </SelectItem>
                    ))}
                  </SelectPopup>
                </SelectRoot>
              )}
            </FieldRoot>
            {activeSession ? (
              <div className="rounded-lg border border-border bg-card p-4">
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
                  <p aria-live="polite" className="flex items-center gap-2">
                    <Icons.models aria-hidden className="size-4 shrink-0 text-muted-foreground" />
                    <BodySm as="span" className="min-w-0 flex-1">{bindingText}</BodySm>
                  </p>
                )}
              </div>
            ) : null}
            {providers.length === 0 ? (
              <div className="rounded-lg border border-border p-4">
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
