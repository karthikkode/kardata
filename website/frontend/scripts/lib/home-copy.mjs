// Pulls the home page copy out of docs/business/website.md ("Home, top to bottom"):
// the quoted lines (headline, line under it, the problems, the audit paragraph) and the FAQ pairs.

function clean(s) {
  return s
    .replace(/\*\*/g, "")
    .replace(/^\s*-\s+/, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function homeCopy(markdown) {
  const start = markdown.indexOf("## Home");
  const end = markdown.indexOf("\n## ", start + 1);
  const section = markdown.slice(start, end === -1 ? undefined : end);

  const quotes = [];
  let current = [];
  const flush = () => {
    if (current.length) quotes.push(clean(current.join(" ")));
    current = [];
  };
  for (const raw of section.split("\n")) {
    const line = raw.trim();
    if (!line.startsWith(">")) {
      flush();
      continue;
    }
    const body = line.replace(/^>\s?/, "");
    if (body === "") flush();
    else if (/^-\s/.test(body)) {
      flush();
      current.push(body);
    } else current.push(body);
  }
  flush();

  const faq = [];
  for (const m of section.matchAll(/^\s*-\s+"([^"]+)"\s+→\s+(.+)$/gm)) {
    faq.push({ q: m[1].trim(), a: m[2].trim() });
  }

  // "[Book a 20-minute call]" is the button, checked as its label.
  return {
    lines: quotes.map((q) => q.replace(/^\[(.+)\]$/, "$1")).filter(Boolean),
    faq,
  };
}
