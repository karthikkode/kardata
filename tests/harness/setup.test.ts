import { describe, expect, it } from "vitest";
import {
  AGENT_IMAGE,
  AGENT_UID,
  MUSE_MOUNT,
  MUSE_VOLUME,
  applyDotenvVersion,
  dockerBuildArgs,
  parseMuseVersion,
  setupRunArgs,
  versionRunArgs,
  volumeCreateArgs,
} from "../../src/harness/setup.js";

describe("harness setup", () => {
  it("builds the kardata-agent image from the harness dir", () => {
    expect(dockerBuildArgs("/repo/harness")).toEqual(["build", "-t", AGENT_IMAGE, "/repo/harness"]);
  });

  it("setup run uses the named volume only, never the owner home", () => {
    const args = setupRunArgs();
    expect(args.slice(0, 2)).toEqual(["run", "--rm"]);
    const mounts = args.filter((a, i) => args[i - 1] === "-v");
    expect(mounts).toEqual([`${MUSE_VOLUME}:${MUSE_MOUNT}`]);
    expect(JSON.stringify(args)).not.toContain(process.env.HOME ?? "/home/nobody");
    expect(args.at(-2)).toBe(AGENT_IMAGE);
    expect(args.at(-1)).toBe("setup");
  });

  it("pins the agent uid for run mounts", () => {
    expect(AGENT_UID).toBe(10001);
  });

  it("volume create targets the app Muse volume", () => {
    expect(volumeCreateArgs()).toEqual(["volume", "create", MUSE_VOLUME]);
  });

  it("version probe mounts the volume read-only", () => {
    expect(versionRunArgs()).toContain(`${MUSE_VOLUME}:${MUSE_MOUNT}:ro`);
  });

  it("parses a bare version line and rejects suspicious output", () => {
    expect(parseMuseVersion("1.2.3\n")).toBe("1.2.3");
    expect(parseMuseVersion("\n  2.0.0-rc1  \n")).toBe("2.0.0-rc1");
    expect(parseMuseVersion("")).toBeNull();
    expect(parseMuseVersion("update available\n1.2.3\n")).toBeNull();
    expect(parseMuseVersion("1.2.3; rm -rf /\n")).toBeNull();
  });

  it("sets or replaces KARDATA_MUSE_VERSION in .env text", () => {
    expect(applyDotenvVersion("A=1\n", "1.2.3")).toBe("A=1\nKARDATA_MUSE_VERSION=1.2.3\n");
    expect(applyDotenvVersion("", "1.2.3")).toBe("KARDATA_MUSE_VERSION=1.2.3\n");
    expect(applyDotenvVersion("A=1", "1.2.3")).toBe("A=1\nKARDATA_MUSE_VERSION=1.2.3\n");
    expect(applyDotenvVersion("KARDATA_MUSE_VERSION=0.1\nB=2\n", "1.2.3")).toBe(
      "KARDATA_MUSE_VERSION=1.2.3\nB=2\n",
    );
  });
});
