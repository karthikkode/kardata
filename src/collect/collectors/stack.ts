import { STACK_MAP } from "../stack-map.js";
import type { AddFactItem } from "../../domain/research/facts.js";
import type { Collector, CollectorCtx } from "./types.js";
import { writeExtract, writeFacts } from "./util.js";

export const stackCollector: Collector = {
  name: "stack",
  areas: ["marketing", "business_model"],
  // No network: Apollo technologies plus the homepage scripts already fetched.
  run: async (ctx: CollectorCtx) => {
    const scripts = ctx.shared.site?.homepage?.scripts ?? [];
    const techHay = ctx.effective.technologies.join("\n").toLowerCase();
    const scriptHay = scripts.join("\n").toLowerCase();
    const hits = new Map<string, string[]>();
    const channels = new Set<string>();
    for (const signal of STACK_MAP) {
      const found = new Set<string>();
      for (const tool of signal.tools) {
        if (techHay.includes(tool.match) || scriptHay.includes(tool.match)) {
          found.add(tool.name);
          for (const channel of tool.channels ?? []) channels.add(channel);
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
    const factItems: AddFactItem[] = [];
    for (const channel of [...channels].sort()) {
      factItems.push({
        key: "marketing.channel_active",
        value: true,
        qualifiers: { channel },
        sourceIds,
        confidence: "medium",
      });
    }
    for (const signal of STACK_MAP) {
      for (const tool of hits.get(signal.group) ?? []) {
        factItems.push({
          key: "marketing.tool",
          value: tool,
          qualifiers: { category: signal.group },
          sourceIds,
          confidence: "medium",
        });
      }
    }
    if (hits.has("subscriptions")) {
      factItems.push({ key: "business_model.subscription", value: true, sourceIds, confidence: "medium" });
    }
    if (hits.has("bnpl")) {
      factItems.push({ key: "business_model.bnpl", value: true, sourceIds, confidence: "medium" });
    }
    if (hits.has("wholesale")) {
      factItems.push({ key: "business_model.wholesale", value: true, sourceIds, confidence: "medium" });
    }
    // Facts need provenance: without the homepage source, only the documents stand.
    if (sourceIds.length > 0) await writeFacts(ctx, "stack", factItems);
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
