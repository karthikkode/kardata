/**
 * One-time app-Muse setup (the OWNER runs this interactively):
 * builds the kardata-agent image, creates the kardata_muse volume, installs
 * the Muse launcher into it, and performs the device-code login.
 * Never touches the owner's personal Muse (~/.config/muse etc.).
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  applyDotenvVersion,
  dockerBuildArgs,
  parseMuseVersion,
  setupRunArgs,
  volumeCreateArgs,
  versionRunArgs,
} from "../src/harness/setup.js";

function runDocker(args: string[], opts: { inherit: boolean }): { ok: boolean; stdout: string } {
  const result = spawnSync("docker", args, {
    stdio: opts.inherit ? "inherit" : ["ignore", "pipe", "inherit"],
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
  });
  if (result.error) {
    console.error(`cannot run docker: ${(result.error as Error).message}`);
    console.error("Is docker installed and is your user allowed to run it (docker group)? No sudo needed.");
    process.exit(2);
  }
  return { ok: result.status === 0, stdout: result.stdout ?? "" };
}

function main(): void {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    console.log(
      [
        "Usage: npm run harness:setup",
        "",
        "One-time, interactive: builds the kardata-agent image, creates the",
        "kardata_muse volume, installs the app-owned Muse launcher into it,",
        "and runs `muse login` (device code; complete it in the browser).",
        "Writes the installed version to KARDATA_MUSE_VERSION in .env.",
        "Never touches your personal Muse setup.",
      ].join("\n"),
    );
    return;
  }
  if (!process.stdin.isTTY) {
    console.error("harness:setup needs a terminal: the Muse login is interactive. Aborting.");
    process.exit(2);
  }
  const repo = process.cwd();

  console.log("==> checking docker");
  const daemon = spawnSync("docker", ["info"], { stdio: "ignore" });
  if (daemon.error || daemon.status !== 0) {
    console.error("docker is not reachable. Start the daemon / check group membership. No sudo needed.");
    process.exit(2);
  }

  console.log("==> building kardata-agent");
  if (!runDocker(dockerBuildArgs(join(repo, "harness")), { inherit: true }).ok) process.exit(1);

  console.log("==> creating kardata_muse volume");
  if (!runDocker(volumeCreateArgs(), { inherit: true }).ok) process.exit(1);

  console.log("==> installing app Muse and logging in (complete the device code in your browser)");
  if (!runDocker(setupRunArgs(), { inherit: true }).ok) process.exit(1);

  console.log("==> reading installed version");
  const probed = runDocker(versionRunArgs(), { inherit: false });
  if (!probed.ok) process.exit(1);
  const version = parseMuseVersion(probed.stdout);
  const envPath = join(repo, ".env");
  if (version && existsSync(envPath)) {
    writeFileSync(envPath, applyDotenvVersion(readFileSync(envPath, "utf8"), version));
    console.log(`==> wrote KARDATA_MUSE_VERSION=${version} to .env`);
  } else if (version) {
    console.log(`Add this line to your .env: KARDATA_MUSE_VERSION=${version}`);
  } else {
    console.log("Could not parse the installed version; raw output was:");
    console.log(probed.stdout);
    console.log("Set KARDATA_MUSE_VERSION in .env to the version string and continue.");
  }
  console.log("Done. Tell the agent the login is complete so it can run the Step 0 proofs.");
}

main();
