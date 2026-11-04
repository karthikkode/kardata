import { appendFile, readFile, readdir } from "node:fs/promises";
import { resolve, join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { setTimeout as sleep } from "node:timers/promises";
import { load } from "cheerio";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { z } from "zod";
import { loadAppEnv, requireEnv } from "../src/lib/env.js";
import {
  articleText, canonicalIndustryUrl, extractIndustryEvidence, industryPath, redditItems,
} from "../src/domain/research/industry-evidence.js";

const exec = promisify(execFile);
const industryGroups = ["fas", "carl", "fat", "kitces-blog", "wealth-blog", "sec-priority", "sec-alert", "reddit"] as const;
type IndustryGroup = typeof industryGroups[number];
const toolNames = ["CRM", "Redtail", "Wealthbox", "Salesforce", "eMoney", "RightCapital", "Orion", "Black Diamond",
  "Addepar", "Tamarac", "Schwab", "Fidelity", "DocuSign", "Calendly", "Holistiplan", "Jump", "Microsoft Teams", "Excel"];

const receiptSchema = z.object({
  key: z.string().regex(/^[a-z0-9-]+$/), url: z.string(), finalUrl: z.string().optional(),
  group: z.enum(industryGroups).nullish(), episode: z.number().int().positive().nullish(), error: z.string().nullish(),
});
type Evidence = ReturnType<typeof extractIndustryEvidence>;
type Item = { group: IndustryGroup; url: string; title: string; published: string | null; text: string; episode?: number | null };
type Checkpoint = { key: string; sourceId: string; documentId?: string; recordId?: string; url?: string; group?: IndustryGroup; evidence?: Evidence };

function cleanedDate(value: string | null) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

async function readItem(dir: string, name: string): Promise<Item | null> {
  const receipt = receiptSchema.parse(JSON.parse(await readFile(join(dir, name), "utf8")));
  if (!receipt.group || receipt.error) return null;
  const path = join(dir, receipt.key + ".raw");
  const raw = await readFile(path);
  const url = canonicalIndustryUrl(receipt.finalUrl ?? receipt.url);
  if (receipt.group === "reddit") throw new Error("Reddit text must be loaded from sanitized RSS entries");
  if (receipt.group.startsWith("sec-")) {
    if (raw.subarray(0, 5).toString() !== "%PDF-") throw new Error("Expected PDF bytes");
    const { stdout } = await exec("pdftotext", ["-layout", path, "-"], { maxBuffer: 2 * 1024 * 1024 });
    const text = stdout.trim().replace(/\f/g, "\n\n");
    const title = text.split("\n").filter((line) => line.trim().length > 6).slice(0, 2).map((line) => line.trim()).join(" ");
    return { group: receipt.group, url, text, title: title || receipt.key, published: null };
  }
  if (receipt.group === "fat" && !/^\s*</.test(raw.toString("utf8"))) {
    const title = receipt.key;
    return { group: receipt.group, url, title, published: null, text: raw.toString("utf8"), episode: receipt.episode };
  }
  const transcript = receipt.group === "fas" || receipt.group === "carl" || receipt.group === "fat";
  const article = articleText(raw.toString("utf8"), transcript);
  if (!article.text || (transcript && article.text.length < 500)) {
    throw new Error(transcript ? "No readable published transcript" : "No readable article body");
  }
  return {
    group: receipt.group, url, title: article.title || receipt.key, published: cleanedDate(article.published),
    text: article.text, episode: receipt.episode,
  };
}

async function feedItems(dir: string, redditXml?: string): Promise<Item[]> {
  const rss = await readFile(join(dir, "kitces-feedblitz.raw"), "utf8").catch(() => "");
  const $ = load(rss, { xmlMode: true });
  const articles = $("item").toArray().flatMap((node): Item[] => {
    const item = $(node);
    const title = item.children("title").text().trim();
    const link = item.children().filter((_, el) => el.name.endsWith(":origLink")).text().trim()
      || item.children("link").text().trim();
    const body = item.children().filter((_, el) => el.name.endsWith(":encoded") || el.name === "encoded").text()
      || item.children("description").text();
    if (!title || !link || /Financial Advisor Technician podcast/i.test(body) || /FASuccess|Kitces\s*&\s*Carl|financial advisor success podcast/i.test(title)) return [];
    const url = new URL(link);
    if (url.hostname !== "www.kitces.com" || !url.pathname.startsWith("/blog/")) return [];
    const text = articleText("<main>" + body + "</main>").text;
    return text.length >= 200 ? [{ group: "kitces-blog", url: canonicalIndustryUrl(link),
      title, text, published: cleanedDate(item.children("pubDate").text()) }] : [];
  });
  if (redditXml) for (const item of redditItems(redditXml)) articles.push({ group: "reddit", ...item });
  return articles;
}

function jsonLines<T>(contents: string): T[] {
  return contents.split("\n").filter((line) => line.trim()).map((line) => JSON.parse(line) as T);
}

async function main() {
  const dir = resolve(process.argv[2] ?? "var/sources/industry");
  const watch = process.argv.includes("--watch");
  const readReddit = process.argv.includes("--reddit-feed-stdin");
  if (watch && readReddit) throw new Error("Use a one-shot run for an allowed Reddit RSS stream");
  const input: Buffer[] = [];
  if (readReddit) for await (const chunk of process.stdin) input.push(Buffer.from(chunk));
  const redditXml = input.length ? Buffer.concat(input).toString("utf8") : undefined;
  const journalPath = join(dir, "mcp-checkpoints.ndjson");
  const journal = new Map(jsonLines<Checkpoint>(await readFile(journalPath, "utf8").catch(() => ""))
    .map((row) => [row.key, row]));
  const dryRun = process.argv.includes("--dry-run");
  const client = new Client({ name: "industry-evidence", version: "1" });
  let companyId: string | undefined;
  const call = async <T>(name: string, args: Record<string, unknown>) => {
    const result = await client.callTool({ name, arguments: args }, undefined, { timeout: 120_000 });
    if (result.isError || !result.structuredContent) {
      const error = (result.content as { text?: string }[])[0]?.text;
      throw new Error(error ?? name + " returned no structured data");
    }
    return result.structuredContent as T;
  };
  const checkpoint = async (row: Checkpoint) => {
    await appendFile(journalPath, JSON.stringify(row) + "\n", { mode: 0o600 });
    journal.set(row.key, row);
  };
  const consume = async (item: Item) => {
    const { key, path } = industryPath(item.url, item.group, item.episode);
    if (journal.get(key)?.recordId) return;
    const evidence = extractIndustryEvidence(item.text, { regulator: item.group.startsWith("sec-"), toolNames });
    if (dryRun) {
      console.log(JSON.stringify({ group: item.group, url: item.url, characters: item.text.length, problems: evidence.problems.length }));
      return;
    }
    if (!companyId) throw new Error("Evidence library is unavailable");
    if (Buffer.byteLength(item.text, "utf8") > 480_000) throw new Error("Text exceeds safe document size; retain raw bytes for review");
    let saved = journal.get(key);
    if (!saved) {
      const passages = evidence.problems.slice(0, 3).map((row) => row.evidence.quote);
      const source = await call<{ sourceId: string }>("source_capture", {
        companyId, url: item.url, title: item.title, via: "browser", text: item.text,
        passages: passages.length ? passages : [item.text.trim().split(/\s+/).slice(0, 18).join(" ")],
      });
      saved = { key, sourceId: source.sourceId };
      await checkpoint(saved);
    }
    if (!saved.documentId) {
      const doc = await call<{ id: string }>("document_save", {
        companyId, path, title: item.title, content: item.text, kind: "extract",
        sourceIds: [saved.sourceId], tags: ["industry-evidence", item.group],
      });
      saved = { ...saved, documentId: doc.id };
      await checkpoint(saved);
    }
    const record = await call<{ results: { ok: boolean; id?: string; error?: string }[] }>("record_upsert", {
      companyId, records: [{
        type: "industry_evidence", naturalKey: ["item_key"], tags: [item.group],
        sourceIds: [saved.sourceId], data: {
          item_key: key, url: item.url, source_group: item.group, document_id: saved.documentId,
          published: item.published ?? "", episode: item.episode ?? 0, evidence,
        },
      }],
    });
    const row = record.results[0];
    if (!row?.ok || !row.id) throw new Error(row?.error ?? "industry_evidence write not acknowledged");
    await checkpoint({ ...saved, recordId: row.id, group: item.group, url: item.url, evidence });
    console.log(JSON.stringify({ group: item.group, url: item.url, documentId: saved.documentId, recordId: row.id }));
  };

  if (!dryRun) {
    loadAppEnv();
    await client.connect(new StreamableHTTPClientTransport(
      new URL(process.env.KARDATA_MCP_URL ?? "http://127.0.0.1:8787/mcp"),
      { requestInit: { headers: { Authorization: `Bearer ${requireEnv("KARDATA_OPERATOR_TOKEN")}` } } },
    ));
  }
  const attempted = new Map<string, number>();
  const tryConsume = async (key: string, loadItem: () => Promise<Item | null>) => {
    if ((attempted.get(key) ?? 0) >= 3) return;
    try {
      const item = await loadItem();
      if (item) await consume(item);
      attempted.set(key, 3);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      attempted.set(key, (attempted.get(key) ?? 0) + 1);
      console.error(JSON.stringify({ key, error: message }));
    }
  };
  try {
    if (!dryRun) ({ companyId } = await call<{ companyId: string }>("evidence_library_ensure", {}));
    do {
      const entries = new Set(await readdir(dir));
      const receipts = [...entries].filter((name) => /^[-a-z0-9]+\.json$/.test(name) && entries.has(name.replace(/\.json$/, ".raw")));
      for (const name of receipts.sort()) {
        await tryConsume(name, () => readItem(dir, name));
      }
      for (const item of await feedItems(dir, redditXml)) await tryConsume(item.url, async () => item);
      if (watch) await sleep(15_000);
    } while (watch);
  } finally {
    if (!dryRun) await client.close();
  }
}

await main();
