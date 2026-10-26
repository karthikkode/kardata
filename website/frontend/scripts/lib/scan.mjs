// Rules from AGENTS.md, website.md "Never on the site" and D-54/D-58, checked on the built pages.
export const BANNED = [
  { rule: "em dash", re: /\u2014/ },
  { rule: '"diagnostic" (say "audit", D-54)', re: /\bdiagnostics?\b/i },
  { rule: '"AI automation"', re: /\bAI[- ]automation\b/i },
  { rule: "a price or $ amount (D-58)", re: /[$£€]\s?\d/ },
  { rule: "guarantee (D-58)", re: /\bguarantee/i },
  { rule: "retainer (D-58)", re: /\bretainers?\b/i },
  { rule: "testimonials", re: /\btestimonials?\b/i },
];

/** Returns one message per rule broken, with a little context. */
export function scanText(text, where) {
  const problems = [];
  for (const { rule, re } of BANNED) {
    const m = re.exec(text);
    if (m) {
      const at = Math.max(0, m.index - 30);
      problems.push(`${where}: ${rule}: "...${text.slice(at, m.index + m[0].length + 30)}..."`);
    }
  }
  return problems;
}

/** Text glued to a link or inline tag, e.g. "first?<a" (Astro drops a line break before a tag). */
export function scanHtml(html, where) {
  const problems = [];
  const glued = /([A-Za-z0-9?.,:;!])(<(?:a|strong|em|code|time)\b[^>]*>)|(<\/(?:a|strong|em|code|time)>)([A-Za-z0-9(])/g;
  for (const m of html.matchAll(glued)) {
    problems.push(`${where}: missing space around a link or tag: "${m[0].slice(0, 60)}"`);
  }
  return problems;
}
