import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

/** Full text of a PDF via pdfjs (Stage 5.8 B4; replaces the hand-written parser). */
export async function pdfText(body: Buffer): Promise<string> {
  const doc = await getDocument({ data: new Uint8Array(body), useSystemFonts: true }).promise;
  const pages: string[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    pages.push(content.items.map((item) => ("str" in item ? item.str : "")).join("\n"));
    if (pages.join("\n").length > 200_000) break;
  }
  return pages.join("\n").replace(/\u0000/g, "");
}

export interface PdfTextItem {
  page: number;
  x: number;
  y: number;
  str: string;
}

/** Text items with positions (pdfjs transform), for table-style parsing. */
export async function pdfTextItems(body: Buffer): Promise<PdfTextItem[]> {
  const doc = await getDocument({ data: new Uint8Array(body), useSystemFonts: true }).promise;
  const out: PdfTextItem[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    for (const item of content.items) {
      if (!("str" in item) || !("transform" in item)) continue;
      const t = item as { str: string; transform: number[] };
      const str = t.str.replace(/ /g, " ").trim();
      if (str === "") continue;
      out.push({ page: p, x: t.transform[4] ?? 0, y: t.transform[5] ?? 0, str });
    }
    if (out.length > 60_000) break;
  }
  return out;
}
