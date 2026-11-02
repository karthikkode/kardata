/** App-owned Codex installation/login. Never reads or copies personal Codex credentials. */
import { spawnSync } from "node:child_process";
import { CODEX_IMAGE, CODEX_VOLUME, CODEX_MOUNT, CODEX_AUTH_ARGS, codexBaseArgs } from "../src/harness/codex-config.js";
import { networkInspectArgs, networkCreateArgs } from "../src/harness/setup.js";

function docker(args: string[]): void {
  const result = spawnSync("docker", args, { stdio: "inherit" });
  if (result.error || result.status !== 0) process.exit(result.status || 1);
}
function checkCli(): void {
  const probe = (args: string[]) => {
    const result = spawnSync("docker", ["run", "--rm", "--network", "none", CODEX_IMAGE, ...args], { encoding: "utf8" });
    if (result.error || result.status !== 0) throw new Error("App-owned Codex CLI validation failed");
    return result.stdout;
  };
  const help = probe(["exec", "--help"]);
  for (const flag of ["--json", "--ephemeral", "--ignore-user-config", "--ignore-rules", "--output-schema", "--skip-git-repo-check"]) {
    if (!help.includes(flag)) throw new Error(`Installed Codex does not support ${flag}`);
  }
  const features = probe(["features", "list"]);
  for (const name of ["shell_tool", "multi_agent", "hooks", "plugins"]) {
    if (!new RegExp(`^${name}\\s`, "m").test(features)) throw new Error(`Installed Codex cannot disable ${name}`);
  }
  console.log("App-owned Codex CLI extraction flags verified (no account/model call).");
}
if (process.argv.includes("--help")) {
  console.log("Usage: tsx scripts/codex-setup.ts [--install-only | --login-only | --check]\nCreates only the app-owned image/volume. Complete the displayed ChatGPT device login; personal Codex is untouched.");
  process.exit(0);
}
if (process.argv.includes("--check")) { checkCli(); process.exit(0); }
if (!process.argv.includes("--login-only")) {
  docker(["build", "-f", "harness/Codex.Dockerfile", "-t", CODEX_IMAGE, "harness"]);
  docker(["volume", "create", CODEX_VOLUME]);
  if (spawnSync("docker", networkInspectArgs(), { stdio: "ignore" }).status !== 0) docker(networkCreateArgs());
  docker(["run", "--rm", "--network", "none", "--user", "root", "--entrypoint", "/bin/sh",
    "-v", `${CODEX_VOLUME}:${CODEX_MOUNT}`, CODEX_IMAGE, "-c",
    "mkdir -p /opt/codex/home && chown -R 10001:10001 /opt/codex"]);
  docker(["run", "--rm", "--network", "none", CODEX_IMAGE, "--version"]);
  checkCli();
}
if (!process.argv.includes("--install-only")) {
  docker([...codexBaseArgs(), CODEX_IMAGE, ...CODEX_AUTH_ARGS, "login", "--device-auth"]);
}
