import { execFile } from "node:child_process";
import { promisify, stripVTControlCharacters } from "node:util";
import { AGENT_IMAGE, AGENTS_NETWORK, MUSE_VOLUME, MUSE_MOUNT } from "../harness/setup.js";
import type { QuotaReading } from "./quota-monitor.js";

type Runner = (args: string[]) => Promise<string>;
const execute = promisify(execFile);
const runDocker: Runner = async (args) => (await execute("docker", args, { timeout: 30000, maxBuffer: 16384 })).stdout;

/** MSP SubscriptionUsage shape, documented by the provider SDK. Reject cached observations. */
export function parseCliQuota(text: string, now = Date.now()): QuotaReading | null {
  try {
    const root = JSON.parse(text) as Record<string, unknown>;
    const usage = (root["usage"] ?? root) as Record<string, unknown>;
    const observed = usage["observedAtMs"];
    if (typeof observed !== "number" || observed < now - 60000 || observed > now + 30000) return null;
    const window = usage["window"] as Record<string, unknown> | undefined;
    const weekly = usage["weekly"] as Record<string, unknown> | undefined;
    const pct = (v: unknown): number | null => typeof v === "number" && Number.isInteger(v) && v >= 0 ? Math.min(v, 100) : null;
    const reset = (v: unknown): string | null => typeof v === "number" && v > 0 && Number.isFinite(v) ? new Date(v).toISOString() : null;
    const fivePct = pct(window?.["usedPercent"]), weeklyPct = pct(weekly?.["usedPercent"]);
    const fiveResetAt = reset(window?.["resetsAtMs"]), weeklyResetAt = reset(weekly?.["resetsAtMs"]);
    return fivePct !== null && weeklyPct !== null && fiveResetAt && weeklyResetAt ? { fivePct, fiveResetAt, weeklyPct, weeklyResetAt } : null;
  } catch { return null; }
}

/** Fixed, non-model CLI command only. No research session, prompt, key or provider payload is returned. */
export async function readMuseCliUsage(run: Runner = runDocker): Promise<{ reading: QuotaReading | null; help: string; diagnostic: string }> {
  const args = ["run", "--rm", "--network", AGENTS_NETWORK, "--user", "agent", "-v", `${MUSE_VOLUME}:${MUSE_MOUNT}`, AGENT_IMAGE, "run", "usage"];
  let help = "";
  try {
    help = (await run([...args, "--help"])).slice(0, 6000);
    const output = await run(help.includes("--json") ? [...args, "--json"] : args);
    const reading = parseCliQuota(output);
    const diagnostic = reading ? "fresh CLI allowance" : stripVTControlCharacters(output).split("\n")
      .filter((line) => !/@|api.?key|token|bearer|password|email|account/i.test(line) && /usage|quota|window|weekly|reset|remaining|allowance|\d\s*%/i.test(line))
      .slice(0, 30).join("\n").slice(0, 4000);
    return { reading, help, diagnostic };
  } catch { return { reading: null, help, diagnostic: "CLI usage read failed" }; }
}
