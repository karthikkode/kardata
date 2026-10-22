import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadAppEnv } from "../../src/lib/env.js";

const KEYS = ["KARDATA_ENV_FILE", "KARDATA_ENV_TEST_A", "KARDATA_ENV_TEST_B"];

afterEach(() => {
  for (const key of KEYS) delete process.env[key];
});

describe("loadAppEnv", () => {
  it("loads KARDATA_ENV_FILE when set, without touching real env vars", () => {
    const dir = mkdtempSync(join(tmpdir(), "kardata-env-"));
    try {
      writeFileSync(join(dir, "custom.env"), "KARDATA_ENV_TEST_A=from-file\nKARDATA_ENV_TEST_B=from-file\n");
      process.env.KARDATA_ENV_FILE = join(dir, "custom.env");
      process.env.KARDATA_ENV_TEST_B = "from-env";
      loadAppEnv();
      expect(process.env.KARDATA_ENV_TEST_A).toBe("from-file");
      expect(process.env.KARDATA_ENV_TEST_B).toBe("from-env");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("falls back to .env when KARDATA_ENV_FILE is unset", () => {
    delete process.env.KARDATA_ENV_FILE;
    // Must not throw when no .env exists in cwd (vitest runs from repo root,
    // which has a .env — either way this just loads it).
    loadAppEnv();
    expect(process.env.KARDATA_ENV_TEST_A).toBeUndefined();
  });
});
