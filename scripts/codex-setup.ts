/** App-owned Codex installation/login. Never reads or copies personal Codex credentials. */
import { spawnSync } from "node:child_process";
import { CODEX_IMAGE, CODEX_VOLUME, CODEX_MOUNT, CODEX_AUTH_ARGS, codexBaseArgs } from "../src/harness/codex-config.js";
import { networkInspectArgs, networkCreateArgs } from "../src/harness/setup.js";

function docker(args: string[]): void {
  const result = spawnSync("docker", args, { stdio: "inherit" });
  if (result.error || result.status !== 0) process.exit(result.status || 1);
}
if (process.argv.includes("--help")) {
  console.log("Usage: tsx scripts/codex-setup.ts [--install-only | --login-only]\nCreates only the app-owned image/volume. Complete the displayed ChatGPT device login; personal Codex is untouched.");
  process.exit(0);
}
if (!process.argv.includes("--login-only")) {
  docker(["build", "-f", "harness/Codex.Dockerfile", "-t", CODEX_IMAGE, "harness"]);
  docker(["volume", "create", CODEX_VOLUME]);
  if (spawnSync("docker", networkInspectArgs(), { stdio: "ignore" }).status !== 0) docker(networkCreateArgs());
  docker(["run", "--rm", "--network", "none", "--user", "root", "--entrypoint", "/bin/sh",
    "-v", `${CODEX_VOLUME}:${CODEX_MOUNT}`, CODEX_IMAGE, "-c",
    "mkdir -p /opt/codex/home && chown -R 10001:10001 /opt/codex"]);
  docker(["run", "--rm", "--network", "none", CODEX_IMAGE, "--version"]);
}
if (!process.argv.includes("--install-only")) {
  docker([...codexBaseArgs(), CODEX_IMAGE, ...CODEX_AUTH_ARGS, "login", "--device-auth"]);
}
