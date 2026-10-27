import { describe, expect, it } from "vitest";
import { parseToolArgs } from "../../scripts/mcp-call.js";

describe("mcp-call arg parsing", () => {
  it("keeps the JSON-args form", () => {
    expect(parseToolArgs(["sector_list", "{}"])).toEqual({ tool: "sector_list", args: {} });
    expect(parseToolArgs(["sector_get", '{"sectorId":"abc"}'])).toEqual({
      tool: "sector_get",
      args: { sectorId: "abc" },
    });
  });

  it("passes --json-file content as the profile arg alongside flags", () => {
    const { tool, args } = parseToolArgs([
      "sector_profile_set",
      "--sectorId",
      "sector-1",
      "--json-file",
      "tests/fixtures/sector-profile.json",
    ]);
    expect(tool).toBe("sector_profile_set");
    expect(args.sectorId).toBe("sector-1");
    expect((args.profile as { name?: string }).name).toBe("sample-sector");
  });

  it("rejects a missing flag value and an unreadable json file", () => {
    expect(() => parseToolArgs(["sector_profile_set", "--sectorId"])).toThrow(/missing value/);
    expect(() => parseToolArgs(["sector_profile_set", "--json-file", "nope.json"])).toThrow(/could not read/);
  });
});
