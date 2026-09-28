// Fleet boards + alerts (B5.4). Provisioned Grafana JSON validity (two
// boards, required panels, Loki/Prometheus refs, real metric names), alert
// rule presence with the severity/runbook convention (every runbook anchor
// resolves in docs/runbook.md; backlog pages inside 2 minutes), and the
// fleet gauges on /metrics.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { FastifyInstance } from 'fastify'
import { describe, expect, it } from 'vitest'
import * as yaml from 'yaml'
import { buildApp } from '../../backend/src/app.js'
import {
  CARDINALITY_BUDGET,
  createHttpMetrics,
} from '../../backend/src/observability/metrics.js'
import { FakeRunsGateway } from './fake-gateway.js'

function deployment(...parts: string[]): string {
  return fileURLToPath(new URL(`../../deployment/${parts.join('/')}`, import.meta.url))
}

function docs(...parts: string[]): string {
  return fileURLToPath(new URL(`../../docs/${parts.join('/')}`, import.meta.url))
}

interface Panel {
  id: number
  type: string
  title: string
  datasource?: { type?: string; uid?: string }
  targets?: Array<{ expr?: string }>
}

interface Board {
  uid: string
  title: string
  panels: Panel[]
}

function loadBoard(name: string): Board {
  return JSON.parse(
    readFileSync(deployment('grafana-provisioning', 'dashboards', name), 'utf8'),
  ) as Board
}

function parseDuration(value: unknown): number {
  const match = /^(\d+)(s|m|h)$/.exec(String(value ?? ''))
  if (!match) throw new Error(`unparseable duration ${String(value)}`)
  const amount = Number(match[1])
  const unit = match[2] as string
  return amount * (unit === 'h' ? 3600 : unit === 'm' ? 60 : 1)
}

interface Rule {
  alert: string
  expr: string
  for?: string
  labels?: Record<string, string>
  annotations?: Record<string, string>
}

function loadRules(): Rule[] {
  const document = yaml.parse(
    readFileSync(deployment('prometheus-rules.yaml'), 'utf8'),
  ) as { groups: Array<{ name: string; rules: Rule[] }> }
  return document.groups.flatMap((group) => group.rules)
}

describe('fleet boards and alerts (B5.4)', () => {
  it('provisions two valid boards with required panels', () => {
    for (const [file, uid, required] of [
      ['kardata-fleet.json', 'kardata-fleet', ['Request rate by route', 'Runs by state', 'Stale heartbeats', 'Error logs']],
      ['kardata-runs.json', 'kardata-runs', ['Runs by state', 'Stall sweeps', 'Provider calls', 'Slow pg spans']],
    ] as Array<[string, string, string[]]>) {
      const board = loadBoard(file)
      expect(board.uid).toBe(uid)
      expect(board.panels.length).toBeGreaterThan(0)
      const ids = board.panels.map((panel) => panel.id)
      expect(new Set(ids).size).toBe(ids.length)
      for (const panel of board.panels) {
        expect(panel.title.length).toBeGreaterThan(0)
        expect(panel.targets?.length ?? 0).toBeGreaterThan(0)
        expect(['prometheus', 'loki']).toContain(panel.datasource?.uid)
        for (const target of panel.targets ?? []) {
          expect(target.expr?.length ?? 0).toBeGreaterThan(0)
        }
      }
      const titles = board.panels.map((panel) => panel.title)
      for (const title of required) expect(titles).toContain(title)
    }
  })

  it('references only shipped metrics and provisioned datasources', () => {
    const exprs = ['kardata-fleet.json', 'kardata-runs.json']
      .flatMap((file) => loadBoard(file).panels)
      .flatMap((panel) => panel.targets ?? [])
      .map((target) => target.expr ?? '');
    const text = exprs.join('\n')
    for (const metric of [
      'http_requests_total',
      'http_request_duration_seconds_bucket',
      'kardata_runs_by_state',
      'kardata_stale_heartbeats',
      'kardata_pg_pool_waiting',
    ]) {
      expect(text).toContain(metric)
    }
    // No concrete ids or secrets leak into a provisioned query.
    expect(text).not.toMatch(/s-[0-9a-f-]{8,}/)
  })

  it('defines the alert set with severity, runbook, and firing bounds', () => {
    const rules = loadRules();
    const names = rules.map((rule) => rule.alert);
    for (const name of [
      'KardataBackendDown',
      'KardataHighErrorRate',
      'KardataLatencyP99',
      'KardataRateLimitSpike',
      'KardataStaleHeartbeats',
      'KardataBacklog',
      'KardataPoolExhaustion',
    ]) {
      expect(names).toContain(name)
    }
    const runbook = readFileSync(docs('runbook.md'), 'utf8')
    for (const rule of rules) {
      expect(rule.alert).toMatch(/^Kardata[A-Z]/)
      expect(['page', 'ticket']).toContain(rule.labels?.['severity'])
      const pointer = rule.annotations?.['runbook'] ?? ''
      expect(pointer).toMatch(/^docs\/runbook\.md#/)
      const anchor = pointer.split('#')[1] as string
      expect(runbook).toContain(`## ${anchor}`)
      expect((rule.annotations?.['description'] ?? '').length).toBeGreaterThan(0)
    }
    // Backlog pages inside 2 minutes (B5.4 acceptance).
    const backlog = rules.find((rule) => rule.alert === 'KardataBacklog') as Rule
    expect(backlog.labels?.['severity']).toBe('page')
    expect(parseDuration(backlog.for)).toBeLessThanOrEqual(120)
  })

  it('serves fleet gauges on /metrics within the series budget', async () => {
    const runs = new FakeRunsGateway(undefined as never);
    const app: FastifyInstance = buildApp({ runs });
    try {
      const response = await app.inject({ method: 'GET', url: '/metrics' });
      expect(response.statusCode).toBe(200);
      expect(response.body as string).toContain('kardata_runs_by_state');
      expect(response.body as string).toContain('kardata_pg_pool_waiting');
    } finally {
      await app.close();
    }
    // No gateway and no pool: gauges stay empty, scrape still succeeds.
    const { registry } = createHttpMetrics();
    const series = await registry.getMetricsAsArray();
    expect(series.length).toBeLessThan(CARDINALITY_BUDGET);
  });
});
