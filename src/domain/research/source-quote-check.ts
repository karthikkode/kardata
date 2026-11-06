import { eq } from "drizzle-orm";
import type { Db } from "../../db/client.js";
import { sources } from "../../db/schema.js";
import { DomainError } from "../errors.js";
import { blobText } from "./reads.js";

/** Read-only literal quote checks for operator-curated evidence. */
export async function checkSourceQuotes(db: Db, companyId: string,
  quotes: { sourceId: string; quote: string; pdfPage?: number }[]) {
  const cache = new Map<string, { text: string; url: string }>();
  const results = [];
  for (const q of quotes) {
    const key = `${q.sourceId}:${q.pdfPage ?? "text"}`;
    let context = cache.get(key);
    if (!context) {
      const [source] = await db.select().from(sources).where(eq(sources.id, q.sourceId));
      if (!source || source.companyId !== companyId) throw new DomainError("forbidden", "source does not belong to selected company");
      if (!source.blobSha256) throw new DomainError("invalid_input", "source has no stored text");
      const blob = await blobText(db, source.blobSha256, q.pdfPage);
      if (!blob) throw new DomainError("invalid_input", "stored source blob is unavailable");
      if (q.pdfPage !== undefined && !blob.pdfPage) throw new DomainError("invalid_input", "physical page requires a PDF source");
      context = { text: blob.text, url: source.finalUrl ?? source.url }; cache.set(key, context);
    }
    const offset = context.text.indexOf(q.quote);
    results.push({ sourceId: q.sourceId, quote: q.quote, pdfPage: q.pdfPage ?? null, url: context.url,
      verified: offset >= 0, start: offset >= 0 ? offset : null, end: offset >= 0 ? offset + q.quote.length : null });
  }
  return { checked: results.length, verified: results.filter(r => r.verified).length, results };
}
