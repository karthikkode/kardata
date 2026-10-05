// Log coverage gate (P3.3). Every layer's handler either calls logOp or
// sits behind a logging wrapper: routes behind requestLog + route error
// logging, MCP tools behind the tool.call boundary, activities behind
// withActivityLogging, workflows behind the workflow logger, provider
// rounds behind providerRoundFields, outbox publish behind its logOp.
// Workflows cannot use logOp (sandbox: no node APIs), and rounds fuse
// start+done into one outcome line with latency; both are pinned here as
// the accepted wrapper for their layer.
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { Writable } from 'node:stream'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { createLogger } from '../../backend/src/observability/logging.js'
import { withActivityLogging } from '../../backend/src/observability/temporal-tracing.js'
import { loadRegistry } from '../../scripts/registry-sync.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

function src(path: string): string {
  return readFileSync(join(ROOT, path), 'utf8')
}

function capture(): { lines: Array<Record<string, unknown>>; stream: Writable } {
  const lines: Array<Record<string, unknown>> = []
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      for (const line of String(chunk).split('\n')) {
        if (line.trim()) lines.push(JSON.parse(line) as Record<string, unknown>)
      }
      callback()
    },
  })
  return { lines, stream }
}

describe('log coverage seams (P3.3)', () => {
  it('routes log start, done and error across requestLog + route', () => {
    expect(src('backend/src/observability/requestLog.ts')).toContain('http.request.start')
    expect(src('backend/src/observability/requestLog.ts')).toContain("op: 'http.request'")
    expect(src('backend/src/routes/http.ts')).toContain('http.route.error')
  })

  it('MCP tools run inside the tool.call logOp triple', () => {
    expect(src('backend/src/mcp/tools.ts')).toContain('logOp(')
    expect(src('backend/src/mcp/tools.ts')).toContain("'tool.call'")
  })

  it('activities register behind the withActivityLogging triple', () => {
    expect(src('backend/src/temporal/worker.ts')).toContain('withActivityLogging')
    expect(src('backend/src/observability/temporal-tracing.ts')).toContain('withActivityLogging')
    expect(src('backend/src/observability/temporal-tracing.ts')).toContain('logOp(')
  })

  it('every registry workflow surface uses the workflow logger', () => {
    // Bundles re-export, queue/turn helpers hold no workflow,
    // withPreparedExecution is a shared helper: none own log lines.
    const excluded = new Set([
      'backend/src/temporal/workflows/turn-bundle.ts',
      'backend/src/temporal/workflows/research-bundle.ts',
      'backend/src/temporal/workflows/inbox-queue.ts',
      'backend/src/temporal/workflows/resumable-turn.ts',
      'backend/src/temporal/workflows/epoch-start.ts',
    ])
    for (const file of excluded) {
      expect(() => src(file), `${file} exclusion is current`).not.toThrow()
    }
    const entries = loadRegistry(ROOT) as Array<{ surface: string }>
    const files = [...new Set(entries.map((entry) => entry.surface))]
      .filter((surface) => surface.startsWith('backend/src/temporal/workflows/') && !excluded.has(surface))
    expect(files.length).toBeGreaterThanOrEqual(10)
    const unlogged = files.filter((file) => !/(?<![\w.])log\.(info|warn|error)/.test(src(file)))
    expect(unlogged).toEqual([])
  })

  it('provider rounds, file steps and outbox publish hit their seams', () => {
    const roundFiles = [
      'backend/src/providers/provider-gateway.ts',
      'backend/src/temporal/activities/turn.ts',
      'backend/src/temporal/activities/context-files.ts',
      'backend/src/temporal/activities/file-processing.ts',
      'backend/src/ocr.ts',
    ]
    for (const file of roundFiles) {
      expect(src(file), file).toContain('providerRoundFields')
    }
    expect(src('backend/src/temporal/activities/providers.ts')).toContain('latency_ms')
    expect(src('backend/src/db/file-pipeline.ts')).toContain('logOp(')
    expect(src('backend/src/db/outbox.ts')).toContain("'db.outbox.publish'")
  })

  it('withActivityLogging emits the start/done/error triple and rethrows', async () => {
    const box = capture()
    const logger = createLogger({ op: 'TEST activity' }, box.stream)
    const wrapped = withActivityLogging(logger, {
      ok: async () => 'fine',
      boom: async () => {
        throw new Error('TEST activity failure')
      },
    })
    await expect(wrapped['ok']?.()).resolves.toBe('fine')
    await expect(wrapped['boom']?.()).rejects.toThrow('TEST activity failure')
    const events = box.lines.map((line) => line['event'])
    expect(events).toEqual([
      'activity.ok.start',
      'activity.ok.done',
      'activity.boom.start',
      'activity.boom.error',
    ])
    expect(box.lines[1]).toMatchObject({ op: 'activity.ok', outcome: 'ok', activity: 'ok' })
    expect(box.lines[3]).toMatchObject({ op: 'activity.boom', outcome: 'error', code: 'Error' })
  })
})
