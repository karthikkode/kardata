// Live provider probes. T10.4. Opt-in: every live case skips unless its key
// is present (agents/.env or environment). Never logs key material: findings
// are shapes and counters only.
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { applyDotEnv, parseDotEnv, readLiveConfig } from './config.js'
import { MetaAdapter } from './meta.js'
import type { ProviderRequest, ProviderResponse } from './providers.js'

try {
  const envPath = join(dirname(fileURLToPath(import.meta.url)), '..', '.env')
  applyDotEnv(readFileSync(envPath, 'utf8'))
} catch {
  // No local .env: environment variables still apply.
}

const config = readLiveConfig()
const LIVE_TIMEOUT_MS = 120_000

describe('parseDotEnv', () => {
  it('parses values, strips quotes, skips comments, keeps env wins', () => {
    const parsed = parseDotEnv('# comment\nA=1\nB="two"\nC=\'three\'\nBAD LINE\n1X=y\n')
    expect(parsed).toEqual({ A: '1', B: 'two', C: 'three' })
    process.env['KARDATA_PROBE_SENTINEL'] = 'env'
    applyDotEnv('KARDATA_PROBE_SENTINEL=file\nKARDATA_PROBE_NEW=file')
    expect(process.env['KARDATA_PROBE_SENTINEL']).toBe('env')
    expect(process.env['KARDATA_PROBE_NEW']).toBe('file')
    delete process.env['KARDATA_PROBE_SENTINEL']
    delete process.env['KARDATA_PROBE_NEW']
  })
})

async function probeRoundTrip(
  chat: (request: ProviderRequest) => Promise<ProviderResponse>,
  label: string,
  toolChoice: ProviderRequest['toolChoice'] = { mode: 'required' },
): Promise<void> {
  const started = Date.now()
  const response = await chat({
    systemPrompt: 'You are a probe harness. Follow tool instructions exactly.',
    messages: [{ role: 'user', text: 'Call the ping tool with text hello. You must call it.' }],
    tools: [
      {
        name: 'ping',
        description: 'Reply with the given text.',
        parameters: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
      },
    ],
    toolChoice,
  })
  const latencyMs = Date.now() - started
  // Findings, not secrets: shapes and counters.
  console.log(
    `[probe:${label}] latencyMs=${latencyMs} toolCalls=${response.toolCalls.length} usage=${JSON.stringify(response.usage)}`,
  )
  expect(response.toolCalls.length).toBeGreaterThan(0)
  expect(response.toolCalls[0]?.name).toBe('ping')
  expect(response.usage.inputTokens).toBeGreaterThan(0)
}

describe.skipIf(!config.metaApiKey)('live meta', () => {
  it(
    'round-trips a forced tool call and reports usage',
    async () => {
      const adapter = new MetaAdapter({
        apiKey: config.metaApiKey as string,
        model: config.metaModel,
        mode: config.metaMode,
        baseUrl: config.metaBaseUrl,
      })
      // Meta Chat wire supports only auto: the adapter clamps, the prompt insists.
      await probeRoundTrip((request) => adapter.chat(request), 'meta', { mode: 'auto' })
    },
    LIVE_TIMEOUT_MS,
  )
  it('reports live text and reasoning stream shapes without logging content', async () => {
    const adapter = new MetaAdapter({
      apiKey: config.metaApiKey as string,
      model: config.metaModel,
      mode: config.metaMode,
      baseUrl: config.metaBaseUrl,
    })
    const started = Date.now()
    let firstDeltaMs: number | undefined
    let textDeltas = 0
    let reasoningDeltas = 0
    let finished = false
    for await (const event of adapter.chatStream({
      systemPrompt: 'Answer plainly.',
      messages: [{ role: 'user', text: 'Give three brief sentences about why a research assistant should cite sources.' }],
      tools: [],
      toolChoice: { mode: 'auto' },
    })) {
      if (event.kind === 'text_delta') {
        firstDeltaMs ??= Date.now() - started
        textDeltas += 1
      }
      if (event.kind === 'reasoning_delta') reasoningDeltas += 1
      if (event.kind === 'done') finished = true
    }
    console.log(`[probe:meta-stream] firstDeltaMs=${firstDeltaMs ?? -1} totalMs=${Date.now() - started} textDeltas=${textDeltas} reasoningDeltas=${reasoningDeltas}`)
    expect(textDeltas).toBeGreaterThan(0)
    expect(finished).toBe(true)
  }, LIVE_TIMEOUT_MS)
})
