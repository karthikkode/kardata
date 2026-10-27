import { describe, expect, it } from "vitest";
import remarkNumberKinds, { splitText } from "../src/lib/remark-number-kinds.mjs";

describe("splitText", () => {
  it("returns null when there is no token", () => {
    expect(splitText("plain text")).toBeNull();
  });

  it("turns each kind into a label and keeps the text around it", () => {
    const parts = splitText("3.5% {study} and 12 hours {estimate}.");
    expect(parts).toEqual([
      { type: "text", value: "3.5% " },
      { type: "html", value: '<span class="kind kind-study">study</span>' },
      { type: "text", value: " and 12 hours " },
      { type: "html", value: '<span class="kind kind-estimate">estimate</span>' },
      { type: "text", value: "." },
    ]);
  });

  it("names claim and vendor in full", () => {
    expect(splitText("{claim}")?.[0].value).toContain("company claim");
    expect(splitText("{vendor}")?.[0].value).toContain("vendor data");
  });

  it("fails on an unknown kind", () => {
    expect(() => splitText("40% {stdy}", "x.md")).toThrow(/Unknown number kind \{stdy\} in x\.md/);
  });
});

describe("remarkNumberKinds", () => {
  it("rewrites text nested in emphasis but leaves code alone", () => {
    const tree = {
      type: "root",
      children: [
        {
          type: "paragraph",
          children: [
            { type: "emphasis", children: [{ type: "text", value: "5% {study}" }] },
            { type: "inlineCode", value: "{study}" },
          ],
        },
      ],
    };
    remarkNumberKinds()(tree as never, { path: "t.md" } as never);
    const para = tree.children[0] as { children: { type: string; children?: { type: string }[] }[] };
    expect(para.children[0].children?.map((c) => c.type)).toEqual(["text", "html"]);
    expect(para.children[1].type).toBe("inlineCode");
  });
});
