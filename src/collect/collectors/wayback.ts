import type { AddFactItem } from "../../domain/research/facts.js";
import { parseShopifyProducts } from "./shopify.js";
import type { Collector, CollectorCtx, ShopifyProduct } from "./types.js";
import { collectFetch, fetchFailure, median, writeExtract, writeFacts } from "./util.js";

// Internet Archive CDX API: GET https://web.archive.org/cdx/search/cdx?url=...&output=json
// &fl=timestamp,original,statuscode&filter=statuscode:200&collapse=timestamp:4&limit=N, replay at
// https://web.archive.org/web/{timestamp}id_/{url} (verified live; params per
// https://github.com/internetarchive/wayback/tree/master/wayback-cdx-server). The 2 s host delay
// applies here too.

const CDX_LIMIT = 10000;

interface Capture {
  timestamp: string;
  original: string;
}

function parseCdx(text: string): Capture[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    return null;
  }
  if (!Array.isArray(parsed) || parsed.length === 0) return [];
  const [header, ...rows] = parsed as unknown[][];
  const tsIdx = Array.isArray(header) ? header.indexOf("timestamp") : -1;
  const origIdx = Array.isArray(header) ? header.indexOf("original") : -1;
  if (tsIdx < 0) return null;
  const out: Capture[] = [];
  for (const row of rows) {
    if (!Array.isArray(row)) continue;
    const ts = row[tsIdx];
    if (typeof ts !== "string" || ts === "") continue;
    out.push({ timestamp: ts, original: origIdx >= 0 ? String(row[origIdx] ?? "") : "" });
  }
  return out;
}

function variantPrices(p: ShopifyProduct): number[] {
  const out: number[] = [];
  for (const v of p.variants) {
    const n = typeof v.price === "number" ? v.price : Number.parseFloat(String(v.price));
    if (Number.isFinite(n)) out.push(n);
  }
  return out;
}

function productKey(p: ShopifyProduct): string {
  return p.handle !== "" ? `h:${p.handle}` : `id:${String(p.id)}`;
}

export const waybackCollector: Collector = {
  name: "wayback",
  areas: ["product", "decisions"],
  run: async (ctx: CollectorCtx) => {
    const domain = ctx.effective.domain?.trim() ?? "";
    if (domain === "") {
      const reason = "no domain to query";
      return {
        outcomes: [
          { area: "product", status: "not_found" as const, reason },
          { area: "decisions", status: "not_found" as const, reason },
        ],
      };
    }
    const historyUrl =
      `${ctx.endpoints.cdx}/cdx/search/cdx?url=${encodeURIComponent(domain)}/` +
      `&output=json&fl=timestamp,original,statuscode&filter=statuscode:200&limit=${CDX_LIMIT}`;
    const res = await collectFetch(ctx, "wayback", historyUrl, { accept: "application/json" });
    if (res.source.status !== "ok" || !res.text) {
      const status =
        res.source.status === "blocked" || res.source.status === "robots_disallowed"
          ? ("blocked" as const)
          : res.source.status === "error"
            ? ("error" as const)
            : ("not_found" as const);
      const reason = `CDX: ${fetchFailure(res)}`;
      return {
        outcomes: [
          { area: "product", status, reason },
          { area: "decisions", status, reason },
        ],
      };
    }
    const captures = parseCdx(res.text);
    if (captures === null) {
      const reason = "CDX returned invalid JSON";
      return {
        outcomes: [
          { area: "product", status: "error" as const, reason },
          { area: "decisions", status: "error" as const, reason },
        ],
      };
    }
    if (captures.length === 0) {
      const reason = "no captures";
      return {
        outcomes: [
          { area: "product", status: "skipped" as const, reason: "no captures to compare" },
          { area: "decisions", status: "not_found" as const, reason },
        ],
      };
    }
    const stamps = captures.map((c) => c.timestamp).sort();
    const first = stamps[0] as string;
    const last = stamps[stamps.length - 1] as string;
    const perYear = new Map<string, number>();
    for (const ts of stamps) {
      const year = ts.slice(0, 4);
      perYear.set(year, (perYear.get(year) ?? 0) + 1);
    }
    const historyLines = [
      `First capture: ${first}`,
      `Last capture: ${last}`,
      `Captures: ${captures.length}${captures.length >= CDX_LIMIT ? ` (capped at ${CDX_LIMIT})` : ""}`,
      "",
      "Captures per year:",
      ...[...perYear.entries()]
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([year, n]) => `- ${year}: ${n}`),
    ];
    await writeExtract(
      ctx,
      "wayback",
      "decisions/archive-history.md",
      "Archive history",
      historyLines.join("\n"),
      [res.source.id],
    );

    const shop = ctx.shared.shopify;
    if (!shop?.isShopify || !shop.productsUrl) {
      return {
        outcomes: [
          { area: "product", status: "skipped" as const, reason: "not a Shopify store" },
          { area: "decisions", status: "done" as const },
        ],
      };
    }
    const productsUrl = shop.productsUrl;
    const listUrl =
      `${ctx.endpoints.cdx}/cdx/search/cdx?url=${encodeURIComponent(productsUrl)}` +
      `&output=json&fl=timestamp,original,statuscode&filter=statuscode:200&limit=${CDX_LIMIT}`;
    const listRes = await collectFetch(ctx, "wayback", listUrl, { accept: "application/json" });
    const oldCaptures = listRes.text ? parseCdx(listRes.text) : null;
    const target = new Date();
    target.setFullYear(target.getFullYear() - 1);
    const targetTs = `${target.getUTCFullYear()}${String(target.getUTCMonth() + 1).padStart(2, "0")}${String(target.getUTCDate()).padStart(2, "0")}000000`;
    let closest: Capture | null = null;
    let closestDelta = Number.POSITIVE_INFINITY;
    for (const c of oldCaptures ?? []) {
      const delta = Math.abs(Number(c.timestamp) - Number(targetTs));
      if (delta < closestDelta) {
        closestDelta = delta;
        closest = c;
      }
    }
    if (!closest) {
      return {
        outcomes: [
          {
            area: "product",
            status: "not_found" as const,
            reason: "no year-old /products.json capture",
          },
          { area: "decisions", status: "done" as const },
        ],
      };
    }
    const replayUrl = `${ctx.endpoints.wayback}/web/${closest.timestamp}id_/${productsUrl}`;
    const replay = await collectFetch(ctx, "wayback", replayUrl, { accept: "application/json" });
    const oldProducts = replay.text ? parseShopifyProducts(replay.text) : null;
    if (!oldProducts) {
      return {
        outcomes: [
          {
            area: "product",
            status: replay.source.status === "ok" ? ("error" as const) : ("blocked" as const),
            reason: `year-old capture ${closest.timestamp}: ${replay.source.status === "ok" ? "invalid products.json" : fetchFailure(replay)}`,
          },
          { area: "decisions", status: "done" as const },
        ],
      };
    }
    const oldByKey = new Map(oldProducts.map((p) => [productKey(p), p]));
    const newByKey = new Map(shop.products.map((p) => [productKey(p), p]));
    const added = [...newByKey.keys()].filter((k) => !oldByKey.has(k));
    const removed = [...oldByKey.keys()].filter((k) => !newByKey.has(k));
    const oldPrices = oldProducts.flatMap(variantPrices);
    const newPrices = shop.products.flatMap(variantPrices);
    const oldMed = median(oldPrices);
    const newMed = median(newPrices);
    const lines = [
      `Compared capture ${closest.timestamp} with today (${oldProducts.length} → ${shop.products.length} products)`,
      `Products added: ${added.length}`,
      `Products removed: ${removed.length}`,
      oldMed !== null && newMed !== null
        ? `Median variant price: ${oldMed} → ${newMed} (change ${newMed - oldMed >= 0 ? "+" : ""}${(newMed - oldMed).toFixed(2)})`
        : "Median variant price: unknown (no prices)",
      replayUrl,
    ];
    await writeExtract(ctx, "wayback", "product/catalog-then-vs-now.md", "Catalog then vs now", lines.join("\n"), [
      listRes.source.id,
      replay.source.id,
    ]);
    const factItems: AddFactItem[] = [];
    if (oldProducts.length > 0) {
      const change = ((shop.products.length - oldProducts.length) / oldProducts.length) * 100;
      factItems.push({
        key: "product.catalog_change_12m",
        value: Math.round(change * 10) / 10,
        sourceIds: [listRes.source.id, replay.source.id],
        confidence: "medium",
      });
    }
    await writeFacts(ctx, "wayback", factItems);
    return {
      outcomes: [
        { area: "product", status: "done" as const },
        { area: "decisions", status: "done" as const },
      ],
    };
  },
};
