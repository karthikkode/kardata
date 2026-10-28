import { describe, expect, it } from "vitest";
import { DomainError } from "../../src/domain/errors.js";
import { wrap } from "../../src/mcp/result.js";

describe("tool results", () => {
  it("carry the full data as text after the summary", async () => {
    const data = { facts: [{ id: "f1", sourceIds: ["s1"] }] };
    const res = await wrap(async () => ({ summary: "1 fact", data }));
    expect(res.content[0]?.text).toBe("1 fact");
    expect(JSON.parse(res.content[1]?.text ?? "")).toEqual(data);
    expect(res.structuredContent).toEqual(data);
  });

  it("keep errors as one text line", async () => {
    const res = await wrap(async () => {
      throw new DomainError("not_found", "company not found: x");
    });
    expect(res.isError).toBe(true);
    expect(res.content).toEqual([{ type: "text", text: "not_found: company not found: x" }]);
  });
});
