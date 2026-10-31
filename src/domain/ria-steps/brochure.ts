/** Split Part 2A brochure text by Item headings (Stage 5.8 B4). Pure. */

export const BROCHURE_ITEMS = ["4", "5", "9", "12", "15"] as const;

export function splitBrochureItems(text: string): Record<string, string> {
  const normalized = text.replace(/\r/g, "");
  const heading = /(?:^|\n)\s*(?:ITEM|Item)\s+(4|5|9|12|15)\b[^\n]*/g;
  const marks: { item: string; start: number; contentStart: number }[] = [];
  for (const m of normalized.matchAll(heading)) {
    marks.push({ item: m[1] as string, start: m.index, contentStart: m.index + m[0].length });
  }
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
