// Verified Meta capability profiles. /v1/models decides live availability;
// these entries supply effort and wire metadata absent from that endpoint.
// No keys or network: this module is pure data.
export type RegistryProvider = 'meta'

export type ReasoningCapability = 'native' | 'none'

export interface ModelEntry {
  provider: RegistryProvider
  /** Model id as sent on the wire (and as stored on the session). */
  model: string
  /** Human label for the providers catalog. */
  displayName: string
  /** 'native' means the provider reasons without prompt scaffolding. */
  reasoning: ReasoningCapability
  /** Meta serves Chat and Responses wires. */
  mode?: 'chat' | 'responses'
  /** Selectable reasoning depths, live-verified per model (Meta
   * reasoning_effort). Empty means the model offers no depth control:
   * callers must not invent levels. */
  efforts: string[]
}

/** Chosen product default for reasoning-capable models. */
export const DEFAULT_EFFORT = 'high'

const META_DEFAULT_MODEL = 'muse-spark-1.3-contributor'

/** Meta ids are the provider's own GET /v1/models listing (live-verified
 * 2026-09-26); display names stay the exact wire ids, never invented
 * labels. Reasoning 'native' only where live usage showed reasoning
 * tokens. Transcription and SAM image models are not chat models and stay
 * out even when `/models` lists them. */
const META_EFFORTS = ['minimal', 'low', 'medium', 'high', 'xhigh']

const CATALOG: ModelEntry[] = [
  {
    provider: 'meta',
    model: 'muse-spark-1.3-contributor',
    displayName: 'muse-spark-1.3-contributor',
    reasoning: 'native',
    mode: 'responses',
    efforts: META_EFFORTS,
  },
  {
    provider: 'meta',
    model: 'muse-spark-1.3',
    displayName: 'muse-spark-1.3',
    reasoning: 'native',
    mode: 'responses',
    efforts: META_EFFORTS,
  },
  {
    provider: 'meta',
    model: 'muse-spark-1.2',
    displayName: 'muse-spark-1.2',
    reasoning: 'native',
    mode: 'chat',
    efforts: META_EFFORTS,
  },
  {
    provider: 'meta',
    model: 'muse-spark-1.2-contributor',
    displayName: 'muse-spark-1.2-contributor',
    reasoning: 'none',
    mode: 'chat',
    efforts: [],
  },
  {
    provider: 'meta',
    model: 'muse-spark-1.1',
    displayName: 'muse-spark-1.1',
    reasoning: 'native',
    mode: 'chat',
    efforts: META_EFFORTS,
  },
]

/** Minimal env surface so tests inject doubles instead of mutating env. */
export interface RegistryEnv {
  KARDATA_META_MODEL?: string
  KARDATA_META_MODE?: string
}

function optional(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed ? trimmed : undefined
}

/** Configured model id for a provider: env override, else live default. */
export function defaultModelFor(provider: RegistryProvider, env: RegistryEnv = process.env): string {
  void provider
  return optional(env.KARDATA_META_MODEL) ?? META_DEFAULT_MODEL
}

/** Every catalog entry, in display order. */
export function listModels(): ModelEntry[] {
  return CATALOG.map((entry) => ({ ...entry }))
}

/** Models served by one provider, in display order. */
export function modelsFor(provider: RegistryProvider): ModelEntry[] {
  return listModels().filter((entry) => entry.provider === provider)
}

/** Catalog lookup: only verified profiles are selectable. */
export function findModel(
  provider: string,
  model: string,
  _env: RegistryEnv = process.env,
): ModelEntry | undefined {
  const direct = CATALOG.find((entry) => entry.provider === provider && entry.model === model)
  if (direct) return { ...direct }
  return undefined
}

/** True when the provider/model pair is selectable. */
export function isKnownModel(provider: string, model: string, env: RegistryEnv = process.env): boolean {
  return findModel(provider, model, env) !== undefined
}

/** True when the depth is listed for the model. Unknown models and models
 * without depth control reject every effort. */
export function isKnownEffort(
  provider: string,
  model: string,
  effort: string,
  env: RegistryEnv = process.env,
): boolean {
  const entry = findModel(provider, model, env)
  return entry !== undefined && entry.efforts.includes(effort)
}
