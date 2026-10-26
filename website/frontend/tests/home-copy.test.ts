import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { homeCopy } from "../scripts/lib/home-copy.mjs";
import { htmlText } from "../scripts/lib/html-text.mjs";

// website.md lives in docs/business (owner's). Point WEBSITE_MD at it if it isn't in this checkout.
const mdPath = process.env.WEBSITE_MD ?? resolve(__dirname, "../../../docs/business/website.md");
const htmlPath = resolve(__dirname, "../dist/index.html");
const ready = existsSync(mdPath) && existsSync(htmlPath);

// Changes the owner asked for in chat, until website.md is updated to match.
const OWNER_CHANGES: Record<string, string> = {
  // 2026-10-27: "why five? make it general like multiple"
  "Your brand runs on five systems. The time and money leak between them.":
    "Your brand runs on multiple systems. The time and money leak between them.",
};

describe("homeCopy", () => {
  it("extracts quoted lines and FAQ pairs", () => {
    const md = [
      "## Home, top to bottom",
      "1. **Headline**",
      "   > **Big line.**",
      "   >",
      "   > Under it,",
      "   > on two lines.",
      "   >",
      "   > [Book a call]",
      "2. **Problems**",
      "   > - **One.** First text.",
      "   > - **Two.** Second",
      "   >   text.",
      "7. **FAQ:**",
      '   - "Is it safe?" → Yes, read-only.',
      "## Next",
      "> not home",
    ].join("\n");
    expect(homeCopy(md)).toEqual({
      lines: ["Big line.", "Under it, on two lines.", "Book a call", "One. First text.", "Two. Second text."],
      faq: [{ q: "Is it safe?", a: "Yes, read-only." }],
    });
  });
});

describe.skipIf(!ready)("built home page", () => {
  it("contains website.md's home copy word for word", () => {
    const { lines, faq } = homeCopy(readFileSync(mdPath, "utf8"));
    const text = htmlText(readFileSync(htmlPath, "utf8"));
    expect(lines.length).toBeGreaterThan(5);
    for (const line of lines) expect(text).toContain(OWNER_CHANGES[line] ?? line);
    for (const { q, a } of faq) {
      expect(text).toContain(q);
      expect(text).toContain(a);
    }
  });
});
