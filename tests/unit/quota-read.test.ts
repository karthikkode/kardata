import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it } from "vitest";

it("keeps zero usage and never prints provider credentials or error bodies", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "quota-read-"));
  try {
    writeFileSync(path.join(dir, "docker"), "#!/bin/sh\necho fixture-secret\n", { mode: 0o755 });
    const curl = path.join(dir, "curl");
    const env = { ...process.env, PATH: `${dir}:${process.env.PATH}` };
    writeFileSync(curl, '#!/bin/sh\necho \'{"subs_usage":{"window":{"used_percent":0},"weekly":{"used_percent":30}}}\'\n', { mode: 0o755 });
    const out = execFileSync("bash", ["scripts/quota-read.sh"], { env, encoding: "utf8" });
    expect(JSON.parse(out)).toMatchObject({ fivePct: 0, weeklyPct: 30 });
    writeFileSync(curl, '#!/bin/sh\necho \'{"error":"fixture-secret"}\'\necho "curl: HTTP 401" >&2\nexit 22\n', { mode: 0o755 });
    const failed = spawnSync("bash", ["scripts/quota-read.sh"], { env, encoding: "utf8" });
    expect(failed.status).not.toBe(0);
    expect(failed.stdout).toBe("");
    expect(failed.stderr).toContain("HTTP 401");
    expect(failed.stderr).not.toContain("fixture-secret");
    writeFileSync(curl, '#!/bin/sh\necho \'{"error":{"code":190,"message":"fixture-secret"}}\'\n', { mode: 0o755 });
    const auth = spawnSync("bash", ["scripts/quota-read.sh"], { env, encoding: "utf8" });
    expect(auth.status).not.toBe(0);
    expect(auth.stderr).toContain("error_code=190");
    expect(auth.stderr).not.toContain("fixture-secret");
    writeFileSync(curl, '#!/bin/sh\necho \'{"data":{"usage":{"five_hour":0}},"access_token":"fixture-secret","detail":"fixture-secret"}\'\n', { mode: 0o755 });
    const schema = spawnSync("bash", ["scripts/quota-read.sh"], { env, encoding: "utf8" });
    expect(schema.status).not.toBe(0);
    expect(schema.stderr).toContain('"five_hour": "int"');
    expect(schema.stderr).toContain('"access_token": "str"');
    expect(schema.stderr).not.toContain("fixture-secret");
    writeFileSync(curl, '#!/bin/sh\necho \'{"detail":"Access token has expired: fixture-secret"}\'\n', { mode: 0o755 });
    const classified = spawnSync("bash", ["scripts/quota-read.sh"], { env, encoding: "utf8" });
    expect(classified.stderr).toContain('error classifications=["authentication"]');
    expect(classified.stderr).not.toContain("fixture-secret");
    writeFileSync(curl, '#!/bin/sh\necho \'{"api_key":"fixture-secret","user_email":"fixture-secret","is_subs_active":false,"require_payment":true}\'\n', { mode: 0o755 });
    const account = execFileSync("bash", ["scripts/quota-read.sh", "--diagnostics"], { env, encoding: "utf8" });
    expect(JSON.parse(account)).toMatchObject({ account: { apiKeyPresent: true, is_subs_active: false, require_payment: true }, quota: null });
    expect(account).not.toContain("fixture-secret");
  } finally {
    rmSync(dir, { recursive: true });
  }
});
