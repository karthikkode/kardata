import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { companies, harnessSettings, providerCalls } from "../../src/db/schema.js";
import type { DbHandle } from "../../src/db/client.js";
import { ensureMigrated, getTestDb, resetTestDb } from "../db.js";
import { createSector } from "../../src/domain/sectors.js";
import { quotaBreakerClear, quotaBreakerGet, quotaBreakerSet, windowBurn } from "../../src/domain/quota/breaker.js";
import { riaExtractorCall, riaProviderGate, setRiaProviderMode } from "../../src/domain/ria-steps/provider.js";
import { runRiaStep } from "../../src/domain/ria-steps/runner.js";
import { CodexCallError } from "../../src/harness/codex-extract.js";
const mocks = vi.hoisted(() => ({ codex: vi.fn(), muse: vi.fn(), status: vi.fn() }));
vi.mock("../../src/harness/codex-extract.js", async (original) => ({ ...await original<object>(), dockerCodexExtractorCall: mocks.codex }));
vi.mock("../../src/runs/extract.js", async (original) => ({ ...await original<object>(), dockerExtractorCall: mocks.muse }));
vi.mock("../../src/harness/codex-status.js", async (original) => ({ ...await original<object>(), readCodexSnapshot: mocks.status }));
let handle: DbHandle;
beforeAll(async () => { handle = getTestDb(); await ensureMigrated(handle); });
beforeEach(async () => { await resetTestDb(handle); vi.clearAllMocks(); });
afterAll(async () => { await handle.close(); });
async function snapshot(usedPercent = 10) {
  await handle.db.insert(harnessSettings).values({ key: "ria_codex_snapshot", value: {
    checkedAt: new Date().toISOString(), authenticated: true, modelAvailable: true, error: null,
    primary: { usedPercent, windowMinutes: 300, resetsAt: new Date(Date.now() + 3600000).toISOString() },
    secondary: { usedPercent: 20, windowMinutes: 10080, resetsAt: new Date(Date.now() + 86400000).toISOString() },
  } });
}
async function tripMuse() {
  await quotaBreakerSet(handle.db, { trippedAt: new Date().toISOString(), resumeAt: new Date(Date.now() + 3600000).toISOString(), estimated: false, jobIds: [], error: "synthetic quota" });
}
async function museSnapshot() {
  await handle.db.insert(harnessSettings).values({ key: "quota_snapshot", value: {
    checkedAt: new Date().toISOString(), fivePct: 10, weeklyPct: 20,
    fiveResetAt: new Date(Date.now()+3600000).toISOString(), weeklyResetAt: new Date(Date.now()+86400000).toISOString(),
  } });
}
it("keeps Muse as default and selects Codex only when auto needs its separate capacity", async () => {
  await snapshot(); await museSnapshot();
  expect(await riaProviderGate(handle.db)).toMatchObject({ mode: "muse", provider: "muse", available: true });
  await setRiaProviderMode(handle.db, "auto");
  expect(await riaProviderGate(handle.db)).toMatchObject({ provider: "muse", available: true });
  await tripMuse();
  expect(await riaProviderGate(handle.db)).toMatchObject({ provider: "codex", available: true });
  expect((await quotaBreakerGet(handle.db)).tripped).toBe(true);
});
it("does not bypass Codex exhaustion or clear the Muse breaker", async () => {
  await snapshot(96); await tripMuse(); await setRiaProviderMode(handle.db, "auto");
  expect(await riaProviderGate(handle.db)).toMatchObject({ provider: "codex", available: false });
  expect((await quotaBreakerGet(handle.db)).tripped).toBe(true);
});
it("pins the chosen provider for a step even if Muse recovers while the handler is preparing", async () => {
  await snapshot(); await museSnapshot(); await tripMuse(); await setRiaProviderMode(handle.db, "auto");
  const { sector } = await createSector(handle.db, { name: "Synthetic provider" });
  const id = randomUUID();
  await handle.db.insert(companies).values({ id, source: "sec", secCrd: "999921", name: "Synthetic Provider Firm", country: "United States" });
  mocks.codex.mockResolvedValue({ json: {}, usage: undefined });
  const result = await runRiaStep(handle.db, { sectorId: sector.id, step: "ops_read", companyIds: [id] }, {
    ops_read: async () => {
      await quotaBreakerClear(handle.db);
      await riaExtractorCall(handle.db)({ runId: randomUUID(), area: "ops_read", prompt: "synthetic", schema: "{}" });
      return { status: "done" };
    },
  });
  expect(result.done).toBe(1); expect(mocks.codex).toHaveBeenCalledTimes(1); expect(mocks.muse).not.toHaveBeenCalled();
});
it("does not switch auto back to Muse using missing or stale usage", async () => {
  await snapshot(); await setRiaProviderMode(handle.db, "auto");
  expect(await riaProviderGate(handle.db)).toMatchObject({ provider: "codex", available: true });
  await museSnapshot();
  await handle.db.update(harnessSettings).set({ value: { checkedAt: "2020-01-01T00:00:00Z", fivePct: 0, weeklyPct: 0 } }).where(eq(harnessSettings.key,"quota_snapshot"));
  expect(await riaProviderGate(handle.db)).toMatchObject({ provider: "codex", available: true });
});
it("excludes Codex tokens from Muse burn while retaining older null-model calls", async () => {
  await handle.db.insert(providerCalls).values([
    { stage: "extraction", model: "gpt-6.1-terra", seq: 0, inputTokens: 1000, cachedTokens: 200 },
    { stage: "extraction", model: "muse-spark-1.3", seq: 0, inputTokens: 50, cachedTokens: 10 },
    { stage: "extraction", seq: 0, inputTokens: 20, cachedTokens: 5 },
  ]);
  expect(await windowBurn(handle.db, null)).toBe(85);
  expect((await handle.db.select().from(harnessSettings).where(eq(harnessSettings.key, "ria_extractor_provider"))).length).toBe(0);
});
it("holds Codex on its real exhaustion without overwriting Muse's breaker", async () => {
  await snapshot(); await tripMuse(); await setRiaProviderMode(handle.db, "auto");
  const originalTrip = await quotaBreakerGet(handle.db);
  const { sector } = await createSector(handle.db, { name: "Synthetic quota isolation" });
  const id = randomUUID();
  await handle.db.insert(companies).values({ id, source: "sec", secCrd: "999922", name: "Synthetic Quota Firm", country: "United States" });
  mocks.codex.mockRejectedValue(new CodexCallError("quota"));
  mocks.status.mockResolvedValue({ checkedAt: new Date().toISOString(), authenticated: true, modelAvailable: true, error: null,
    primary: { usedPercent: 100, windowMinutes: 300, resetsAt: new Date(Date.now()+3600000).toISOString() }, secondary: null });
  const result = await runRiaStep(handle.db, { sectorId: sector.id, step: "ops_read", companyIds: [id] }, {
    ops_read: async () => { await riaExtractorCall(handle.db)({ runId: randomUUID(), area: "ops_read", prompt: "synthetic", schema: "{}" }); return { status: "done" }; },
  });
  expect(result).toMatchObject({ failed: 1, stopped: "quota" });
  expect(await quotaBreakerGet(handle.db)).toEqual(originalTrip);
  expect(await riaProviderGate(handle.db)).toMatchObject({ provider: "codex", available: false });
});
