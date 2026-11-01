import type { PdfTextItem } from "./pdf-text.js";

/**
 * Schedule A of Form ADV Part 1 (direct owners and executive officers),
 * parsed as a table from positioned pdfjs text items: full legal name,
 * title or status, and the date the title was acquired. Layouts vary
 * (column bands from the header row when present; date-anchored rows
 * otherwise; titles may wrap onto the next line).
 */
export interface ScheduleAEntry {
  name: string;
  title: string;
  titleSince: string | null;
}

const DATE_RE = /^\d{1,2}\/\d{1,2}\/\d{4}$/;
const OWNERSHIP_CODE = /^(I|DE|D|IE|IO|INDIRECT|DIRECT)\s+(.+)$/;

/** Titles pick up the Schedule A ownership column ("I", "DE", …) as debris. */
export function cleanScheduleATitle(title: string): string {
  let out = title.replace(/\s+/g, " ").trim();
  for (;;) {
    const m = OWNERSHIP_CODE.exec(out);
    if (!m || !m[2]) break;
    out = m[2].trim();
  }
  return out;
}
const HEADER_WORDS = /full legal name|title or status|date title|name of owner/i;

interface Line {
  page: number;
  y: number;
  items: PdfTextItem[];
}

function toLines(items: PdfTextItem[]): Line[] {
  const sorted = [...items].sort((a, b) => a.page - b.page || b.y - a.y || a.x - b.x);
  const lines: Line[] = [];
  for (const item of sorted) {
    const last = lines[lines.length - 1];
    if (last && last.page === item.page && Math.abs(last.y - item.y) <= 3) {
      last.items.push(item);
    } else {
      lines.push({ page: item.page, y: item.y, items: [item] });
    }
  }
  for (const line of lines) line.items.sort((a, b) => a.x - b.x);
  return lines;
}

function lineText(line: Line): string {
  return line.items.map((i) => i.str).join(" ").replace(/\s+/g, " ").trim();
}

export function parseScheduleA(items: PdfTextItem[]): ScheduleAEntry[] {
  const lines = toLines(items);
  // Region: from the "Schedule A" heading that names direct owners /
  // executive officers (not the table-of-contents mention) to Schedule B.
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    const text = lineText(lines[i] as Line);
    if (/schedule\s*a/i.test(text) && /direct owners|executive officers/i.test(text)) {
      start = i;
      break;
    }
  }
  if (start < 0) {
    for (let i = 0; i < lines.length; i++) {
      if (/^schedule\s*a\b/i.test(lineText(lines[i] as Line))) {
        start = i;
        break;
      }
    }
  }
  if (start < 0) return [];
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^schedule\s*b\b/i.test(lineText(lines[i] as Line))) {
      end = i;
      break;
    }
  }
  const region = lines.slice(start + 1, end);

  // Column bands from the header row when present.
  let bands: { nameTo: number; titleTo: number } | null = null;
  let headerIdx = -1;
  for (let i = 0; i < region.length; i++) {
    const line = region[i] as Line;
    if (!HEADER_WORDS.test(lineText(line))) continue;
    const cells = line.items;
    const titleCell = cells.find((c) => /title/i.test(c.str));
    const dateCell = cells.find((c) => /date/i.test(c.str));
    if (titleCell && dateCell) {
      bands = { nameTo: titleCell.x - 4, titleTo: dateCell.x - 4 };
      headerIdx = i;
      break;
    }
  }

  const entries: ScheduleAEntry[] = [];
  const seen = new Set<string>();
  const push = (name: string, title: string, titleSince: string | null) => {
    const cleanName = name.replace(/\s+/g, " ").trim();
    const cleanTitle = cleanScheduleATitle(title);
    if (cleanName.length < 3 || cleanTitle.length < 2) return;
    if (HEADER_WORDS.test(cleanName) || HEADER_WORDS.test(cleanTitle)) return;
    const key = cleanName.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    entries.push({ name: cleanName, title: cleanTitle, titleSince });
  };

  for (let i = headerIdx + 1; i < region.length; i++) {
    const line = region[i] as Line;
    const dateItem = line.items.find((c) => DATE_RE.test(c.str));
    if (bands) {
      const name = line.items.filter((c) => c.x < bands.nameTo).map((c) => c.str).join(" ");
      const title = line.items
        .filter((c) => c.x >= bands.nameTo && c.x < bands.titleTo && !DATE_RE.test(c.str))
        .map((c) => c.str)
        .join(" ");
      if (name.trim() === "" && title.trim() !== "" && !dateItem && entries.length > 0) {
        // Wrapped title continuation.
        const prev = entries[entries.length - 1] as ScheduleAEntry;
        prev.title = `${prev.title} ${title}`.replace(/\s+/g, " ").trim();
        continue;
      }
      push(name, title, dateItem ? dateItem.str : null);
      continue;
    }
    // No header row: anchor on the date cell; name is the left cluster,
    // title the middle cluster (split on wide x gaps).
    if (!dateItem) {
      const text = lineText(line);
      if (text !== "" && entries.length > 0 && line.items.every((c) => c.x < dateItemX(region, i))) {
        const prev = entries[entries.length - 1] as ScheduleAEntry;
        prev.title = `${prev.title} ${text}`.replace(/\s+/g, " ").trim();
      }
      continue;
    }
    const before = line.items.filter((c) => c.x < dateItem.x - 4);
    if (before.length === 0) continue;
    const segments: PdfTextItem[][] = [[before[0] as PdfTextItem]];
    for (let k = 1; k < before.length; k++) {
      const prevItem = before[k - 1] as PdfTextItem;
      const cur = before[k] as PdfTextItem;
      if (cur.x - prevItem.x > 60) segments.push([]);
      (segments[segments.length - 1] as PdfTextItem[]).push(cur);
    }
    const name = (segments[0] ?? []).map((c) => c.str).join(" ");
    const title = segments.slice(1).flat().map((c) => c.str).join(" ");
    push(name, title, dateItem.str);
    if (entries.length >= 40) break;
  }
  return entries.slice(0, 40);
}

function dateItemX(region: Line[], upto: number): number {
  for (let i = upto - 1; i >= 0; i--) {
    const d = (region[i] as Line).items.find((c) => DATE_RE.test(c.str));
    if (d) return d.x;
  }
  return Number.POSITIVE_INFINITY;
}
