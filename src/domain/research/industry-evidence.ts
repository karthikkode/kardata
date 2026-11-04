import { load } from "cheerio";
import { createHash } from "node:crypto";

const compact = (text: string) => text.replace(/\s+/g, " ").trim();

export function canonicalIndustryUrl(value: string) {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password) throw new Error("Industry evidence needs a public HTTPS URL");
  url.hash = "";
  url.search = "";
  if (url.pathname !== "/") url.pathname = url.pathname.replace(/\/+$/, "");
  return url.href;
}

export function redactRedditText(text: string) {
  return text.normalize("NFKC")
    .replace(/(?:https?:\/\/)?(?:[\w-]+\.)?reddit\.com\/(?:u|user)\/[\w-]+(?:\/[^\s"'<>)]*)?/gi, "[redacted]")
    .replace(/(^|[^\w])\/?u\/[\w-]+/gi, "$1[redacted]")
    .replace(/(^|[^\w@])@[\w-]+/g, "$1[redacted]")
    .replace(/^(\s*(?:submitted by|posted by|author)\s*:?\s*)[\w-]+/gim, "$1[redacted]");
}

export function redditItems(xml: string) {
  const $ = load(xml, { xmlMode: true });
  return $("entry").toArray().flatMap((entry) => {
    const source = $(entry);
    const link = source.children("link").attr("href");
    if (!link) return [];
    const url = new URL(canonicalIndustryUrl(link));
    const match = /^\/r\/([\w]+)\/comments\/([a-z0-9]+)(?:\/|$)/i.exec(url.pathname);
    if (!["www.reddit.com", "reddit.com"].includes(url.hostname) || !match) return [];
    // Omit the slug and Atom author fields entirely. They can contain usernames.
    const html = load(source.children("content").text());
    html("a").filter((_, a) => /(?:submitted by|posted by|^\/?u\/)/i.test(html(a).text())).remove();
    html("script,style").remove();
    const author = source.find("author name").text().replace(/^\/?u\//i, "").trim();
    const knownAuthor = /^[\w-]+$/.test(author) ? new RegExp(`(?<![\\w-])${author}(?![\\w-])`, "gi") : null;
    const sanitize = (text: string) => {
      const redacted = redactRedditText(compact(text));
      return knownAuthor ? redacted.replace(knownAuthor, "[redacted]") : redacted;
    };
    const text = sanitize(html("body").text());
    return [{
      url: `https://www.reddit.com/r/${match[1]}/comments/${match[2]}`,
      title: sanitize(source.children("title").text()),
      published: source.children("published").text() || source.children("updated").text() || null,
      text,
    }];
  }).filter((item) => item.text.length > 0);
}

export function articleText(html: string, transcript = false) {
  const $ = load(html);
  $("script,style,noscript,aside,footer,form,.sharedaddy,[class*=SocialShare]").remove();
  const title = compact($("h1").first().text() || $("title").first().text());
  const published = $("meta[property='article:published_time']").attr("content")
    ?? $("time[datetime]").first().attr("datetime") ?? null;
  const canonical = $("link[rel='canonical']").attr("href") ?? null;
  const body = $(".pf-content,.ArticleBase-BodyContent,.entry-content,article,main").first();
  const transcriptHeading = body.find("h2,h3,h4,h5,p").toArray().find((el) => {
    const label = compact($(el).text());
    return /^(?:full |episode )?transcript(?:\s*[:.!].{0,80})?$/i.test(label)
      || /^(?!.*(?:show\s*notes|download|print)).{1,38}\btranscript\s*[:.!]?$/i.test(label);
  });
  const dialogue = /^(\p{Lu}[\p{L} .'’-]{1,40}):\s+.{12,}/u;
  const paragraphs = body.find("p").toArray();
  const detailedStart = transcript && !transcriptHeading
    ? body.find("details").filter((_, el) => /transcript/i.test($(el).children("summary").text()))
      .find("p").toArray().find((el) => dialogue.test(compact($(el).text())))
    : undefined;
  const dialogueStart = detailedStart ?? (transcript && !transcriptHeading ? paragraphs.find((el) => {
    const who = dialogue.exec(compact($(el).text()))?.[1];
    if (!who) return false;
    const labels = [who, ...$(el).nextAll("p").slice(0, 12).toArray()
      .map((p) => dialogue.exec(compact($(p).text()))?.[1]).filter(Boolean)];
    return labels.length >= 5 && new Set(labels).size >= 2 && labels.filter((name) => name === who).length >= 2;
  }) : undefined);
  const root = !transcript ? body.find("p,li,h2,h3,h4")
    : transcriptHeading ? $(transcriptHeading).nextAll()
      : dialogueStart ? $(dialogueStart).add($(dialogueStart).nextAll()) : $();
  const blocks: string[] = [];
  for (const node of root.toArray()) {
    const entry = $(node);
    if (entry.is("div,section")) {
      for (const nested of entry.find("p,li,h2,h3,h4").toArray()) {
        const text = compact($(nested).text());
        if (text && !blocks.includes(text)) blocks.push(text);
      }
    } else {
      const text = compact(entry.text());
      if (text && !blocks.includes(text)) blocks.push(text);
    }
  }
  return { title, published, canonical, text: blocks.join("\n\n") };
}

export function industryPath(url: string, group: string, episode?: number | null) {
  if (!/^[a-z0-9-]+$/.test(group)) throw new Error("Invalid source group");
  const key = episode ? `${group}:${episode}` : canonicalIndustryUrl(url);
  return { key, path: `other/industry/${group}-${createHash("sha256").update(key).digest("hex").slice(0, 20)}.md` };
}

const THEMES = {
  "Staff capacity and delegation": /\b(?:staffing|workload|delegate|delegating|capacity constraint|overload|hiring|headcount|time-consuming)\b/i,
  "Billing and fee accuracy": /\b(?:billing|overcharg\w+|fee calculations?|fee schedules?|fee reconciliation|fee compression)\b/i,
  "Onboarding and paperwork": /\b(?:onboarding|paperwork|account opening|forms? processing|document collection)\b/i,
  "Workflow consistency": /\b(?:workflows?|standard operating procedures?|process mapping|manual processes?|checklists?)\b/i,
  "Disconnected technology and data": /\b(?:data silo|data silos|tech stack|software integration|data integration|duplicate entry|double entry|disconnected systems)\b/i,
  "Custody and account transfers": /\b(?:custody|custodian|asset transfers?|account transfers?|ACATS)\b/i,
  "Compliance documentation": /\b(?:compliance program|annual review|documentation|books and records|recordkeeping|audit trail|marketing rule)\b/i,
  "Client communication and handoffs": /\b(?:client communication|follow-up|handoff|client meeting|meeting preparation|touchpoints?)\b/i,
  "Continuity and succession": /\b(?:succession planning|succession plan|continuity plan|key person risk|ownership transition)\b/i,
  "Rebalancing and portfolio operations": /\b(?:rebalancing|portfolio reporting|trading workflow|trading errors|tax-loss harvesting)\b/i,
  "Vendor oversight and outsourcing": /\b(?:outsource|outsourcing|vendor oversight|vendor management|third-party service provider|due diligence)\b/i,
  "AI governance and confidentiality": /\b(?:AI governance|AI policy|AI adoption|data privacy|client confidentiality|cybersecurity|AI note[- ]tak\w+)\b/i,
} as const;
const PROBLEM = /\b(?:difficult|hard|challenge|pain|problem|friction|manual|time-consuming|risk|error|fail\w*|miss\w*|bottleneck|struggl\w*|overcharg\w*|burden|overwhelmed|incorrect|inadequate|complex|costly|lack\w*|delay\w*|too much)\b/i;
const ACTION = /\b(?:we|our firm|the firm|advisers?)\b.{0,80}\b(?:changed|added|adopted|implemented|switched|automated|reduced|stopped|replaced|hired|trained|outsourced|created|simplified|built)\b/i;
const RESULT = /\b(?:sav\w*|cut|reduc\w*|improv\w*|increas\w*|grew|faster|fewer)\b.{0,80}\b\d[\d,.]*\s*(?:%|percent|hours?|days?|minutes?|clients?|households?|staff|employees?)/i;
const SIZE = /(?:\$\s?[\d,.]+\s*(?:million|billion|[mb])|\b\d[\d,]*\s+(?:households?|clients?|staff|employees?|advis[eo]rs?|team members?))\b/gi;
const SIZE_CONTEXT = /\b(?:we serve|we manage|our firm|the firm|its firm|their firm|the practice|assets under management|AUM|our team|the team|manages|serves)\b/i;

type Evidence = { quote: string; timestamp: string | null };

export function extractIndustryEvidence(text: string, options: { regulator?: boolean; toolNames?: readonly string[] } = {}) {
  const toolNames = options.toolNames ?? [];
  const toolPattern = toolNames.length
    ? new RegExp(`\\b(?:${toolNames.map((name) => name.replace(/[.*+?^$${}()|[\]\\]/g, "\\$&")).join("|")})\\b`, "gi")
    : null;
  const problems: { theme: string; evidence: Evidence }[] = [];
  const changes: Evidence[] = [];
  const results: Evidence[] = [];
  const firmSize: { stated: string; evidence: Evidence }[] = [];
  const tools = new Map<string, { name: string; evidence: Evidence }>();
  let timestamp: string | null = null;
  let speakerRole: "regulator" | "journalist" | "owner" | "operator" | "vendor" | "unknown" =
    options.regulator ? "regulator" : "unknown";
  let roleEvidence: Evidence | null = null;

  for (const raw of text.split(/\n{2,}/)) {
    const block = compact(raw);
    const time = /\[((?:\d+:)?\d{1,2}:\d{2})\]/.exec(block);
    if (time) timestamp = time[1]!;
    const body = block.replace(/^[\w .’'-]{1,45}:\s+/, "");
    for (const sentence of body.match(/[^.!?]+(?:[.!?](?=\s|$)|$)/g) ?? []) {
      const clean = sentence.trim();
      if (clean.length < 18) continue;
      const words = clean.split(/\s+/);
      const evidence: Evidence = { quote: words.slice(0, 19).join(" "), timestamp };
      if (speakerRole === "unknown") {
        const quote = clean.match(/\b(?:I am|I'm|I was|I’m)\s+(?:the|a|an)\s+(?:(?:co[- ]?)?founder|owner|chief operating officer|operations director|software vendor|journalist)\b/i)?.[0];
        if (quote) {
          speakerRole = /founder|owner/i.test(quote) ? "owner" : /journalist/i.test(quote) ? "journalist"
            : /vendor/i.test(quote) ? "vendor" : "operator";
          roleEvidence = { quote, timestamp };
        }
      }
      if (SIZE_CONTEXT.test(clean)) for (const match of clean.matchAll(SIZE)) {
        const stated = match[0];
        if (firmSize.length < 6 && !firmSize.some((row) => row.stated === stated)) {
          firmSize.push({ stated, evidence: { quote: clean.slice(Math.max(0, match.index - 45), match.index + stated.length + 32).trim(), timestamp } });
        }
      }
      for (const match of toolPattern ? clean.matchAll(toolPattern) : []) {
        const name = match[0];
        if (!tools.has(name.toLowerCase())) {
          tools.set(name.toLowerCase(), { name, evidence: { quote: clean.slice(Math.max(0, match.index - 40), match.index + name.length + 37).trim(), timestamp } });
        }
      }
      if (PROBLEM.test(clean)) for (const [theme, pattern] of Object.entries(THEMES)) {
        const match = pattern.exec(clean);
        if (match && !problems.some((row) => row.theme === theme)) {
          const start = clean.lastIndexOf(" ", Math.max(0, match.index - 44)) + 1;
          problems.push({ theme, evidence: { quote: clean.slice(start).split(/\s+/).slice(0, 19).join(" "), timestamp } });
        }
      }
      if (changes.length < 5 && ACTION.test(evidence.quote)) changes.push(evidence);
      if (results.length < 5 && RESULT.test(evidence.quote)) results.push(evidence);
    }
  }
  return { speakerRole, roleEvidence, firmSize, problems, tools: [...tools.values()], changes, results };
}
