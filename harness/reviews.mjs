/**
 * On-site reviews job (Stage 4.1 Step 2). Runs inside the kardata-agent image
 * (it has Chromium); the server starts one container per collect and reads
 * JSON from stdout. No LLM, no MCP, no secrets.
 *
 * Split for testability: the pure parser half (detect + parse) runs on the
 * host under vitest against fixture pages; only main() needs playwright-core
 * and Chromium, resolved lazily so imports stay light.
 *
 * Identity rule: the parser only ever selects text/title/rating/date nodes.
 * Author, avatar and profile nodes are never read; the server-side
 * reviews_ingest strips identity fields anyway.
 */
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { load } = require("cheerio");

export const SUPPORTED_VENDORS = ["judgeme", "yotpo", "stamped", "okendo", "loox", "junip", "reviewsio"];

// Script-src and DOM markers per vendor, in detection priority order.
const VENDOR_SIGNALS = [
  { vendor: "judgeme", scripts: ["judge.me", "judgeme", "jdgm"], dom: ["#judgeme_product_reviews", ".jdgm-widget", ".jdgm-rev"] },
  { vendor: "yotpo", scripts: ["yotpo"], dom: ["#yotpo-reviews", ".yotpo-reviews", ".yotpo-review"] },
  { vendor: "stamped", scripts: ["stamped.io"], dom: ["#stamped-main-widget", ".stamped-review"] },
  { vendor: "okendo", scripts: ["okendo"], dom: ["[data-oke-widget]", ".okeReviews"] },
  { vendor: "loox", scripts: ["loox"], dom: ["#looxReviews", ".loox-review"] },
  { vendor: "junip", scripts: ["junip"], dom: ["[data-junip]", ".junip-product-review"] },
  { vendor: "reviewsio", scripts: ["reviews.io", "ratingsandreviews"], dom: [".reviewsio", "#reviewsio-product-widget"] },
];

// "Load more" / pagination controls per vendor, tried in order.
export const MORE_SELECTORS = {
  judgeme: [".jdgm-paginate__next-page", ".jdgm-paginate__last-page", ".jdgm-paginate__page:not(.jdgm-current)"],
  yotpo: [".yotpo-reviews-pagination .yotpo-next", ".yotpo-pager .goTo", "input[value='Load More Reviews']", ".yotpo-default-button"],
  stamped: ["#stamped-button-more", ".stamped-pagination a"],
  okendo: [".oke-pagination-button--next", "[data-oke-pagination-next]"],
  loox: [".loox-pagination-button", "#looxReviews .loox-more"],
  junip: ["[data-junip-load-more]", ".junip-pagination-next"],
  reviewsio: [".reviewsio-load-more", ".reviewsio-pagination-next"],
};

const REVIEW_ITEMS = {
  judgeme: ".jdgm-rev",
  yotpo: ".yotpo-review",
  stamped: ".stamped-review",
  okendo: ".oke-reviewItem",
  loox: ".loox-review",
  junip: ".junip-product-review",
  reviewsio: ".reviewsio-product-review",
};

function clean(text) {
  return String(text ?? "").replace(/\s+/g, " ").trim();
}

function firstText($item, selectors) {
  for (const sel of selectors) {
    const t = clean($item.find(sel).first().text());
    if (t !== "") return t;
  }
  return "";
}

function countFilled($item, filledSel, emptySel) {
  let nodes = $item.find(filledSel);
  if (emptySel) nodes = nodes.not(emptySel);
  return nodes.length > 0 ? nodes.length : null;
}

/** Vendor key (or null) plus the signals that fired. */
export function detectVendor(html) {
  const $ = load(html);
  const srcs = $("script[src]")
    .map((_, el) => String($(el).attr("src") ?? "").toLowerCase())
    .get()
    .join("\n");
  for (const { vendor, scripts, dom } of VENDOR_SIGNALS) {
    const scriptHit = scripts.filter((s) => srcs.includes(s));
    const domHit = dom.filter((d) => $(d).length > 0);
    if (scriptHit.length > 0 || domHit.length > 0) {
      return { vendor, signals: [...scriptHit, ...domHit] };
    }
  }
  return { vendor: null, signals: [] };
}

function ratingFromStars($item, vendor) {
  if (vendor === "judgeme") {
    const score = $item.find(".jdgm-rev__rating").first().attr("data-score");
    if (score !== undefined && Number.isFinite(Number(score))) return Number(score);
    const on = $item.find(".jdgm-star.jdgm--on, .jdgm-star.jdgm--half").length;
    return on > 0 ? on : null;
  }
  if (vendor === "yotpo") {
    const n = countFilled($item, ".yotpo-review-stars .yotpo-icon-star", ".yotpo-review-stars .yotpo-icon-empty-star");
    if (n !== null) return n;
    const sr = countFilled($item, ".yotpo-star-rating .yotpo-sr-star-full", null);
    if (sr !== null) return sr;
    const score = $item.attr("data-score");
    return score !== undefined && Number.isFinite(Number(score)) ? Number(score) : null;
  }
  if (vendor === "stamped") {
    const attr = $item.attr("data-rating") ?? $item.find("[data-rating]").first().attr("data-rating");
    if (attr !== undefined && Number.isFinite(Number(attr))) return Number(attr);
    const n = countFilled($item, ".stamped-fa-star", ".stamped-fa-star-o");
    return n;
  }
  if (vendor === "okendo") {
    const attr =
      $item.attr("data-oke-star-rating") ?? $item.find("[data-oke-star-rating]").first().attr("data-oke-star-rating");
    if (attr !== undefined && Number.isFinite(Number(attr))) return Number(attr);
    return countFilled($item, ".oke-stars .oke-star--full", null);
  }
  if (vendor === "loox") {
    const attr = $item.attr("data-loox-rating") ?? $item.find("[data-rating]").first().attr("data-rating");
    if (attr !== undefined && Number.isFinite(Number(attr))) return Number(attr);
    return countFilled($item, ".loox-star:not(.loox-star--empty)", null);
  }
  if (vendor === "junip") {
    const attr = $item.attr("data-rating") ?? $item.find("[data-rating]").first().attr("data-rating");
    return attr !== undefined && Number.isFinite(Number(attr)) ? Number(attr) : null;
  }
  if (vendor === "reviewsio") {
    const attr = $item.attr("data-rating") ?? $item.find("[data-rating]").first().attr("data-rating");
    return attr !== undefined && Number.isFinite(Number(attr)) ? Number(attr) : null;
  }
  return null;
}

const FIELD_SELECTORS = {
  judgeme: {
    text: [".jdgm-rev__body"],
    title: [".jdgm-rev__title"],
    date: [".jdgm-rev__timestamp"],
    verified: [".jdgm-rev__buyer-badge", ".jdgm-rev__verified"],
  },
  yotpo: {
    text: [".yotpo-review-content", ".content-review"],
    title: [".yotpo-review-title", ".content-title"],
    // v3 nests "Published date" + .yotpo-date-format inside .yotpo-review-date.
    date: [".yotpo-date-format", ".yotpo-review-date"],
    verified: [".yotpo-reviewer-verified-buyer", ".yotpo-verified-buyer", ".yotpo-reviewer-verified-buyer-text"],
  },
  stamped: {
    text: [".stamped-review-content-body"],
    title: [".stamped-review-header-title"],
    date: [".stamped-review-footer .date", ".stamped-review .created"],
    verified: [".verified"],
  },
  okendo: {
    text: [".oke-reviewItem-content", "[itemprop='reviewBody']"],
    title: [".oke-reviewItem-title"],
    date: ["[itemprop='datePublished']", ".oke-reviewItem-date"],
    verified: [".oke-verifiedTick", "[data-oke-verified]"],
  },
  loox: {
    text: [".loox-review-text", "[data-loox-review-text]", ".loox-review-content"],
    title: [".loox-review-title"],
    date: [".loox-review-date", "[data-loox-review-date]"],
    verified: [".loox-verified-buyer", "[data-loox-verified]"],
  },
  junip: {
    text: ["[data-junip-body]", ".junip-review-body"],
    title: ["[data-junip-title]", ".junip-review-title"],
    date: ["[data-junip-date]", ".junip-review-date"],
    verified: ["[data-junip-verified]"],
  },
  reviewsio: {
    text: [".reviewsio-review-text", "[itemprop='reviewBody']"],
    title: [".reviewsio-review-title"],
    date: [".reviewsio-review-date", "[itemprop='datePublished']"],
    verified: [".reviewsio-verified"],
  },
};

/** One vendor's widget reviews from a rendered page. Never reads identity nodes. */
export function parseWidgetReviews(html, vendor) {
  const fields = FIELD_SELECTORS[vendor];
  if (!fields) return [];
  const $ = load(html);
  const out = [];
  $(REVIEW_ITEMS[vendor]).each((_, el) => {
    const $item = $(el);
    const text = firstText($item, fields.text);
    if (text === "") return;
    const review = { text, rating_scale: 5 };
    const title = firstText($item, fields.title);
    if (title !== "") review.title = title;
    const rating = ratingFromStars($item, vendor);
    if (rating !== null && rating >= 0 && rating <= 5) review.rating = rating;
    const date = firstText($item, fields.date);
    if (date !== "") review.date = date;
    const verified =
      fields.verified.some((sel) => $item.find(sel).length > 0) || /verified/i.test(clean($item.text()).slice(0, 400));
    if (verified) review.verified_buyer = true;
    out.push(review);
  });
  return out;
}

/** schema.org Review blocks (JSON-LD), the fallback source. Authors are ignored. */
export function parseJsonLdReviews(html) {
  const $ = load(html);
  const out = [];
  const visit = (node) => {
    if (Array.isArray(node)) {
      for (const n of node) visit(n);
      return;
    }
    if (typeof node !== "object" || node === null) return;
    const types = Array.isArray(node["@type"]) ? node["@type"] : [node["@type"]];
    if (types.includes("Review")) {
      const text = clean(node["reviewBody"]);
      if (text !== "") {
        const review = { text, rating_scale: 5 };
        const name = clean(node["name"]);
        if (name !== "") review.title = name;
        const rating = node["reviewRating"];
        const value =
          typeof rating === "object" && rating !== null ? Number(rating["ratingValue"]) : Number(rating);
        if (Number.isFinite(value)) {
          review.rating = value;
          const best =
            typeof rating === "object" && rating !== null ? Number(rating["bestRating"]) : Number.NaN;
          if (Number.isFinite(best) && best > 0) review.rating_scale = best;
        }
        const date = clean(node["datePublished"]);
        if (date !== "") review.date = date;
        out.push(review);
      }
    }
    for (const value of Object.values(node)) {
      if (typeof value === "object" && value !== null) visit(value);
    }
  };
  $("script[type='application/ld+json']").each((_, el) => {
    try {
      visit(JSON.parse($(el).text()));
    } catch {
      // Malformed JSON-LD is common; skip the block.
    }
  });
  return out;
}

function dedupe(reviews) {
  const seen = new Set();
  const out = [];
  for (const r of reviews) {
    const key = r.text.toLowerCase().replace(/\s+/g, " ").trim();
    if (key === "" || seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
}

const ARIA_RATING = /(\d+(?:\.\d+)?)\s+out of\s+(\d+)\s+stars?/i;
// No \b guards: text nodes concatenate without spaces in cheerio .text()
// ("Buyer10/13/2026"), so only digit-adjacency is excluded.
const DATE_PATTERNS = [
  /(?<!\d)\d{4}-\d{2}-\d{2}(?!\d)/,
  /(?<!\d)\d{1,2}\/\d{1,2}\/\d{2,4}(?!\d)/,
  /(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{1,2},?\s+\d{4}/i,
];

/**
 * Fallback for custom-theme review cards: some stores render the vendor's
 * data in their own markup. Structural signals only — an <article> carrying
 * an accessible star rating ("N out of M stars" aria-label) plus a date.
 * Rating, date and body text must all be present or the card is skipped.
 */
export function parseAccessibleReviewCards(html) {
  const $ = load(html);
  const out = [];
  $("article").each((_, el) => {
    const $item = $(el);
    let rating = null;
    let scale = 5;
    $item.find("[aria-label]").each((_, labeled) => {
      if (rating !== null) return;
      const m = ARIA_RATING.exec(String($(labeled).attr("aria-label") ?? ""));
      if (m) {
        rating = Number(m[1]);
        scale = Number(m[2]) > 0 ? Number(m[2]) : 5;
      }
    });
    if (rating === null || rating < 0 || rating > scale) return;
    const body = clean($item.text());
    let date = "";
    for (const pattern of DATE_PATTERNS) {
      const m = pattern.exec(body);
      if (m) {
        date = m[0];
        break;
      }
    }
    if (date === "") return;
    let text = "";
    $item.find("p").each((_, p) => {
      const t = clean($(p).text());
      if (t.length > text.length) text = t;
    });
    if (text === "") return;
    const review = { text, rating, rating_scale: scale, date };
    if (/verified/i.test(body.slice(0, 500))) review.verified_buyer = true;
    out.push(review);
  });
  return out;
}

/** Detect the widget, parse it, and merge JSON-LD reviews, deduped by text. */
export function collectPageReviews(html) {
  const { vendor, signals } = detectVendor(html);
  let widget = vendor ? parseWidgetReviews(html, vendor) : [];
  if (vendor && widget.length === 0) widget = parseAccessibleReviewCards(html);
  const jsonLd = parseJsonLdReviews(html);
  return { vendor, signals, reviews: dedupe([...widget, ...jsonLd]) };
}

function resolvePlaywright() {
  const candidates = [
    (() => {
      try {
        return require.resolve("playwright-core");
      } catch {
        return null;
      }
    })(),
    "/usr/local/lib/node_modules/@playwright/mcp/node_modules/playwright-core",
  ].filter(Boolean);
  for (const name of candidates) {
    try {
      return require(name);
    } catch {
      // try the next candidate
    }
  }
  throw new Error("playwright-core not found (image needs @playwright/mcp installed)");
}

async function scrollToBottom(page) {
  await page.evaluate(`(async () => {
    const distance = () => document.body.scrollHeight;
    let last = 0;
    for (let i = 0; i < 20 && distance() !== last; i++) {
      last = distance();
      window.scrollTo(0, last);
      await new Promise((r) => setTimeout(r, 250));
    }
  })()`);
}

async function clickMore(page, vendor) {
  for (const sel of MORE_SELECTORS[vendor] ?? []) {
    const handle = await page.$(sel).catch(() => null);
    if (!handle) continue;
    const visible = await handle.isVisible().catch(() => false);
    if (!visible) continue;
    const box = await handle.boundingBox().catch(() => null);
    if (!box) continue;
    await handle.scrollIntoViewIfNeeded().catch(() => undefined);
    await handle.click({ timeout: 5000 }).catch(() => undefined);
    return true;
  }
  // Generic fallback: a visible "load more" style control (custom themes).
  for (const role of ["button", "link"]) {
    const control = page.getByRole(role, { name: /load more|show more|more reviews/i }).first();
    const visible = await control.isVisible().catch(() => false);
    if (!visible) continue;
    await control.scrollIntoViewIfNeeded().catch(() => undefined);
    await control.click({ timeout: 5000 }).catch(() => undefined);
    return true;
  }
  return false;
}

async function scrapePage(browser, page, vendorHint) {
  const client = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36 KardataReviews/1.0",
    locale: "en-US",
  });
  const tab = await client.newPage();
  try {
    await tab.goto(page.url, { waitUntil: "domcontentloaded", timeout: 45000 });
    await tab.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => undefined);
    let html = await tab.content();
    let { vendor } = collectPageReviews(html);
    vendor = vendor ?? vendorHint;
    let reviews = [];
    for (let round = 0; round < 14; round++) {
      await scrollToBottom(tab);
      await tab.waitForTimeout(700);
      html = await tab.content();
      const parsed = collectPageReviews(html);
      if (parsed.vendor) vendor = parsed.vendor;
      reviews = parsed.reviews;
      if (reviews.length === 0 && !vendor) break;
      if (!(await clickMore(tab, vendor ?? ""))) {
        // One more scroll pass in case reviews lazy-load without a button.
        await scrollToBottom(tab);
        await tab.waitForTimeout(700);
        html = await tab.content();
        reviews = collectPageReviews(html).reviews;
        break;
      }
      await tab.waitForTimeout(900);
    }
    return { vendor, reviews };
  } finally {
    await client.close().catch(() => undefined);
  }
}

/**
 * Job input (stdin): { pages: [{ url, product }], maxReviews }.
 * Output (stdout): { pages: [{ url, product, vendor, status, reason?, reviewCount }], reviews: [...] }.
 */
async function main() {
  const input = JSON.parse(await new Promise((resolve, reject) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      data += chunk;
    });
    process.stdin.on("end", () => resolve(data));
    process.stdin.on("error", reject);
  }));
  const pages = Array.isArray(input.pages) ? input.pages : [];
  const maxReviews = Number.isFinite(Number(input.maxReviews)) ? Number(input.maxReviews) : 300;
  const { chromium } = resolvePlaywright();
  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  const out = { pages: [], reviews: [] };
  try {
    for (const page of pages.slice(0, 10)) {
      if (out.reviews.length >= maxReviews) break;
      const url = String(page?.url ?? "");
      const product = String(page?.product ?? "");
      if (!/^https?:\/\//.test(url)) {
        out.pages.push({ url, product, vendor: null, status: "error", reason: "not an http(s) URL", reviewCount: 0 });
        continue;
      }
      try {
        const { vendor, reviews } = await scrapePage(browser, { url, product }, null);
        const room = maxReviews - out.reviews.length;
        const kept = reviews.slice(0, room).map((r) => ({ ...r, product, url }));
        out.reviews.push(...kept);
        if (!vendor && kept.length === 0) {
          out.pages.push({ url, product, vendor: null, status: "not_found", reason: "no supported widget or JSON-LD reviews", reviewCount: 0 });
        } else if (kept.length === 0) {
          out.pages.push({ url, product, vendor, status: "not_found", reason: "widget found but no reviews parsed", reviewCount: 0 });
        } else {
          out.pages.push({ url, product, vendor, status: "done", reviewCount: kept.length });
        }
      } catch (err) {
        out.pages.push({
          url,
          product,
          vendor: null,
          status: "error",
          reason: err instanceof Error ? err.message.slice(0, 300) : String(err).slice(0, 300),
          reviewCount: 0,
        });
      }
    }
  } finally {
    await browser.close().catch(() => undefined);
  }
  process.stdout.write(`${JSON.stringify(out)}\n`);
}

const invoked = process.argv[1] !== undefined && import.meta.url.endsWith(process.argv[1].split("/").pop() ?? "");
if (invoked) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
