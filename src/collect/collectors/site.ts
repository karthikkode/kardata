import { load } from "cheerio";
import { getRobotsTxt, type FetchResult } from "../fetch.js";
import type { AreaOutcome, Collector, CollectorCtx, CollectorResult, FetchedPage, PageLink } from "./types.js";
import {
  collectFetch,
  fetchFailure,
  siteBase,
  toFetchedPage,
  writeExtract,
} from "./util.js";

export const SITE_MAX_PAGES = 12;
export const SITE_MAX_NESTED_SITEMAPS = 3;
const SITEMAP_URL_CAP = 2000;

type PageClass =
  | "about"
  | "press"
  | "careers"
  | "wholesale"
  | "subscribe"
  | "faq"
  | "reviews";

const CLASS_ORDER: PageClass[] = [
  "about",
  "press",
  "careers",
  "wholesale",
  "subscribe",
  "faq",
  "reviews",
];

const CLASS_PATTERNS: { class: PageClass; re: RegExp }[] = [
  { class: "about", re: /\/(about|about-us|our-story|ourstory|story|mission|who-we-are|team|values)(\/|$|\?|\s)/ },
  { class: "press", re: /\/(press|news|blog|journal|media|articles?|updates?)(\/|$|\?|\s)/ },
  { class: "careers", re: /\/(careers?|jobs?|join(-us)?|hiring|work-with-us|opportunities)(\/|$|\?|\s)/ },
  {
    class: "wholesale",
    re: /\/(wholesale|stockists?|retailers?|where-to-buy|find-in-store|store-locator|find-a-store)(\/|$|\?|\s)/,
  },
  { class: "subscribe", re: /\/(subscribe|subscription|join-the-club|membership)(\/|$|\?|\s)/ },
  {
    class: "faq",
    re: /\/(faqs?|help|support|shipping|delivery|returns?|refund-policy|shipping-policy|contact)(\/|$|\?|\s)/,
  },
  { class: "reviews", re: /\/(reviews?|testimonials)(\/|$|\?|\s)/ },
];

const PRODUCT_URL_RE = /\/(products?|p|shop)(\/|$|\?|\s)/;
const SOCIAL_HOSTS = [
  "facebook.com",
  "instagram.com",
  "twitter.com",
  "x.com",
  "tiktok.com",
  "youtube.com",
  "linkedin.com",
  "pinterest.com",
];

const CLASS_LABELS: Record<PageClass, string> = {
  about: "About",
  press: "Press / blog",
  careers: "Careers",
  wholesale: "Wholesale / stockists",
  subscribe: "Subscribe",
  faq: "FAQ / shipping / returns",
  reviews: "Reviews",
};

const BUSINESS_MODEL_CLASSES: PageClass[] = ["about", "wholesale", "subscribe", "faq"];

function classify(pathAndText: string): PageClass | null {
  const hay = pathAndText.toLowerCase();
  for (const { class: cls, re } of CLASS_PATTERNS) {
    if (re.test(hay)) return cls;
  }
  return null;
}

function sameOrigin(url: string, base: URL): boolean {
  try {
    return new URL(url).host === base.host;
  } catch {
    return false;
  }
}

function sitemapLocs(xml: string, tag: string): string[] {
  const $ = load(xml, { xmlMode: true });
  const locs: string[] = [];
  $(tag).each((_, el) => {
    const loc = $(el).find("loc").first().text().trim();
    if (loc !== "" && locs.length < SITEMAP_URL_CAP) locs.push(loc);
  });
  return locs;
}

function excerpt(text: string, max = 800): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max)}…` : clean;
}

function jsonLdType(block: unknown): string {
  if (typeof block !== "object" || block === null) return "";
  const t = (block as Record<string, unknown>)["@type"];
  if (typeof t === "string") return t;
  if (Array.isArray(t) && typeof t[0] === "string") return t[0];
  return "";
}

interface PageFailure {
  class: PageClass;
  url: string;
  status: string;
}

function failureOutcome(failures: PageFailure[], classes: PageClass[]): AreaOutcome | null {
  const relevant = failures.filter((f) => classes.includes(f.class));
  if (relevant.length === 0) return null;
  const blocked = relevant.filter(
    (f) => f.status === "blocked" || f.status === "robots_disallowed",
  );
  if (blocked.length > 0) {
    const first = blocked[0] as PageFailure;
    return {
      area: "business_model",
      status: "blocked",
      reason: `${first.url} ${first.status}`,
    };
  }
  const errored = relevant.filter((f) => f.status === "error");
  if (errored.length > 0) {
    const first = errored[0] as PageFailure;
    return { area: "business_model", status: "error", reason: `${first.url} ${first.status}` };
  }
  return {
    area: "business_model",
    status: "not_found",
    reason: `all ${relevant.length} page(s) returned not_found`,
  };
}

export const siteCollector: Collector = {
  name: "site",
  areas: ["business_model", "decisions", "hiring"],
  run: async (ctx: CollectorCtx) => {
    const base = siteBase(ctx);
    if (!base) {
      const reason = "company has no website or domain";
      ctx.shared.site = { pages: [], productUrls: [], sitemapUrls: [], socialLinks: [] };
      return {
        outcomes: [
          { area: "business_model", status: "not_found", reason },
          { area: "decisions", status: "not_found", reason },
          { area: "hiring", status: "not_found", reason },
        ],
      };
    }
    const baseUrl = new URL(base);

    const robots = await getRobotsTxt(ctx.db, {
      runId: ctx.runId,
      companyId: ctx.companyId,
      collector: "site",
      url: base,
      privateHostAllowlist: ctx.privateHostAllowlist,
    });

    const homeRes = await collectFetch(ctx, "site", `${base}/`);
    if (!homeRes.text || homeRes.source.status !== "ok") {
      const message = fetchFailure(homeRes);
      ctx.shared.site = {
        pages: [],
        productUrls: [],
        sitemapUrls: [],
        socialLinks: [],
        homepageFailed: `${homeRes.source.url} ${message}`,
      };
      const status =
        homeRes.source.status === "blocked" || homeRes.source.status === "robots_disallowed"
          ? "blocked"
          : homeRes.source.status === "error"
            ? "error"
            : "not_found";
      const reason = `homepage ${message}`;
      const outcomes = [
        { area: "business_model", status, reason },
        { area: "decisions", status, reason },
        { area: "hiring", status, reason },
      ] as CollectorResult["outcomes"];
      // A bot wall is not fatal: the site exists, so Apollo facts still land
      // and the research agent gets its chance with the browser fallback.
      // Dead, erroring and robots-forbidden homepages still stop the run.
      if (homeRes.source.status === "blocked") return { outcomes };
      return {
        fatal: `homepage fetch failed: ${homeRes.source.url} ${message}`,
        outcomes,
      };
    }
    const homepage = toFetchedPage(
      homeRes.source.url,
      homeRes.source.finalUrl,
      homeRes.source.id,
      homeRes.text,
    );

    // Sitemap: robots-advertised sitemaps plus /sitemap.xml, nested sitemaps at most 3.
    const sitemapUrls: string[] = [];
    const seenSitemap = new Set<string>();
    const addSitemapUrl = (u: string) => {
      if (!seenSitemap.has(u) && sitemapUrls.length < SITEMAP_URL_CAP) {
        seenSitemap.add(u);
        sitemapUrls.push(u);
      }
    };
    let nestedFetched = 0;
    const readSitemap = async (url: string): Promise<void> => {
      const res: FetchResult = await collectFetch(ctx, "site", url, {
        accept: "application/xml,text/xml;q=0.9,*/*;q=0.8",
      });
      if (res.source.status !== "ok" || !res.text) return;
      const nested = sitemapLocs(res.text, "sitemapindex > sitemap");
      if (nested.length > 0) {
        for (const loc of nested) {
          if (nestedFetched >= SITE_MAX_NESTED_SITEMAPS) break;
          nestedFetched += 1;
          await readSitemap(loc);
        }
        return;
      }
      for (const loc of sitemapLocs(res.text, "urlset > url")) addSitemapUrl(loc);
    };
    for (const loc of robots.sitemaps) {
      if (sameOrigin(loc, baseUrl)) await readSitemap(loc);
      if (nestedFetched >= SITE_MAX_NESTED_SITEMAPS) break;
    }
    await readSitemap(`${base}/sitemap.xml`);

    // Candidates: sitemap URLs plus same-origin homepage links.
    const candidates = new Map<string, string>();
    for (const u of sitemapUrls) {
      if (sameOrigin(u, baseUrl)) candidates.set(u, u);
    }
    for (const link of homepage.links) {
      if (sameOrigin(link.href, baseUrl) && !candidates.has(link.href)) {
        candidates.set(link.href, `${link.href} ${link.text}`);
      }
    }
    if (candidates.has(`${base}/`)) candidates.delete(`${base}/`);

    const productUrls = sitemapUrls.filter(
      (u) => sameOrigin(u, baseUrl) && PRODUCT_URL_RE.test(new URL(u).pathname.toLowerCase()),
    );

    const byClass = new Map<PageClass, string[]>();
    for (const cls of CLASS_ORDER) byClass.set(cls, []);
    for (const [url, hay] of candidates) {
      const cls = classify(`${new URL(url).pathname} ${hay}`);
      if (cls) byClass.get(cls)?.push(url);
    }

    // Round-robin across classes so one big blog cannot starve the rest.
    const picked: { class: PageClass; url: string }[] = [];
    const seen = new Set<string>();
    let progress = true;
    while (picked.length < SITE_MAX_PAGES && progress) {
      progress = false;
      for (const cls of CLASS_ORDER) {
        if (picked.length >= SITE_MAX_PAGES) break;
        const next = (byClass.get(cls) ?? []).find((u) => !seen.has(u));
        if (next) {
          seen.add(next);
          picked.push({ class: cls, url: next });
          progress = true;
        }
      }
    }

    const pages: { class: PageClass; page: FetchedPage }[] = [];
    const failures: PageFailure[] = [];
    for (const { class: cls, url } of picked) {
      const res = await collectFetch(ctx, "site", url);
      if (res.source.status === "ok" && res.text) {
        pages.push({
          class: cls,
          page: toFetchedPage(res.source.url, res.source.finalUrl, res.source.id, res.text),
        });
      } else {
        failures.push({ class: cls, url, status: res.source.status });
      }
    }

    const socialLinks: PageLink[] = homepage.links.filter((l) => {
      try {
        const host = new URL(l.href).hostname.toLowerCase().replace(/^www\./, "");
        return SOCIAL_HOSTS.some((s) => host === s || host.endsWith(`.${s}`));
      } catch {
        return false;
      }
    });

    ctx.shared.site = {
      homepage,
      pages,
      productUrls: [...new Set(productUrls)],
      sitemapUrls,
      socialLinks,
    };

    const orgBlocks = [homepage, ...pages.map((p) => p.page)]
      .flatMap((p) => p.jsonLd)
      .filter((b) => jsonLdType(b).toLowerCase() === "organization");
    const org = orgBlocks[0] as Record<string, unknown> | undefined;

    const section = (cls: PageClass): string => {
      const mine = pages.filter((p) => p.class === cls);
      if (mine.length === 0) return "";
      const lines = [`## ${CLASS_LABELS[cls]}`, ""];
      for (const { page } of mine) {
        lines.push(`### ${page.title || page.url}`, "", page.url, "", excerpt(page.text), "");
        if (cls === "careers") {
          const boardLinks = page.links.filter((l) =>
            /greenhouse|lever\.co|ashbyhq|workable/i.test(l.href),
          );
          for (const l of boardLinks) lines.push(`- Job board link: ${l.href}`, "");
        }
      }
      return `${lines.join("\n")}\n`;
    };

    const outcomes: AreaOutcome[] = [];
    const areaDocs: { area: "business_model" | "decisions" | "hiring"; classes: PageClass[] }[] = [
      { area: "business_model", classes: BUSINESS_MODEL_CLASSES },
      { area: "decisions", classes: ["press"] },
      { area: "hiring", classes: ["careers"] },
    ];
    for (const { area, classes } of areaDocs) {
      const mine = pages.filter((p) => classes.includes(p.class));
      if (mine.length > 0) {
        const seenClasses = [...new Set(mine.map((p) => p.class))];
        let content = seenClasses.map((c) => section(c)).join("\n");
        if (area === "business_model") {
          const extra: string[] = [];
          if (org) {
            const name = typeof org["name"] === "string" ? org["name"] : "";
            extra.push("## Organization (JSON-LD)", "", name !== "" ? name : "(unnamed)", "");
          }
          if (socialLinks.length > 0) {
            extra.push(
              "## Social links",
              "",
              ...socialLinks.map((l) => `- ${l.href}`),
              "",
            );
          }
          content += `\n${extra.join("\n")}`;
        }
        const docPath =
          area === "business_model"
            ? "business_model/site.md"
            : area === "decisions"
              ? "decisions/site-press.md"
              : "hiring/site-careers.md";
        await writeExtract(
          ctx,
          "site",
          docPath,
          `Site ${area.replace("_", " ")}`,
          content,
          mine.map((p) => p.page.sourceId),
        );
        outcomes.push({ area, status: "done" });
      } else {
        const failed = failureOutcome(failures, classes);
        if (failed) {
          outcomes.push({ ...failed, area });
        } else {
          const labels = classes.map((c) => CLASS_LABELS[c]).join(", ");
          outcomes.push({ area, status: "not_found", reason: `no ${labels} pages found` });
        }
      }
    }
    return { outcomes };
  },
};
