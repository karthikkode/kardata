import type { AddFactItem } from "../../domain/research/facts.js";
import type { UpsertRecordItem } from "../../domain/research/records.js";
import type { Collector, CollectorCtx, ShopifyProduct } from "./types.js";
import {
  collectFetch,
  fetchFailure,
  median,
  siteBase,
  writeExtract,
  writeFacts,
  writeRecords,
} from "./util.js";

const SHOPIFY_MAX_PAGES = 4;
const SHOPIFY_PAGE_SIZE = 250;

interface RawVariant {
  price?: string | number | null;
}

interface RawProduct {
  id?: number | string;
  title?: string;
  handle?: string;
  product_type?: string;
  tags?: string;
  created_at?: string | null;
  published_at?: string | null;
  variants?: RawVariant[];
}

function toProduct(raw: RawProduct): ShopifyProduct | null {
  if (raw.id === undefined || raw.id === null) return null;
  const tags = typeof raw.tags === "string" ? raw.tags.split(",").map((t) => t.trim()) : [];
  return {
    id: raw.id,
    title: typeof raw.title === "string" ? raw.title : "",
    productType: typeof raw.product_type === "string" ? raw.product_type : "",
    tags: tags.filter((t) => t !== ""),
    createdAt: raw.created_at ?? null,
    publishedAt: raw.published_at ?? null,
    handle: typeof raw.handle === "string" ? raw.handle : "",
    variants: Array.isArray(raw.variants)
      ? raw.variants.map((v) => ({ price: v?.price ?? null }))
      : [],
  };
}

export function parseShopifyProducts(text: string): ShopifyProduct[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const list = (parsed as Record<string, unknown>)["products"];
  if (!Array.isArray(list)) return null;
  const products: ShopifyProduct[] = [];
  for (const item of list) {
    const p = toProduct(item as RawProduct);
    if (p) products.push(p);
  }
  return products;
}

export const shopifyCollector: Collector = {
  name: "shopify",
  areas: ["product"],
  run: async (ctx: CollectorCtx) => {
    const none = (reason: string, status: "not_found" | "blocked" | "error" = "not_found") => {
      ctx.shared.shopify = {
        checked: true,
        isShopify: false,
        products: [],
        collections: [],
        productsUrl: null,
      };
      return { outcomes: [{ area: "product" as const, status, reason }] };
    };
    const base = siteBase(ctx);
    if (!base) return none("company has no website or domain");
    const techMentionsShopify = ctx.effective.technologies.some((t) =>
      t.toLowerCase().includes("shopify"),
    );

    const probe = await collectFetch(ctx, "shopify", `${base}/products.json?limit=1`, {
      accept: "application/json",
    });
    const probeProducts = probe.text ? parseShopifyProducts(probe.text) : null;
    if (probeProducts === null) {
      if (probe.source.status === "blocked" || probe.source.status === "robots_disallowed") {
        return none(`/products.json ${fetchFailure(probe)}`, "blocked");
      }
      if (probe.source.status === "error") {
        return none(`/products.json ${fetchFailure(probe)}`, "error");
      }
      return none(
        techMentionsShopify
          ? "Apollo lists Shopify but /products.json does not answer JSON"
          : "not a Shopify store (no /products.json)",
      );
    }

    const products: ShopifyProduct[] = [];
    const sourceIds: string[] = [probe.source.id];
    for (let page = 1; page <= SHOPIFY_MAX_PAGES; page++) {
      const res = await collectFetch(
        ctx,
        "shopify",
        `${base}/products.json?limit=${SHOPIFY_PAGE_SIZE}&page=${page}`,
        { accept: "application/json" },
      );
      if (res.source.status !== "ok" || !res.text) break;
      sourceIds.push(res.source.id);
      const list = parseShopifyProducts(res.text);
      if (!list) break;
      products.push(...list);
      if (list.length < SHOPIFY_PAGE_SIZE) break;
    }

    const shopRes = await collectFetch(ctx, "shopify", `${base}/shop.json`, {
      accept: "application/json",
    });
    let currency = "unknown currency";
    if (shopRes.source.status === "ok" && shopRes.text) {
      sourceIds.push(shopRes.source.id);
      try {
        const shop = JSON.parse(shopRes.text) as { shop?: { currency?: string } };
        if (shop?.shop?.currency) currency = shop.shop.currency;
      } catch {
        // keep unknown currency
      }
    }

    const collRes = await collectFetch(ctx, "shopify", `${base}/collections.json`, {
      accept: "application/json",
    });
    const collections: string[] = [];
    if (collRes.source.status === "ok" && collRes.text) {
      sourceIds.push(collRes.source.id);
      try {
        const parsed = JSON.parse(collRes.text) as { collections?: { title?: string }[] };
        for (const c of parsed?.collections ?? []) {
          if (c?.title) collections.push(c.title);
        }
      } catch {
        // keep what we have
      }
    }

    ctx.shared.shopify = {
      checked: true,
      isShopify: true,
      products,
      collections,
      productsUrl: `${base}/products.json`,
    };

    const byType = new Map<string, number>();
    const tagCounts = new Map<string, number>();
    const prices: number[] = [];
    let variantTotal = 0;
    let variantMin = Number.POSITIVE_INFINITY;
    let variantMax = 0;
    const launches = new Map<string, number>();
    const cutoff = new Date();
    cutoff.setMonth(cutoff.getMonth() - 24);
    for (const p of products) {
      const type = p.productType !== "" ? p.productType : "(no type)";
      byType.set(type, (byType.get(type) ?? 0) + 1);
      for (const tag of p.tags) tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
      variantTotal += p.variants.length;
      variantMin = Math.min(variantMin, p.variants.length);
      variantMax = Math.max(variantMax, p.variants.length);
      for (const v of p.variants) {
        const n = typeof v.price === "number" ? v.price : Number.parseFloat(String(v.price));
        if (Number.isFinite(n)) prices.push(n);
      }
      const launched = p.publishedAt ?? p.createdAt;
      if (launched) {
        const d = new Date(launched);
        if (!Number.isNaN(d.getTime()) && d >= cutoff) {
          const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
          launches.set(key, (launches.get(key) ?? 0) + 1);
        }
      }
    }

    const lines = [
      `Products: ${products.length}`,
      "",
      "By type:",
      ...[...byType.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([type, n]) => `- ${type}: ${n}`),
      "",
      `Prices (${currency}):`,
    ];
    if (prices.length > 0) {
      const med = median(prices);
      lines.push(
        `- min ${Math.min(...prices)}, median ${med}, max ${Math.max(...prices)} (n=${prices.length} variants)`,
      );
    } else {
      lines.push("- no variant prices");
    }
    lines.push(
      "",
      products.length > 0
        ? `Variants per product: avg ${(variantTotal / products.length).toFixed(1)}, min ${variantMin === Number.POSITIVE_INFINITY ? 0 : variantMin}, max ${variantMax}`
        : "Variants per product: n/a (no products)",
      "",
      "Launches per month (last 24 months):",
    );
    const months = [...launches.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    if (months.length > 0) {
      for (const [month, n] of months) lines.push(`- ${month}: ${n}`);
    } else {
      lines.push("- none dated in the last 24 months");
    }
    lines.push("", "Top tags:");
    const tags = [...tagCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
    if (tags.length > 0) {
      for (const [tag, n] of tags) lines.push(`- ${tag}: ${n}`);
    } else {
      lines.push("- none");
    }
    lines.push("", "Collections:");
    if (collections.length > 0) {
      for (const c of collections) lines.push(`- ${c}`);
    } else {
      lines.push("- none");
    }

    await writeExtract(ctx, "shopify", "product/shopify-catalog.md", "Shopify catalog", lines.join("\n"), sourceIds);

    const factItems: AddFactItem[] = [
      { key: "product.count", value: products.length, sourceIds, confidence: "high" },
    ];
    // Price facts need a known currency; without shop.json the document still reports them.
    if (prices.length > 0 && currency !== "unknown currency") {
      const money = { currency };
      factItems.push(
        { key: "product.price_min", value: { amount: Math.min(...prices), ...money }, sourceIds, confidence: "high" },
        { key: "product.price_median", value: { amount: median(prices) as number, ...money }, sourceIds, confidence: "high" },
        { key: "product.price_max", value: { amount: Math.max(...prices), ...money }, sourceIds, confidence: "high" },
      );
    }
    for (const [month, n] of launches) {
      factItems.push({
        key: "product.launches_per_month",
        value: n,
        qualifiers: { month },
        sourceIds,
        confidence: "high",
      });
    }
    for (const [type, n] of byType) {
      factItems.push({
        key: "product.type_count",
        value: n,
        qualifiers: { type },
        sourceIds,
        confidence: "high",
      });
    }
    await writeFacts(ctx, "shopify", factItems);

    const recordItems: UpsertRecordItem[] = products
      .filter((p) => p.handle !== "")
      .map((p) => {
        const variantPrices = p.variants
          .map((v) => (typeof v.price === "number" ? v.price : Number.parseFloat(String(v.price))))
          .filter((n) => Number.isFinite(n));
        const launched = p.publishedAt ?? p.createdAt;
        const launchedAt =
          launched && /^\d{4}-\d{2}-\d{2}/.test(launched) ? launched.slice(0, 10) : undefined;
        return {
          type: "product",
          data: {
            name: p.title !== "" ? p.title : p.handle,
            url: `${base}/products/${p.handle}`,
            ...(variantPrices.length > 0 ? { price: Math.min(...variantPrices) } : {}),
            ...(currency !== "unknown currency" ? { currency } : {}),
            ...(p.productType !== "" ? { product_type: p.productType } : {}),
            ...(launchedAt ? { launched_at: launchedAt } : {}),
            ...(p.tags.length > 0 ? { tags: p.tags } : {}),
          },
          sourceIds,
        };
      });
    await writeRecords(ctx, "shopify", recordItems);
    return { outcomes: [{ area: "product", status: "done" }] };
  },
};
