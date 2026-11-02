import { expect, it } from "vitest";
import { codexHasCapacity, parseCodexSnapshot } from "../../src/harness/codex-status.js";
const now = new Date("2026-01-01T00:00:00Z");
const account = { account: { type: "chatgpt", email: "private@example.invalid", token: "secret-value" } };
const models = { data: [{ model: "gpt-6.1-terra", supportedReasoningEfforts: [{ reasoningEffort: "medium" }] }] };
const window = (usedPercent: number, windowDurationMins: number) => ({ usedPercent, windowDurationMins, resetsAt: now.getTime() / 1000 + 3600 });
const limits = (five = 0, weekly = 0) => ({ rateLimits: { primary: window(five, 300), secondary: window(weekly, 10080), rateLimitReachedType: null } });
it("returns only quota/model/auth allowlisted fields", () => {
  const snapshot = parseCodexSnapshot(account, models, limits(10, 20), now);
  expect(codexHasCapacity(snapshot, now.getTime())).toBe(true);
  expect(JSON.stringify(snapshot)).not.toMatch(/private@|secret-value|token/);
});
it("keeps the short-window95 and weekly100 stops independent", () => {
  expect(codexHasCapacity(parseCodexSnapshot(account, models, limits(95, 20), now), now.getTime())).toBe(false);
  expect(codexHasCapacity(parseCodexSnapshot(account, models, limits(0, 99), now), now.getTime())).toBe(true);
  expect(codexHasCapacity(parseCodexSnapshot(account, models, limits(0, 100), now), now.getTime())).toBe(false);
});
it("never interprets missing/string quota, stale data or absent Terra access as available", () => {
  expect(codexHasCapacity(parseCodexSnapshot(account, models, {}, now), now.getTime())).toBe(false);
  const malformed = limits(); (malformed.rateLimits.primary.usedPercent as unknown) = "0";
  expect(codexHasCapacity(parseCodexSnapshot(account, models, malformed, now), now.getTime())).toBe(false);
  expect(codexHasCapacity(parseCodexSnapshot(account, models, limits(), now), now.getTime() + 600001)).toBe(false);
  expect(codexHasCapacity(parseCodexSnapshot(account, { data: [] }, limits(), now), now.getTime())).toBe(false);
  expect(codexHasCapacity(parseCodexSnapshot({ account: { type: "apiKey" } }, models, limits(), now), now.getTime())).toBe(false);
});
it("accepts an explicitly absent secondary window and uses the model-specific bucket", () => {
  const specific = { primary: window(5, 300), secondary: null, rateLimitReachedType: null };
  const snapshot = parseCodexSnapshot(account, models, { ...limits(100,100), rateLimitsByLimitId: { "gpt-6.1-terra": specific } }, now);
  expect(snapshot.secondary).toBeNull();
  expect(codexHasCapacity(snapshot, now.getTime())).toBe(true);
});
