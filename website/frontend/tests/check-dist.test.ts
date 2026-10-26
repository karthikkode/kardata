import { describe, expect, it } from "vitest";
import { checkLinks, targetOf } from "../scripts/lib/links.mjs";
import { scanHtml, scanText } from "../scripts/lib/scan.mjs";
import { htmlText } from "../scripts/lib/html-text.mjs";

describe("scanText", () => {
  it("passes clean copy", () => {
    expect(scanText("A fixed price, quoted on the call. 3–5 patterns.", "p")).toEqual([]);
  });

  it.each([
    ["an em dash \u2014 here", "em dash"],
    ["the Diagnostic report", "diagnostic"],
    ["we do AI automation", "AI automation"],
    ["only $1,500", "price"],
    ["a 10x guarantee", "guarantee"],
    ["the Core retainer", "retainer"],
    ["Testimonials", "testimonials"],
  ])("flags %s", (text, rule) => {
    const out = scanText(text, "page.html");
    expect(out).toHaveLength(1);
    expect(out[0]).toContain(rule);
  });
});

describe("htmlText", () => {
  it("drops tags, scripts and styles and decodes entities", () => {
    expect(htmlText("<style>a{}</style><p>don&#39;t &amp; <b>go</b></p><script>x=1</script>")).toBe("don't & go");
  });
});

describe("links", () => {
  it("maps paths, site URLs and anchors to dist files", () => {
    expect(targetOf("/blog/", "index.html")).toEqual({ file: "blog/index.html", hash: "" });
    expect(targetOf("https://kardata.co/og-default.png", "index.html")).toEqual({ file: "og-default.png", hash: "" });
    expect(targetOf("/book/?from=%2F", "index.html")).toEqual({ file: "book/index.html", hash: "" });
    expect(targetOf("#fn-1", "blog/x/index.html")).toEqual({ file: "blog/x/index.html", hash: "fn-1" });
    expect(targetOf("https://example.com/", "index.html")).toBeNull();
    expect(targetOf("mailto:a@b.c", "index.html")).toBeNull();
  });

  it("reports broken links and missing anchors", () => {
    const files = {
      "index.html": '<a href="/about/">a</a> <a href="/gone/">b</a> <a href="/about/#team">c</a> <a href="#top">d</a>',
      "about/index.html": '<h1 id="intro">About</h1>',
    };
    const problems = checkLinks(files, (f: string) => f in files);
    expect(problems).toEqual([
      "index.html: broken link /gone/",
      "index.html: missing anchor /about/#team",
      "index.html: missing anchor #top",
    ]);
  });
});

describe("scanHtml", () => {
  it("flags text glued to a link on either side", () => {
    expect(scanHtml('Questions first?<a href="mailto:x">x</a>', "p")).toHaveLength(1);
    expect(scanHtml('<a href="/">home</a>and more', "p")).toHaveLength(1);
  });

  it("passes spaced links and punctuation after a link", () => {
    expect(scanHtml('Write to <a href="mailto:x">x</a>. Or <strong>call</strong>, now.', "p")).toEqual([]);
  });
});
