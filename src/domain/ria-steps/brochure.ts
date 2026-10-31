/** Split Part 2A brochure text by Item headings (Stage 5.8 B4). Pure. */

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
    if (trimmed.length > 120 || LEADERS.test(trimmed)) return;
    const m =
      /^(?:Form ADV(?:\s*,\s*|\s+)(?:Part 2A,?\s*)?|Part 2A,?\s*)?(?:ITEM|Item)\s+(4|5|8|9|12|14|15)\b/.exec(trimmed) ??
      /^[A-Z][^\n]{0,70}[-–—]\s*(?:ITEM|Item)\s+(4|5|8|9|12|14|15)\b/.exec(trimmed);
    if (m?.[1]) strong.push({ item: m[1], start: offsets[i] ?? 0, contentStart: (offsets[i] ?? 0) + line.length });
  });
  if (new Set(strong.map((m) => m.item)).size >= 2) return chooseBodyMarks(strong, text);
  // No usable Item numbers: fall back to the standard Part 2A section
  // titles (skipping table-of-contents lines, which carry dot leaders).
  const byTitle: Mark[] = [];
  lines.forEach((line, i) => {
    const trimmed = line.trim();
    if (trimmed.length > 80 || LEADERS.test(trimmed)) return;
    for (const [item, title] of Object.entries(ITEM_TITLES)) {
      if (trimmed.toLowerCase().startsWith(title.toLowerCase()) && !byTitle.some((m) => m.item === item)) {
        byTitle.push({ item, start: offsets[i] ?? 0, contentStart: (offsets[i] ?? 0) + line.length });
      }
    }
  });
  return byTitle.length >= 2 ? chooseBodyMarks(byTitle, text) : strong;
}

/**
 * Brochures repeat every heading in the table of contents. The body
 * heading is the first candidate whose following text is prose, not a
 * run of TOC entries (dot leaders or several Item mentions at once).
 */
export function chooseBodyMarks(candidates: Mark[], text: string): Mark[] {
  const items = [...new Set(candidates.map((m) => m.item))];
  const chosen: Mark[] = [];
  for (const item of items) {
    const mine = candidates.filter((m) => m.item === item);
    const body = mine.find((m) => {
      const window = text.slice(m.contentStart, m.contentStart + 500);
      const itemMentions = window.match(/\bItem\s+\d+/g)?.length ?? 0;
      return itemMentions < 2 && !/\.{4,}/.test(window.slice(0, 200));
    });
    chosen.push(body ?? (mine[0] as Mark));
  }
  return chosen.sort((a, b) => a.start - b.start);
}

export function splitBrochureItems(text: string): Record<string, string> {
  const normalized = text.replace(/\r/g, "");
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
