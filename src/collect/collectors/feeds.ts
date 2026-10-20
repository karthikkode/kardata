import { load } from "cheerio";
import type { UpsertRecordItem } from "../../domain/research/records.js";
import type { Collector, CollectorCtx } from "./types.js";
import { collectFetch, siteBase, writeExtract, writeRecords } from "./util.js";

const FEEDS_MAX = 3;

interface FeedItem {
  title: string;
  link: string;
  date: string | null;
}

function parseFeed(xml: string): FeedItem[] {
  const $ = load(xml, { xmlMode: true });
  const items: FeedItem[] = [];
  $("rss channel item, feed entry").each((_, el) => {
    const title = $(el).find("title").first().text().trim();
    let link = $(el).find("link").first().text().trim();
    if (link === "") link = $(el).find("link").first().attr("href")?.trim() ?? "";
    if (link === "") link = $(el).find("id").first().text().trim();
    const date =
      $(el).find("pubDate").first().text().trim() ||
      $(el).find("published").first().text().trim() ||
      $(el).find("updated").first().text().trim() ||
      null;
    if (title !== "") items.push({ title: title.slice(0, 300), link, date });
  });
  return items;
}

export const feedsCollector: Collector = {
  name: "feeds",
  areas: ["decisions"],
  run: async (ctx: CollectorCtx) => {
    const site = ctx.shared.site;
    const base = siteBase(ctx);
    if (!site?.homepage || !base) {
      return {
        outcomes: [
          {
            area: "decisions",
            status: site?.homepageFailed ? "blocked" : "not_found",
            reason: site?.homepageFailed
              ? `no homepage content: ${site.homepageFailed}`
              : "no homepage content",
          },
        ],
      };
    }
    const found: string[] = [];
    const seen = new Set<string>();
    const add = (u: string) => {
      if (!seen.has(u) && found.length < FEEDS_MAX) {
        seen.add(u);
        found.push(u);
      }
    };
    // <link rel="alternate"> feeds on the homepage.
    const $ = load(site.homepage.html);
    $('link[rel="alternate"]').each((_, el) => {
      const type = ($(el).attr("type") ?? "").toLowerCase();
      const href = $(el).attr("href")?.trim() ?? "";
      if (href === "") return;
      if (type.includes("rss") || type.includes("atom") || type.includes("xml")) {
        try {
          add(new URL(href, site.homepage?.finalUrl ?? base).href);
        } catch {
          // ignore unparseable href
        }
      }
    });
    // Shopify blog handles from the sitemap: /blogs/<handle>.atom.
    for (const u of site.sitemapUrls) {
      if (found.length >= FEEDS_MAX) break;
      let path: string;
      try {
        path = new URL(u).pathname;
      } catch {
        continue;
      }
      const match = /^\/blogs\/([^/]+)/i.exec(path);
      if (match?.[1]) {
        try {
          add(new URL(`/blogs/${match[1]}.atom`, base).href);
        } catch {
          // ignore
        }
      }
    }

    if (found.length === 0) {
      return {
        outcomes: [{ area: "decisions", status: "not_found", reason: "no feeds found" }],
      };
    }
    const cutoff = new Date();
    cutoff.setMonth(cutoff.getMonth() - 24);
    const lines: string[] = [];
    const sourceIds: string[] = [];
    const recordItems: UpsertRecordItem[] = [];
    let kept = 0;
    for (const url of found) {
      const res = await collectFetch(ctx, "feeds", url, {
        accept: "application/rss+xml,application/atom+xml,application/xml;q=0.9",
      });
      if (res.source.status !== "ok" || !res.text) continue;
      sourceIds.push(res.source.id);
      const recent = parseFeed(res.text).filter((item) => {
        if (!item.date) return false;
        const d = new Date(item.date);
        return !Number.isNaN(d.getTime()) && d >= cutoff;
      });
      recent.sort((a, b) => String(b.date).localeCompare(String(a.date)));
      lines.push(`Feed: ${url}`, "");
      for (const item of recent.slice(0, 50)) {
        kept += 1;
        lines.push(`- ${item.date} — ${item.title}${item.link !== "" ? ` (${item.link})` : ""}`);
        if (item.link !== "" && /^https?:\/\//i.test(item.link)) {
          const d = new Date(item.date as string);
          recordItems.push({
            type: "blog_post",
            data: {
              title: item.title,
              url: item.link,
              published_at: d.toISOString().slice(0, 10),
            },
            sourceIds: [res.source.id],
          });
        }
      }
      lines.push("");
    }
    if (kept === 0) {
      return {
        outcomes: [
          { area: "decisions", status: "not_found", reason: "no recent posts in company feeds" },
        ],
      };
    }
    await writeExtract(ctx, "feeds", "decisions/company-feeds.md", "Company news feeds", lines.join("\n"), sourceIds);
    await writeRecords(ctx, "feeds", recordItems);
    return { outcomes: [{ area: "decisions", status: "done" }] };
  },
};
