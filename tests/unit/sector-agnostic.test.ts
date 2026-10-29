import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Stage 5.6 guard: no sector-specific nouns in code or live prompts.
 * Sector content belongs in docs/sectors/<slug>/profile.json. Word
 * boundaries keep innocent words (simultaneous, regarding) legal.
 */
const BANNED = ["skincare", "skin care", "garden", "beauty", "cosmetic", "sephora", "ulta", "boots", "serum", "dermatolog", "masstige", "wwd"];
const PATTERN = new RegExp(`\\b(${BANNED.join("|")})`, "i");

function filesUnder(dir: string, keep: (path: string) => boolean): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...filesUnder(path, keep));
    else if (keep(path)) out.push(path);
  }
  return out;
}

describe("sector-agnostic guard", () => {
  it("finds no sector nouns in src (excluding migrations)", () => {
    const files = filesUnder(resolve("src"), (p) => p.endsWith(".ts") && !p.includes(`${join("src", "db", "migrations")}`));
    const hits: string[] = [];
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      const match = text.match(PATTERN);
      if (match) hits.push(`${file}: ${match[0]}`);
    }
    expect(hits).toEqual([]);
  });

  it("finds no sector nouns in the live prompts", () => {
    const dirs = ["prompts/research-v1.8", "prompts/extract-v4", "prompts/icp-v3", "prompts/sector-preflight-v2"];
    const files = dirs.flatMap((d) => filesUnder(resolve(d), () => true));
    files.push(resolve("prompts/preflight-v1.md"));
    const hits: string[] = [];
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      const match = text.match(PATTERN);
      if (match) hits.push(`${file}: ${match[0]}`);
    }
    expect(hits).toEqual([]);
  });
});
