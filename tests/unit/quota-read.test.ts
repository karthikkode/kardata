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
  } finally {
    rmSync(dir, { recursive: true });
  }
});
