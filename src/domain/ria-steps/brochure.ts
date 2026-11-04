/** Split Part 2A brochure text by Item headings (Stage 5.8 B4). Pure. */

export const FULL_BROCHURE_PATH = "financials/brochure-full-text.md";
export const FULL_BROCHURE_CAP = 120_000;
export const FULL_BROCHURE_GAP = "brochure section boundaries unavailable; stored extracted text available";

export const BROCHURE_ITEMS = ["4", "5", "8", "9", "12", "14", "15"] as const;

const ITEM_TITLES: Record<string, string> = {
  "4": "Advisory Business",
  "5": "Fees and Compensation",
  "8": "Methods of Analysis",
  "9": "Disciplinary Information",
  "12": "Brokerage Practices",
  "14": "Client Referrals",
  "15": "Custody",
};

const LEADERS = /\.{4,}|…{2,}|\.{2,}\s+\d+\s*$/;

interface Mark {
  item: string;
  start: number;
  contentStart: number;
}

/** Heading lines for one brochure, in document order. Pure. */
export function brochureMarks(text: string): Mark[] {
  const lines = text.split("\n");
  const offsets: number[] = [];
  let acc = 0;
  for (const line of lines) {
    offsets.push(acc);
    acc += line.length + 1;
  }
  const strong: Mark[] = [];
  lines.forEach((line, i) => {
    const trimmed = line.trim();
    if (trimmed.length > 120 || LEADERS.test(trimmed) || /\b(?:for additional information|for more information|above|below|see also|refer to)\b/i.test(trimmed)) return;
    const m =
      /^(?:Form ADV(?:\s*,\s*|\s+)(?:Part 2A,?\s*)?|Part 2A,?\s*)?(?:ITEM|Item)\s+(4|5|8|9|12|14|15)\b/.exec(trimmed) ??
      /^[A-Z][^\n]{0,70}[-–—]\s*(?:ITEM|Item)\s+(4|5|8|9|12|14|15)\b/.exec(trimmed);
    if (m?.[1]) {
      const tail = trimmed.slice(m[0].length).replace(/^[\s.:–—-]+/, "");
      // A material-changes sentence mentioning an Item is not its heading.
      if (/^(?:changed|was|were|has|have|is|are|will|would|contains?|discusses?|describes?|provides?|above|below)\b/i.test(tail)) return;
      strong.push({ item: m[1], start: offsets[i] ?? 0, contentStart: (offsets[i] ?? 0) + line.length });
    }
  });
  // PDF text often puts "5." and "Fees and Compensation" on separate
  // lines, or omits "Item" entirely. Include these headings even when
  // other sections use explicit Item numbers; mixed layouts are common.
  const byTitle: Mark[] = [];
  lines.forEach((line, i) => {
    const trimmed = line.trim();
    if (trimmed.length > 120 || LEADERS.test(trimmed)) return;
    const heading = trimmed.replace(/^\d{1,2}\s*[.):\-–—]\s*/, "");
    for (const [item, title] of Object.entries(ITEM_TITLES)) {
      const suffix = heading.slice(title.length).trim();
      if (heading.toLowerCase().startsWith(title.toLowerCase()) &&
        (!suffix || /^(?:[,;:&–—-]|and\b)/i.test(suffix))) {
        byTitle.push({ item, start: offsets[i] ?? 0, contentStart: (offsets[i] ?? 0) + line.length });
      }
    }
  });
  // A later bare-title cross-reference must never suppress a numbered
  // body heading earlier in the same PDF. TOC filtering happens below.
  const candidates = [...strong, ...byTitle].sort((a, b) => a.start - b.start);
  return chooseBodyMarks(candidates, text);
}

/**
 * Brochures repeat every heading in the table of contents. The body
 * heading is the first candidate whose following text is prose, not a
 * run of TOC entries (dot leaders or several Item mentions at once).
 */
export function chooseBodyMarks(candidates: Mark[], text: string): Mark[] {
  const items = [...new Set(candidates.map((m) => m.item))].sort((a, b) => Number(a) - Number(b));
  const chosen: Mark[] = [];
  const contents = /^[ \t]*(?:(?:Item[ \t]+)?3[.:–—-]?[ \t]+)?(?:Table[ \t]+of[ \t]+Contents|Contents)[ \t]*$/im.exec(text);
  let bodyStart = contents ? contents.index + contents[0].length : 0;
  for (const item of items) {
    // Material changes repeat later Item headings before the actual body.
    // Part 2A body sections proceed in Item order, unlike those references.
    const mine = candidates.filter((m) => m.item === item && m.start >= bodyStart);
    if (!mine.length) continue;
    const qualifies = (m: Mark, minLength: number) => {
      const next = candidates.find((n) => n.start >= m.contentStart && n.item !== m.item);
      const segment = text.slice(m.contentStart, next?.start);
      if (segment.trim().length < minLength) return false;
      const window = segment.slice(0, 500);
      // A real short section may be followed by two other Item headings
      // within this window. Only a leading later heading (after TOC page
      // numbers) identifies a contents fragment; inline references and
      // repeated same-Item headings do not invalidate substantive prose.
      const head = window.trimStart().replace(/^(?:\d{1,3}[ \t]*\n\s*)+/, "");
      const leadingItem = /^(?:Item\s+(\d{1,2})\b|(\d{1,2})[.):]?\s+[A-Z])/i.exec(head);
      const laterItem = Number(leadingItem?.[1] ?? leadingItem?.[2] ?? 0) > Number(m.item);
      return !laterItem && !/\.{4,}/.test(window.slice(0, 200));
    };
    // Short substantive disclosures are valid; contents-only candidates are
    // never a fallback for an absent/unreadable body section.
    const mark = mine.find((m) => qualifies(m, 80)) ?? mine.find((m) => qualifies(m, 40));
    if (!mark) continue;
    chosen.push(mark);
    bodyStart = mark.contentStart;
  }
  return chosen.sort((a, b) => a.start - b.start);
}

export function splitBrochureItems(text: string): Record<string, string> {
  // Small-cap headings can be emitted as "I\nTEM", "F\nEES AND",
  // "C\nOMPENSATION". Repair those word fragments, then fold numbered
  // Item headings onto one line before locating body sections.
  const normalized = text.replace(/\r/g, "")
    .replace(/\b([A-Z])\s*\n\s*([A-Z]{2,})/g, "$1$2")
    .replace(/^[ \t]*ITEM\s+(\d{1,2})[.:]?\s*\n\s*/gim, "Item $1 ");
  const marks = brochureMarks(normalized);
  const out: Record<string, string> = {};
  for (let i = 0; i < marks.length; i++) {
    const mark = marks[i];
    if (!mark || mark.item in out) continue;
    const end = i + 1 < marks.length ? marks[i + 1]?.start : normalized.length;
    const body = normalized.slice(mark.contentStart, end).trim().slice(0, 60_000);
    if (body.length >= 40) out[mark.item] = body;
  }
  return out;
}

export function brochureDate(text: string): string | null {
  const head = text.slice(0, 4000);
  const m = /(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(head);
  if (!m) return null;
  const month = Number(m[1]);
  const day = Number(m[2]);
  const year = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31 || year < 2000 || year > 2100) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export type BrochureKind = "firm" | "wrap" | "supplement" | "unknown";
export const FEE_BROCHURE_PATH_PREFIX = "financials/fee-review-brochure-";

/** The cover controls classification. A roster label is only a fallback. */
export function brochureKind(cover: string, label = ""): BrochureKind {
  const header = cover.slice(0, 4000);
  const match = /\b(part\s*2\s*b|brochure supplement|part\s*2\s*a\s*[,–—-]?\s*appendix\s*1|wrap fee program brochure|part\s*2\s*a|firm brochure)\b/i.exec(header)?.[0];
  if (match) {
    if (/2\s*b|supplement/i.test(match)) return "supplement";
    if (/appendix|wrap/i.test(match)) return "wrap";
    return "firm";
  }
  if (/\b(?:2\s*b|supplement)\b/i.test(label)) return "supplement";
  if (/\bwrap\b/i.test(label)) return "wrap";
  if (/\b(?:2\s*a|firm brochure)\b/i.test(label)) return "firm";
  return "unknown";
}
