// Runs after `astro build` (npm run check). Fails on broken internal links or anchors, words and
// figures the site must never show, and any draft post that reached the build.
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { checkLinks } from "./lib/links.mjs";
import { htmlText } from "./lib/html-text.mjs";
import { scanHtml, scanText } from "./lib/scan.mjs";

const root = new URL("..", import.meta.url).pathname;
const dist = join(root, "dist");
const postsDir = join(root, "src/content/posts");

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

const all = walk(dist);
const files = Object.fromEntries(
  all.filter((p) => p.endsWith(".html")).map((p) => [relative(dist, p), readFileSync(p, "utf8")]),
);
const rss = readFileSync(join(dist, "rss.xml"), "utf8");

const problems = [];
problems.push(...checkLinks(files, (f) => existsSync(join(dist, f))));
for (const [file, html] of Object.entries(files)) {
  problems.push(...scanText(htmlText(html), file), ...scanHtml(html, file));
}
problems.push(...scanText(rss, "rss.xml"));

for (const name of readdirSync(postsDir)) {
  if (!name.endsWith(".md") || name.startsWith("_")) continue;
  const src = readFileSync(join(postsDir, name), "utf8");
  const front = src.match(/^---\n([\s\S]*?)\n---/)?.[1] ?? "";
  if (!/^draft:\s*true\s*$/m.test(front)) continue;
  const slug = name.replace(/\.md$/, "");
  if (existsSync(join(dist, "blog", slug))) problems.push(`draft "${slug}" is in the build`);
  if (rss.includes(`/blog/${slug}/`)) problems.push(`draft "${slug}" is in rss.xml`);
}

if (problems.length) {
  console.error(`check-dist: ${problems.length} problem(s)\n` + problems.map((p) => `  - ${p}`).join("\n"));
  process.exit(1);
}
console.log(`check-dist: ${Object.keys(files).length} pages, links, words and drafts OK`);
