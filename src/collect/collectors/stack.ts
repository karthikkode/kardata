import { IGNORED_TECHNOLOGIES, STACK_MAP } from "../stack-map.js";
import type { AddFactItem } from "../../domain/research/facts.js";
import { findApolloImportSource } from "../../domain/research/sources.js";
import type { Collector, CollectorCtx } from "./types.js";
import { writeExtract, writeFacts } from "./util.js";

type HitOrigin = "apollo" | "page";

// Marketplace-group tools that evidence selling on a marketplace (Amazon Pay
// is only a payment button, so it stays a tool fact without this fact).
const MARKETPLACE_SLUGS: Record<string, string> = {
  Walmart: "walmart",
  eBay: "ebay",
  "Buy with Prime": "amazon",
  "Helium 10": "amazon",
};

export const stackCollector: Collector = {
  name: "stack",
  areas: ["marketing", "business_model"],
  // No network: Apollo technologies plus the homepage scripts already fetched.
  run: async (ctx: CollectorCtx) => {
    const scripts = ctx.shared.site?.homepage?.scripts ?? [];
    const techHay = ctx.effective.technologies
      .map((t) => t.toLowerCase().trim())
      .filter((t) => !IGNORED_TECHNOLOGIES.has(t))
      .join("\n");
    const scriptHay = scripts.join("\n").toLowerCase();
    const hits = new Map<string, string[]>();
    // Per-tool and per-channel provenance: which haystack each detection came
    // from, so Apollo-technology facts cite the import source and script
    // detections cite the homepage.
    const toolOrigins = new Map<string, Set<HitOrigin>>();
    const channelOrigins = new Map<string, Set<HitOrigin>>();
    for (const signal of STACK_MAP) {
      const found = new Set<string>();
      for (const tool of signal.tools) {
        const inTech = techHay.includes(tool.match);
        const inScript = scriptHay.includes(tool.match);
        if (!inTech && !inScript) continue;
        found.add(tool.name);
        const origins = toolOrigins.get(tool.name) ?? new Set<HitOrigin>();
        if (inTech) origins.add("apollo");
        if (inScript) origins.add("page");
        toolOrigins.set(tool.name, origins);
        for (const channel of tool.channels ?? []) {
          const channelSet = channelOrigins.get(channel) ?? new Set<HitOrigin>();
          if (inTech) channelSet.add("apollo");
          if (inScript) channelSet.add("page");
          channelOrigins.set(channel, channelSet);
        }
      }
      if (found.size > 0) hits.set(signal.group, [...found]);
    }
    const scriptsNote =
      scripts.length === 0 && !ctx.shared.site?.homepage
        ? "Homepage scripts unavailable; signals below come from Apollo technologies only."
        : null;

    const linesFor = (area: "marketing" | "business_model"): string[] => {
      const lines: string[] = [];
      if (scriptsNote) lines.push(scriptsNote, "");
      for (const signal of STACK_MAP) {
        if (signal.area !== area) continue;
        const found = hits.get(signal.group);
        lines.push(`- ${signal.label}: ${found ? found.join(", ") : "none detected"}`);
      }
      return lines;
    };
    const hasFor = (area: "marketing" | "business_model"): boolean =>
      STACK_MAP.some((s) => s.area === area && hits.has(s.group));

    // Provenance: the homepage source when scripts contributed, else none
    // (Apollo technologies live on the company row, not in a source).
    const sourceIds = ctx.shared.site?.homepage ? [ctx.shared.site.homepage.sourceId] : [];
    if (hasFor("marketing")) {
      await writeExtract(
        ctx,
        "stack",
        "marketing/stack-signals.md",
        "Marketing stack signals",
        linesFor("marketing").join("\n"),
        sourceIds,
      );
    }
    if (hasFor("business_model")) {
      await writeExtract(
        ctx,
        "stack",
        "business_model/stack-signals.md",
        "Business-model stack signals",
        linesFor("business_model").join("\n"),
        sourceIds,
      );
    }

    // Presence-only facts: a detected tool evidences the channel, but a miss
    // proves nothing, so no false facts are ever written.
    const homepageId = ctx.shared.site?.homepage?.sourceId ?? null;
    const needsApollo = [...toolOrigins.values()].some((origins) => origins.has("apollo"));
    const apolloSource = needsApollo ? await findApolloImportSource(ctx.db, ctx.companyId) : null;
    const apolloId = apolloSource?.id ?? null;
    const idsFor = (origins: Set<HitOrigin>): string[] => {
      const ids: string[] = [];
      if (origins.has("page") && homepageId) ids.push(homepageId);
      if (origins.has("apollo") && apolloId) ids.push(apolloId);
      return ids;
    };
    const factItems: AddFactItem[] = [];
    for (const channel of [...channelOrigins.keys()].sort()) {
      const ids = idsFor(channelOrigins.get(channel) ?? new Set());
      if (ids.length === 0) continue;
      factItems.push({
        key: "marketing.channel_active",
        value: true,
        qualifiers: { channel },
        sourceIds: ids,
        confidence: "medium",
      });
    }
    for (const signal of STACK_MAP) {
      for (const tool of hits.get(signal.group) ?? []) {
        const ids = idsFor(toolOrigins.get(tool) ?? new Set());
        if (ids.length === 0) continue;
        factItems.push({
          key: "marketing.tool",
          value: tool,
          qualifiers: { category: signal.group },
          sourceIds: ids,
          confidence: "medium",
        });
      }
    }
    const groupOrigins = (group: string): Set<HitOrigin> => {
      const out = new Set<HitOrigin>();
      for (const tool of hits.get(group) ?? []) {
        for (const origin of toolOrigins.get(tool) ?? []) out.add(origin);
      }
      return out;
    };
    for (const [group, key] of [
      ["subscriptions", "business_model.subscription"],
      ["bnpl", "business_model.bnpl"],
      ["wholesale", "business_model.wholesale"],
    ] as const) {
      if (!hits.has(group)) continue;
      const ids = idsFor(groupOrigins(group));
      if (ids.length === 0) continue;
      factItems.push({ key, value: true, sourceIds: ids, confidence: "medium" });
    }
    for (const tool of hits.get("marketplace") ?? []) {
      const slug = MARKETPLACE_SLUGS[tool];
      if (!slug) continue;
      const ids = idsFor(toolOrigins.get(tool) ?? new Set());
      if (ids.length === 0) continue;
      factItems.push({
        key: "business_model.marketplace",
        value: true,
        qualifiers: { marketplace: slug },
        sourceIds: ids,
        confidence: "medium",
      });
    }
    await writeFacts(ctx, "stack", factItems);
    return {
      outcomes: [
        {
          area: "marketing",
          status: hasFor("marketing") ? "done" : "not_found",
          ...(hasFor("marketing") ? {} : { reason: "no marketing tools detected" }),
        },
        {
          area: "business_model",
          status: hasFor("business_model") ? "done" : "not_found",
          ...(hasFor("business_model") ? {} : { reason: "no business-model tools detected" }),
        },
      ],
    };
  },
};
