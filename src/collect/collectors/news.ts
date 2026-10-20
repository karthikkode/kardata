import type { UpsertRecordItem } from "../../domain/research/records.js";
import type { Collector, CollectorCtx } from "./types.js";
import { collectFetch, fetchFailure, writeExtract, writeRecords } from "./util.js";

// GDELT DOC 2.0 API: GET {base}/api/v2/doc/doc?query=...&mode=artlist&format=json&maxrecords=N&sort=datedesc
// covers roughly the last 3 months; beware the ~1 request per 5 seconds throttle (https://blog.gdeltproject.org/gdelt-doc-2-0-api-debuts/).

const GDELT_MAX_RECORDS = 100;

interface GdeltArticle {
  date: string;
  outlet: string;
  title: string;
  url: string;
}

function toDateOnly(value: string): string | undefined {
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(value);
  if (!match?.[1]) return undefined;
  const d = new Date(`${match[1]}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === match[1] ? match[1] : undefined;
}

export const newsCollector: Collector = {
  name: "news",
  areas: ["decisions"],
  run: async (ctx: CollectorCtx) => {
    const name = ctx.effective.name?.trim() ?? "";
    const domain = ctx.effective.domain?.trim() ?? "";
    if (name === "" && domain === "") {
      return {
        outcomes: [
          { area: "decisions", status: "not_found", reason: "no company name or domain to query" },
        ],
      };
    }
    // GDELT rejects OR'd terms outside parens (HTTP 200 with an error body),
    // so the query is always parenthesized; stray quotes would break it.
    const clean = (s: string) => s.replace(/"/g, "").trim();
    const clauses = [`"${clean(name)}"`, clean(domain)].filter((c) => c !== "" && c !== '""');
    const query = `(${clauses.join(" OR ")})`;
    const url =
      `${ctx.endpoints.gdelt}/api/v2/doc/doc?` +
      `query=${encodeURIComponent(query)}&mode=artlist&format=json` +
      `&maxrecords=${GDELT_MAX_RECORDS}&sort=datedesc`;
    const res = await collectFetch(ctx, "news", url, { accept: "application/json" });
    if (res.source.status !== "ok" || !res.text) {
      const status =
        res.source.status === "blocked" || res.source.status === "robots_disallowed"
          ? "blocked"
          : res.source.status === "error"
            ? "error"
            : "not_found";
      return {
        outcomes: [{ area: "decisions", status, reason: `GDELT: ${fetchFailure(res)}` }],
      };
    }
    let articles: GdeltArticle[] = [];
    try {
      const parsed = JSON.parse(res.text) as { articles?: Record<string, unknown>[] };
      const list = Array.isArray(parsed?.articles) ? parsed.articles : [];
      articles = list.map((a) => ({
        date: typeof a["seendate"] === "string" ? a["seendate"] : "",
        outlet: typeof a["domain"] === "string" ? a["domain"] : "",
        title: typeof a["title"] === "string" ? a["title"] : "",
        url: typeof a["url"] === "string" ? a["url"] : "",
      }));
    } catch {
      return {
        outcomes: [{ area: "decisions", status: "error", reason: res.text.slice(0, 200) }],
      };
    }
    const needles = [name.toLowerCase(), domain.toLowerCase()].filter((n) => n !== "");
    const kept = articles.filter((a) =>
      needles.some(
        (n) => a.title.toLowerCase().includes(n) || a.url.toLowerCase().includes(n),
      ),
    );
    if (kept.length === 0) {
      return {
        outcomes: [
          {
            area: "decisions",
            status: "not_found",
            reason: `no matching articles (${articles.length} returned, none mention the company)`,
          },
        ],
      };
    }
    const lines = ["Unverified mentions — the name may be ambiguous", ""];
    for (const a of kept) {
      lines.push(`- ${a.date} ${a.outlet}: ${a.title} (${a.url})`);
    }
    await writeExtract(ctx, "news", "decisions/press-mentions.md", "Press mentions (GDELT)", lines.join("\n"), [
      res.source.id,
    ]);
    const sourceIds = [res.source.id];
    const recordItems: UpsertRecordItem[] = kept
      .filter((a) => a.url !== "" && a.title !== "" && /^https?:\/\//i.test(a.url))
      .map((a) => ({
        type: "news_item",
        data: {
          title: a.title,
          ...(a.outlet !== "" ? { outlet: a.outlet } : {}),
          url: a.url,
          ...(toDateOnly(a.date) ? { published_at: toDateOnly(a.date) as string } : {}),
          verified: false,
        },
        sourceIds,
      }));
    await writeRecords(ctx, "news", recordItems);
    return { outcomes: [{ area: "decisions", status: "done" }] };
  },
};
