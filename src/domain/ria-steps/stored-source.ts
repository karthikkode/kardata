import { gunzipSync } from "node:zlib";
import { and, desc, eq, gte, isNotNull } from "drizzle-orm";
import type { Db } from "../../db/client.js";
import { blobs, sources } from "../../db/schema.js";
import { FETCH_MAX_BYTES, fetchUrl, type FetchRequest, type FetchResult } from "../../collect/fetch.js";

export const storedSourceStats = { hits: 0, misses: 0 };

/** Reparse a recent stored snapshot, retaining its actual source id/date. */
export async function storedOrFetch(db: Db, request: FetchRequest): Promise<FetchResult> {
  const [cached] = await db.select({ source: sources, blob: blobs }).from(sources)
    .innerJoin(blobs, eq(sources.blobSha256, blobs.sha256))
    .where(and(eq(sources.companyId, request.companyId), eq(sources.url, request.url),
      eq(sources.status, "ok"), isNotNull(sources.blobSha256),
      gte(sources.fetchedAt, new Date(Date.now() - 48 * 3_600_000))))
    .orderBy(desc(sources.fetchedAt)).limit(1);
  if (cached && cached.blob.size <= (request.maxBytes ?? FETCH_MAX_BYTES)) {
    try {
      const body = gunzipSync(cached.blob.gzip);
      if (body.length === cached.blob.size) {
        storedSourceStats.hits += 1;
        return { source: cached.source, body, text: body.toString("utf8"), contentType: cached.blob.contentType };
      }
    } catch { /* Missing/corrupt stored input falls back to the normal polite fetch. */ }
  }
  storedSourceStats.misses += 1;
  return fetchUrl(db, request);
}
