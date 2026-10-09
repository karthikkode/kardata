// Model API: provider catalog and per-session model selection.
import { z } from 'zod'
import { request, StagingApiError, type StagingConfig } from './client'

/** Per-session provider+model selection. Mirrors the OpenAPI
 * SessionModel: absent until PATCH sets one. */
export const SessionModelSelection = z.object({
  provider: z.literal('meta'),
  model: z.string().min(1),
  reasoning: z.boolean(),
  effort: z.string().min(1).optional(),
})

export type SessionModelSelection = z.infer<typeof SessionModelSelection>

/** One selectable model with its reasoning capability. Mirrors the
 * OpenAPI ProviderModel. */
const ProviderModelSchema = z.object({
  provider: z.literal('meta'),
  model: z.string().min(1),
  displayName: z.string().min(1),
  reasoning: z.enum(['native', 'none']),
  mode: z.enum(['chat', 'responses']).optional(),
  /** Selectable reasoning depths; empty means no depth control. */
  efforts: z.array(z.string().min(1)).default([]),
})

/** One provider row: key presence only, never key material. Mirrors the
 * OpenAPI ProviderEntry. */
const ProviderEntrySchema = z.object({
  name: z.literal('meta'),
  hasKey: z.boolean(),
  defaultModel: z.string().min(1),
  models: z.array(ProviderModelSchema),
})

export type ProviderEntry = z.infer<typeof ProviderEntrySchema>

/** Provider catalog envelope data. Mirrors the OpenAPI ProviderCatalog. */
const ProviderCatalogSchema = z.object({
  defaultProvider: z.literal('meta'),
  providers: z.array(ProviderEntrySchema),
})

export type ProviderCatalog = z.infer<typeof ProviderCatalogSchema>

/** Outgoing session-model write. Reasoning is optional on the wire;
 * the server defaults it to false. Effort must be listed in the model's
 * efforts or the server rejects it. */
export const SetSessionModelInput = z.object({
  provider: z.literal('meta'),
  model: z.string().min(1),
  reasoning: z.boolean().optional(),
  effort: z.string().min(1).optional(),
})

export type SetSessionModelInput = z.infer<typeof SetSessionModelInput>

/** Provider catalog with reasoning flags and key-presence booleans
 * only. Response validates against ProviderCatalogSchema. */
export async function listProviders(config: StagingConfig): Promise<ProviderCatalog> {
  const data = await request<unknown>(config, 'GET', '/v1/providers')
  const parsed = ProviderCatalogSchema.safeParse(data)
  if (!parsed.success) {
    throw new StagingApiError(200, 'invalid_response', 'provider catalog did not validate')
  }
  return parsed.data
}

/** Store the session provider+model (operator+). Input validates
 * client-side first; the stored selection validates on the way back. */
export async function setSessionModel(
  config: StagingConfig,
  sessionId: string,
  input: SetSessionModelInput,
): Promise<SessionModelSelection> {
  const body = SetSessionModelInput.parse(input)
  const data = await request<unknown>(
    config,
    'PATCH',
    `/v1/sessions/${encodeURIComponent(sessionId)}/model`,
    body,
  )
  const parsed = SessionModelSelection.safeParse(data)
  if (!parsed.success) {
    throw new StagingApiError(200, 'invalid_response', 'stored session model did not validate')
  }
  return parsed.data
}
