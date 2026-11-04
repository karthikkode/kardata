import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

export interface PdfTextItem {
  page: number;
  x: number;
  y: number;
  str: string;
}

/** Extract requested views in one pass, with the same per-view bounds. */
async function readPdf(body: Buffer, text: boolean, positions: boolean): Promise<{ text: string; items: PdfTextItem[] }> {
  const task = getDocument({ data: new Uint8Array(body), useSystemFonts: true });
  try {
    const doc = await task.promise;
    const pages: string[] = [];
    const items: PdfTextItem[] = [];
    let chars = 0;
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const content = await page.getTextContent();
      if (text && chars <= 200_000) {
        const value = content.items.map((item) => ("str" in item ? item.str : "")).join("\n");
        chars += value.length + (pages.length ? 1 : 0);
        pages.push(value);
      }
      if (positions && items.length <= 60_000) {
        for (const item of content.items) {
          if (!("str" in item) || !("transform" in item)) continue;
          const value = item as { str: string; transform: number[] };
          const str = value.str.replace(/ /g, " ").trim();
          if (str) items.push({ page: p, x: value.transform[4] ?? 0, y: value.transform[5] ?? 0, str });
        }
      }
      if ((!text || chars > 200_000) && (!positions || items.length > 60_000)) break;
    }
    return { text: pages.join("\n").replace(/\u0000/g, ""), items };
  } finally {
    await task.destroy();
  }
}

/** Full text for brochure/source reads. */
export async function pdfText(body: Buffer): Promise<string> {
  return (await readPdf(body, true, false)).text;
}

/** Read one explicitly requested page, including pages beyond the default text bound. */
export async function pdfPageText(body: Buffer, pageNumber: number): Promise<{ text: string; pageNumber: number; totalPages: number }> {
  if (!Number.isInteger(pageNumber) || pageNumber < 1) throw new RangeError("PDF page must be a positive integer");
  const task = getDocument({ data: new Uint8Array(body), useSystemFonts: true });
  try {
    const doc = await task.promise;
    if (pageNumber > doc.numPages) throw new RangeError(`PDF page exceeds ${doc.numPages} pages`);
    const page = await doc.getPage(pageNumber);
    const content = await page.getTextContent();
    const text = content.items.map((item) => ("str" in item ? item.str : "")).join("\n").replace(/\u0000/g, "");
    return { text, pageNumber, totalPages: doc.numPages };
  } finally {
    await task.destroy();
  }
}

/** Positioned text for table-style parsing. */
export async function pdfTextItems(body: Buffer): Promise<PdfTextItem[]> {
  return (await readPdf(body, false, true)).items;
}

/** Both views for collectors that need table fields and filing excerpts. */
export function pdfTextAndItems(body: Buffer): Promise<{ text: string; items: PdfTextItem[] }> {
  return readPdf(body, true, true);
}

/** Physical pages in reading order, keeping adjacent table cells on the same line. */
export async function pdfReviewPages(body: Buffer): Promise<string[]> {
  const task = getDocument({ data: new Uint8Array(body), useSystemFonts: true });
  try {
    const doc = await task.promise;
    const pages: string[] = [];
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const content = await page.getTextContent();
      const cells = content.items.flatMap(item => "str" in item && item.str.trim()
        ? [{ x: item.transform[4] as number, y: item.transform[5] as number, text: item.str }] : []);
      cells.sort((a, b) => b.y - a.y);
      const rows: (typeof cells)[] = [];
      for (const cell of cells) {
        const row = rows.at(-1);
        if (row && row[0]!.y - cell.y <= 2) row.push(cell);
        else rows.push([cell]);
      }
      pages.push(rows.map(row => row.sort((a, b) => a.x - b.x)
        .map(cell => cell.text).join("  ")).join("\n").replace(/\u0000/g, ""));
      page.cleanup();
    }
    return pages;
  } finally {
    await task.destroy();
  }
}
