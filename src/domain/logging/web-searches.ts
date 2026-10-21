import { randomUUID } from "node:crypto";
import { and, eq, inArray, isNull, or } from "drizzle-orm";
import type { Db } from "../../db/client.js";
import { sources, webSearches, type ResearchRun, type WebSearchResult } from "../../db/schema.js";

/** One web_search / web_fetch call, as emitted by harness/session-reader.mjs. */
export interface SessionSearch {
  call_id: string | null;
  tool: string;
  query_or_url: string;
  results: WebSearchResult[];
  result_count: number;
  at: string | null;
  area: string | null;
  child_session_id: string | null;
}

function validDate(value: string | null): Date | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function urlVariants(url: string): string[] {
  const out = new Set<string>([url]);
  if (url.endsWith("/") && url.length > 8) out.add(url.slice(0, -1));
  else out.add(`${url}/`);
  return [...out];
}

/**
 * Store ingested web calls, then link captured sources back to the search
 * row they came from: a source links when its URL (or final URL) matches a
 * search result URL or a fetched URL, trailing slash aside.
 */
export async function ingestWebSearches(
  db: Db,
  run: ResearchRun,
  searches: SessionSearch[],
): Promise<{ inserted: number; linked: number }> {
  if (searches.length === 0) return { inserted: 0, linked: 0 };
  const ids: string[] = [];
  for (const search of searches) {
    const id = randomUUID();
    ids.push(id);
    await db.insert(webSearches).values({
      id,
      runId: run.id,
      companyId: run.companyId,
      subagent: search.child_session_id,
      area: search.area,
      tool: search.tool,
      queryOrUrl: search.query_or_url,
      results: search.results,
      resultCount: search.result_count,
      ...(validDate(search.at) ? { at: validDate(search.at) as Date } : {}),
    });
  }
  // Link per row (a run's searches are dozens at most): all candidate URLs
  // for the row, matched against url and final_url.
  let linked = 0;
  const rows = await db
    .select({ id: webSearches.id, tool: webSearches.tool, queryOrUrl: webSearches.queryOrUrl, results: webSearches.results })
    .from(webSearches)
    .where(inArray(webSearches.id, ids));
  for (const row of rows) {
    const candidates = new Set<string>();
    for (const res of row.results) {
      for (const v of urlVariants(res.url)) candidates.add(v);
    }
    if (row.tool === "web_fetch") {
      for (const v of urlVariants(row.queryOrUrl)) candidates.add(v);
    }
    if (candidates.size === 0) continue;
    const list = [...candidates];
    const updated = await db
      .update(sources)
      .set({ webSearchId: row.id })
      .where(
        and(
          eq(sources.runId, run.id),
          isNull(sources.webSearchId),
          or(inArray(sources.url, list), inArray(sources.finalUrl, list)),
        ),
      )
      .returning({ id: sources.id });
    linked += updated.length;
  }
  return { inserted: ids.length, linked };
}

/** Drop and re-ingest a run's searches (backfills, retries of the reader). */
export async function clearRunSearches(db: Db, runId: string): Promise<void> {
  await db.update(sources).set({ webSearchId: null }).where(eq(sources.runId, runId));
  await db.delete(webSearches).where(eq(webSearches.runId, runId));
}
