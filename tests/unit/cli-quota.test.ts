import { expect, it } from "vitest";
import { parseCliQuota, readMuseCliUsage } from "../../src/runs/cli-quota.js";

it("accepts fresh provider usage including zero, rejects absent or old usage and preserves quota stops", () => {
  const now = Date.now();
  const usage = { observedAtMs: now, window: { usedPercent: 0, resetsAtMs: now + 300000 }, weekly: { usedPercent: 30, resetsAtMs: now + 700000 } };
  expect(parseCliQuota(JSON.stringify({ usage }), now)).toMatchObject({ fivePct: 0, weeklyPct: 30 });
  expect(parseCliQuota(JSON.stringify({ usage: { ...usage, observedAtMs: now - 60001 } }), now)).toBeNull();
  expect(parseCliQuota("{}", now)).toBeNull();
  expect(parseCliQuota(JSON.stringify({ ...usage, weekly: { ...usage.weekly, usedPercent: 101 } }), now)?.weeklyPct).toBe(100);
});

it("runs only fixed usage/help commands and redacts diagnostic identity and credentials", async () => {
  const calls: string[][] = [];
  const result = await readMuseCliUsage(async (args) => {
    calls.push(args);
    return args.at(-1) === "--help" ? "usage --json" : "Weekly usage unavailable\napi_key: secret\naccount: private@example.invalid";
  });
  expect(calls.every((args) => args.includes("usage") && !args.includes("exec"))).toBe(true);
  expect(calls[1]?.at(-1)).toBe("--json");
  expect(result.reading).toBeNull();
  expect(result.diagnostic).toBe("Weekly usage unavailable");
});
