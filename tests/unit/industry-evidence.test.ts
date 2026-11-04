import { describe, expect, it } from "vitest";
import {
  articleText, canonicalIndustryUrl, extractIndustryEvidence, industryPath, redditItems,
} from "../../src/domain/research/industry-evidence.js";

describe("industry evidence", () => {
  it("extracts the transcript and carries a section timestamp into the quoted evidence", () => {
    const item = articleText(`<article><h1>Episode</h1><p>Executive summary</p>
      <h2 id="full-transcript">Full Transcript: Episode Subtitle</h2><h2>Improving operations [08:40]</h2>
      <p>Guest: Manual onboarding was difficult for our team.</p>
      <p>We implemented Acme Tools and reduced the effort by 40 percent.</p><p>We manage $170 million of AUM.</p>
      <aside>Unrelated advertisement</aside></article>`, true);
    expect(item.title).toBe("Episode");
    expect(item.text).not.toContain("Executive summary");
    expect(item.text).not.toContain("advertisement");
    const evidence = extractIndustryEvidence(item.text, { toolNames: ["Acme Tools"] });
    expect(evidence.problems).toEqual([{
      theme: "Onboarding and paperwork",
      evidence: { quote: "Manual onboarding was difficult for our team.", timestamp: "08:40" },
    }]);
    expect(evidence.tools[0]?.name).toBe("Acme Tools");
    expect(evidence.results[0]?.quote).toContain("40 percent");
    expect(evidence.firmSize[0]?.stated).toBe("$170 million");
  });

  it("finds a transcript inside a details element and refuses to substitute an article for a missing transcript", () => {
    const article = `<main><h1>Episode</h1><p>Editorial copy.</p><h3>Episode Shownotes And Transcript</h3>
      <details><summary>Expand</summary><p>Shownotes:</p><p>Promotional notes</p>
      <p><strong>Transcript:</strong></p><p>Guest: This is the conversation.</p></details>
      <p>End of article.</p></main>`;
    expect(articleText(article, true).text).toBe("Guest: This is the conversation.");
    expect(articleText("<article><p>Only a summary</p></article>", true).text).toBe("");
  });

  it("strips author metadata, mentions and usernames in Reddit URLs and post text", () => {
    const rss = `<feed><entry><author><name>/u/example-person</name></author>
      <title>Onboarding from example-person</title>
      <link href="https://www.reddit.com/r/example/comments/abc123/example-person/?utm=foo"/>
      <content type="html"><![CDATA[<p>Manual onboarding is difficult. Thanks u/another_person.</p>
      <p>Credit to example-person, @other_person, and https://www.reddit.com/user/last_person.</p>
      <a href="https://www.reddit.com/user/example-person">submitted by example-person</a>]]></content>
      <published>2025-10-01</published></entry></feed>`;
    const items = redditItems(rss);
    expect(items).toHaveLength(1);
    expect(items[0]?.url).toBe("https://www.reddit.com/r/example/comments/abc123");
    expect(items[0]?.text).toContain("Manual onboarding is difficult.");
    expect(JSON.stringify(items)).not.toMatch(/example-person|another_person|other_person|last_person/);
  });

  it("deduplicates tracking variants and uses episode ids for distinct archive series", () => {
    const original = "https://example.com/episodes/four/";
    const alternate = "https://example.com/episodes/new-title?source=feed#chapter";
    expect(industryPath(original, "show-one", 4)).toEqual(industryPath(alternate, "show-one", 4));
    expect(industryPath(original, "show-one", 4)).not.toEqual(industryPath(original, "show-two", 4));
    expect(canonicalIndustryUrl(original + "?source=feed#chapter")).toBe("https://example.com/episodes/four");
    expect(() => canonicalIndustryUrl("https://secret@example.com/")).toThrow("public HTTPS");
  });
});
