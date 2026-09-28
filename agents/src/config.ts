// Live provider configuration from environment only. T10.4. Keys never
// appear in code, logs, transcripts, or fixtures: adapters receive them as
// constructor parameters, and this module is the only reader of key material.
export interface LiveProviderConfig {
  metaApiKey?: string
  metaModel: string
  metaMode: 'chat' | 'responses'
  metaBaseUrl: string
}

function optional(name: string): string | undefined {
  const value = process.env[name]?.trim()
  return value ? value : undefined
}

export function readLiveConfig(): LiveProviderConfig {
  const metaMode = process.env['KARDATA_META_MODE']
  return {
    metaApiKey: optional('KARDATA_META_KEY'),
    metaModel: process.env['KARDATA_META_MODEL']?.trim() || 'muse-spark-1.3-contributor',
    metaMode: metaMode === 'responses' ? 'responses' : 'chat',
    metaBaseUrl: process.env['KARDATA_META_BASE']?.trim() || 'https://api.meta.ai/v1',
  }
}

// Minimal .env parser (KEY=value, # comments, blank lines, single/double
// quotes stripped). Never overrides an already-set variable: real environment
// always wins over the file.
export function parseDotEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const equals = trimmed.indexOf('=')
    if (equals <= 0) continue
    const key = trimmed.slice(0, equals).trim()
    let value = trimmed.slice(equals + 1).trim()
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1)
    }
    if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) out[key] = value
  }
  return out
}

export function applyDotEnv(text: string): void {
  for (const [key, value] of Object.entries(parseDotEnv(text))) {
    if (process.env[key] === undefined) process.env[key] = value
  }
}
