import { expect, it, vi } from "vitest";
import { groundMiningCitations, materializeMining, mineSource, miningPrompt } from "../../src/domain/research/evidence-mining.js";
import { miningFixture, miningText, miningThemes } from "../fixtures/evidence-mining.js";
const sources = [{ id: "source-one", url: "https://example.com/interview", text: miningText }];
const input = { title: "Synthetic operations interview", published: "2026-01-01", sources, themes: miningThemes };
const usage = { inputTokens: 10, outputTokens: 20, cachedTokens: 0, reasoningTokens: 0, calls: 1 };

it("grounds literal quotes with source offsets and a section timestamp", () => {
  const answer = miningFixture(), grounded = groundMiningCitations(answer, sources);
  expect(grounded.rejected).toEqual([]);
  for (const c of grounded.accepted.values()) expect(miningText.slice(c.start, c.end)).toBe(c.quote);
  expect(grounded.accepted.get("result")?.sectionTimestamp).toBe("12:30");
});

it("separates actual owner/operator accounts from vendors and journalists", () => {
  const item = materializeMining(miningFixture(), sources, miningThemes);
  expect(item.outcome).toBe("processed");
  expect(item.problems.map(p => p.counts_as_firsthand)).toEqual([true, true, false, false]);
  expect(item.problems[1]!.outside_help.paid.value).toBe("not stated");
  expect(item.problems[1]!.results).toBe("not stated");
  expect(item.problems[0]!.outside_help.costs).toEqual(expect.arrayContaining([expect.objectContaining({ number: 0 })]));
  expect(item.tools_named).toEqual([expect.objectContaining({ value: "ExampleCRM" })]);
});

it("rejects changed whitespace, punctuation and foreign source citations", () => {
  const f = miningFixture();
  f.citations[0]!.quote = "I  own Synthetic Practice.";
  f.citations[1]!.source_id = "another-company-source";
  const result = groundMiningCitations(f, sources);
  expect(result.rejected).toEqual(expect.arrayContaining([
    expect.objectContaining({ path: "owner", reason: "quote is not word for word in stored source" }),
    expect.objectContaining({ path: "size", reason: "citation source outside this item" }),
  ]));
  expect(result.accepted.has("owner")).toBe(false);
});

it("repairs only rejected citations once without dropping grounded problems or numbers", async () => {
  const f = miningFixture(); f.citations.find(q => q.id === "problem")!.quote = "We lost eight hours every week.";
  const call = vi.fn().mockResolvedValueOnce({ json: f, usage }).mockResolvedValueOnce({
    json: { repairs: [{ id: "problem", source_id: "source-one", quote: miningFixture().citations.find(q => q.id === "problem")!.quote }] }, usage,
  });
  const result = await mineSource(input, call, "synthetic-run");
  expect(call).toHaveBeenCalledTimes(2);
  expect(result.item.outcome).toBe("processed");
  expect(result.item.problems).toHaveLength(4);
  expect(result.item.problems[0]!.results).toEqual(expect.arrayContaining([expect.objectContaining({ number: 5 })]));
  expect(result.repairLog).toEqual([{ citationId: "problem", reason: "quote is not word for word in stored source", repaired: true }]);
  expect(result.inputTokens).toBe(20); expect(result.calls).toBe(2);
});

it("keeps grounded fields while failed repairs become explicit gaps, not not-stated", async () => {
  const f = miningFixture(); f.citations.find(q => q.id === "help")!.quote = "We paid a fortune.";
  const call = vi.fn().mockResolvedValueOnce({ json: f, usage }).mockResolvedValueOnce({ json: { repairs: [] }, usage });
  const result = await mineSource(input, call, "synthetic-run");
  expect(result.item.outcome).toBe("partial");
  expect(result.item.problems[0]!.problem.status).toBe("stated");
  expect(result.item.problems[0]!.outside_help.paid.status).toBe("review_failed");
  expect(result.item.citations.some(q => q.id === "help")).toBe(false);
  expect(result.repairLog[0]!.repaired).toBe(false);
  for (const c of result.item.citations) expect(miningText.includes(c.quote)).toBe(true);
});

it("never counts an ungrounded or ambiguous speaker as firsthand", () => {
  const f = miningFixture(); f.speakers.push({ ...f.speakers[0]! });
  expect(materializeMining(f, sources, miningThemes).problems[0]!.counts_as_firsthand).toBe(false);
  const other = miningFixture(); other.speakers[0]!.role_evidence = ["unknown"];
  expect(materializeMining(other, sources, miningThemes).problems[0]!.counts_as_firsthand).toBe(false);
});

it("supplies the complete long text and fails explicitly instead of silently truncating", async () => {
  const text = "start ".repeat(70_000) + "IMPORTANT END OF SOURCE";
  expect(miningPrompt({ ...input, sources: [{ ...sources[0]!, text }] })).toContain("IMPORTANT END OF SOURCE");
  const call = vi.fn();
  await expect(mineSource({ ...input, sources: [{ ...sources[0]!, text: "x".repeat(900001) }] }, call, "synthetic-run")).rejects.toThrow("no text was silently truncated");
  expect(call).not.toHaveBeenCalled();
});

it("checks the quota guard before both initial and repair calls", async () => {
  const f = miningFixture(); f.citations[0]!.quote = "not a source quote";
  const guard = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("weekly85%"));
  const call = vi.fn().mockResolvedValue({ json: f, usage });
  await expect(mineSource(input, call, "synthetic-run", guard)).rejects.toThrow("weekly85%");
  expect(call).toHaveBeenCalledTimes(1); expect(guard).toHaveBeenCalledTimes(2);
});

it("preserves the original source ID and physical page for PDF-page quotes", () => {
  const f = miningFixture("page-reference");
  const item = materializeMining(f, [{ ...sources[0]!, id: "page-reference", sourceId: "stored-pdf", page: 4 }], miningThemes);
  expect(item.citations[0]).toMatchObject({ sourceId: "stored-pdf", page: 4 });
});
