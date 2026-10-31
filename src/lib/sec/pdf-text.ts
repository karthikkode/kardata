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
  return pages.join("\n");
}
