import type { AddFactItem } from "../../domain/research/facts.js";
import type { UpsertRecordItem } from "../../domain/research/records.js";
import type { Collector, CollectorCtx, PageLink } from "./types.js";
import { collectFetch, fetchFailure, writeExtract, writeFacts, writeRecords } from "./util.js";

type BoardProvider = "greenhouse" | "lever" | "ashby" | "workable";

interface DetectedBoard {
  provider: BoardProvider;
  slug: string;
  linkUrl: string;
}

interface JobRole {
  title: string;
  department: string | null;
  location: string | null;
  date: string | null;
  url: string | null;
  compensation: string | null;
}

function detectBoard(link: PageLink): DetectedBoard | null {
  let url: URL;
  try {
    url = new URL(link.href);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase();
  const path = url.pathname.toLowerCase();
  const segments = url.pathname.split("/").filter((s) => s !== "");
  const last = segments[segments.length - 1] ?? "";

  if (host.includes("greenhouse.io") || path.includes("greenhouse")) {
    const slug = host.includes("greenhouse.io") ? (segments[0] ?? "") : last;
    if (slug !== "") return { provider: "greenhouse", slug, linkUrl: link.href };
    return null;
  }
  if (host.includes("lever.co") || path.includes("lever")) {
    const slug = host === "api.lever.co" ? (segments[2] ?? "") : last;
    if (slug !== "") return { provider: "lever", slug, linkUrl: link.href };
    return null;
  }
  if (host.includes("ashbyhq.com") || path.includes("ashby")) {
    if (last !== "") return { provider: "ashby", slug: last, linkUrl: link.href };
    return null;
  }
  if (host.includes("workable.com") || path.includes("workable")) {
    const bare = host.replace(/^www\./, "");
    if (bare !== "workable.com" && bare.endsWith(".workable.com")) {
      return { provider: "workable", slug: bare.slice(0, -".workable.com".length), linkUrl: link.href };
    }
    if (last !== "") return { provider: "workable", slug: last, linkUrl: link.href };
    return null;
  }
  return null;
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

function parseGreenhouse(payload: unknown): JobRole[] {
  if (typeof payload !== "object" || payload === null) return [];
  const jobs = (payload as Record<string, unknown>)["jobs"];
  if (!Array.isArray(jobs)) return [];
  return jobs.map((j) => {
    const job = (j ?? {}) as Record<string, unknown>;
    const departments = Array.isArray(job["departments"])
      ? (job["departments"] as { name?: string }[]).map((d) => d?.name).filter(Boolean)
      : [];
    const offices = Array.isArray(job["offices"])
      ? (job["offices"] as { name?: string }[]).map((o) => o?.name).filter(Boolean)
      : [];
    const location =
      typeof job["location"] === "object" && job["location"] !== null
        ? str((job["location"] as Record<string, unknown>)["name"])
        : str(job["location"]);
    return {
      title: str(job["title"]) ?? "(untitled)",
      department: departments[0] ?? null,
      location: offices[0] ?? location,
      date: str(job["updated_at"]) ?? str(job["created_at"]),
      url: str(job["absolute_url"]),
      compensation: null,
    };
  });
}

function parseLever(payload: unknown): JobRole[] {
  if (!Array.isArray(payload)) return [];
  return payload.map((p) => {
    const posting = (p ?? {}) as Record<string, unknown>;
    const categories = (posting["categories"] ?? {}) as Record<string, unknown>;
    const salary = str(posting["salaryRange"]) ?? str(posting["salaryDescription"]);
    return {
      title: str(posting["text"]) ?? "(untitled)",
      department: str(categories["department"]) ?? str(categories["team"]),
      location: str(categories["location"]),
      date: str(posting["createdAt"]),
      url: str(posting["hostedUrl"]) ?? str(posting["applyUrl"]),
      compensation: salary,
    };
  });
}

function parseAshby(payload: unknown): JobRole[] {
  if (typeof payload !== "object" || payload === null) return [];
  const jobs = (payload as Record<string, unknown>)["jobs"];
  if (!Array.isArray(jobs)) return [];
  return jobs.map((j) => {
    const job = (j ?? {}) as Record<string, unknown>;
    const comp = job["compensation"] as Record<string, unknown> | undefined;
    return {
      title: str(job["title"]) ?? "(untitled)",
      department: str(job["department"]) ?? str(job["team"]),
      location: str(job["location"]),
      date: str(job["publishedAt"]),
      url: str(job["jobUrl"]) ?? str(job["applyUrl"]),
      compensation: comp ? (str(comp["compensationTierSummary"]) ?? str(comp["summary"])) : null,
    };
  });
}

function parseWorkable(payload: unknown): JobRole[] {
  if (typeof payload !== "object" || payload === null) return [];
  const jobs = (payload as Record<string, unknown>)["jobs"];
  if (!Array.isArray(jobs)) return [];
  return jobs.map((j) => {
    const job = (j ?? {}) as Record<string, unknown>;
    return {
      title: str(job["title"]) ?? "(untitled)",
      department: str(job["department"]),
      location: str(job["city"]) ?? str(job["location"]),
      date: str(job["published_on"]) ?? str(job["created_at"]),
      url: str(job["shortlink"]) ?? str(job["url"]),
      compensation: null,
    };
  });
}

function toDateOnly(value: string | null): string | undefined {
  if (!value) return undefined;
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(value);
  if (!match?.[1]) return undefined;
  const d = new Date(`${match[1]}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === match[1] ? match[1] : undefined;
}

// Parses "$80K–$90K", "$100,000-$120,000" and "USD 80000 - 90000" style ranges.
// Currency is set only when an explicit code or an unambiguous symbol is present.
function parseCompRange(raw: string | null): { min: number; max: number; currency?: string } | null {
  if (!raw) return null;
  const code = /\b(USD|GBP|EUR|CAD|AUD|CHF|SEK|NOK|DKK|JPY|INR|SGD|NZD)\b/.exec(raw)?.[1];
  const symbol = raw.includes("£") ? "GBP" : raw.includes("€") ? "EUR" : raw.includes("$") ? "USD" : undefined;
  const nums = [...raw.replace(/,/g, "").matchAll(/(\d+(?:\.\d+)?)\s*([Kk])?/g)]
    .map((m) => Number(m[1]) * (m[2] ? 1000 : 1))
    .filter((n) => Number.isFinite(n));
  if (nums.length < 2) return null;
  const min = Math.min(...nums);
  const max = Math.max(...nums);
  if (min <= 0 || max <= 0 || min === max) return null;
  return { min, max, ...(code ?? symbol ? { currency: code ?? symbol as string } : {}) };
}

export const jobsCollector: Collector = {
  name: "jobs",
  areas: ["hiring"],
  run: async (ctx: CollectorCtx) => {
    const site = ctx.shared.site;
    const pages = [
      ...(site?.homepage ? [site.homepage] : []),
      ...(site?.pages.filter((p) => p.class === "careers").map((p) => p.page) ?? []),
    ];
    if (pages.length === 0) {
      return {
        outcomes: [
          {
            area: "hiring",
            status: site?.homepageFailed ? "blocked" : "not_found",
            reason: site?.homepageFailed
              ? `no careers or homepage content: ${site.homepageFailed}`
              : "no careers page or homepage content to scan",
          },
        ],
      };
    }
    let board: DetectedBoard | null = null;
    for (const page of pages) {
      for (const link of page.links) {
        board = detectBoard(link);
        if (board) break;
      }
      if (board) break;
    }
    if (!board) {
      return {
        outcomes: [
          {
            area: "hiring",
            status: "not_found",
            reason: "no supported job board linked from the careers page or homepage",
          },
        ],
      };
    }

    // Only the slug found linked from the company's own site is used; never guessed.
    const slug = encodeURIComponent(board.slug);
    let apiUrl: string;
    let parse: (payload: unknown) => JobRole[];
    switch (board.provider) {
      case "greenhouse":
        // Greenhouse Job Board API: GET {base}/v1/boards/{token}/jobs[?content=true] (https://developers.greenhouse.io/job-board.html).
        apiUrl = `${ctx.endpoints.greenhouse}/v1/boards/${slug}/jobs?content=true`;
        parse = parseGreenhouse;
        break;
      case "lever":
        // Lever Postings API: GET https://api.lever.co/v0/postings/{site}?mode=json[&skip&limit], top-level array (https://github.com/lever/postings-api).
        apiUrl = `${ctx.endpoints.lever}/v0/postings/${slug}?mode=json`;
        parse = parseLever;
        break;
      case "ashby":
        // Ashby Job Postings API: GET https://api.ashbyhq.com/posting-api/job-board/{name}[?includeCompensation=true] (https://developers.ashbyhq.com/docs/public-job-posting-api).
        apiUrl = `${ctx.endpoints.ashby}/posting-api/job-board/${slug}?includeCompensation=true`;
        parse = parseAshby;
        break;
      case "workable":
        // Workable public widget API: GET https://apply.workable.com/api/v1/widget/accounts/{slug}?details=true (https://help.workable.com/hc/en-us/articles/115012771647).
        apiUrl = `${ctx.endpoints.workable}/api/v1/widget/accounts/${slug}?details=true`;
        parse = parseWorkable;
        break;
    }

    const res = await collectFetch(ctx, "jobs", apiUrl, { accept: "application/json" });
    if (res.source.status !== "ok" || !res.text) {
      const status =
        res.source.status === "blocked" || res.source.status === "robots_disallowed"
          ? "blocked"
          : res.source.status === "error"
            ? "error"
            : "not_found";
      return {
        outcomes: [
          {
            area: "hiring",
            status,
            reason: `${board.provider} board "${board.slug}": ${fetchFailure(res)}`,
          },
        ],
      };
    }
    let payload: unknown;
    try {
      payload = JSON.parse(res.text) as unknown;
    } catch {
      return {
        outcomes: [
          {
            area: "hiring",
            status: "error",
            reason: `${board.provider} board "${board.slug}" returned invalid JSON`,
          },
        ],
      };
    }
    const roles = parse(payload);
    const lines = [
      `Board: ${board.provider} "${board.slug}" (linked from ${board.linkUrl})`,
      `Open roles: ${roles.length}`,
      "",
    ];
    if (roles.length > 0) {
      const byDept = new Map<string, number>();
      const byLoc = new Map<string, number>();
      for (const r of roles) {
        byDept.set(r.department ?? "(no department)", (byDept.get(r.department ?? "(no department)") ?? 0) + 1);
        byLoc.set(r.location ?? "(no location)", (byLoc.get(r.location ?? "(no location)") ?? 0) + 1);
      }
      lines.push(
        "By department:",
        ...[...byDept.entries()].sort((a, b) => b[1] - a[1]).map(([d, n]) => `- ${d}: ${n}`),
        "",
        "By location:",
        ...[...byLoc.entries()].sort((a, b) => b[1] - a[1]).map(([l, n]) => `- ${l}: ${n}`),
        "",
        "Roles:",
      );
      for (const r of roles) {
        const bits = [
          r.date ? `posted ${r.date}` : "date not provided",
          r.department ?? "no department",
          r.location ?? "no location",
        ];
        lines.push(`- ${r.title} (${bits.join("; ")})`);
        if (r.url) lines.push(`  ${r.url}`);
        if (r.compensation) lines.push(`  Compensation: ${r.compensation}`);
      }
    }
    await writeExtract(
      ctx,
      "jobs",
      "hiring/open-roles.md",
      `Open roles (${board.provider})`,
      lines.join("\n"),
      [res.source.id],
    );

    const sourceIds = [res.source.id];
    const factItems: AddFactItem[] = [
      { key: "hiring.open_roles", value: roles.length, sourceIds, confidence: "high" },
      { key: "hiring.board", value: board.provider, sourceIds, confidence: "high" },
    ];
    const byDept = new Map<string, number>();
    for (const r of roles) {
      if (r.department) byDept.set(r.department, (byDept.get(r.department) ?? 0) + 1);
    }
    for (const [department, n] of byDept) {
      factItems.push({
        key: "hiring.open_roles_by_department",
        value: n,
        qualifiers: { department },
        sourceIds,
        confidence: "high",
      });
    }
    await writeFacts(ctx, "jobs", factItems);

    const recordItems: UpsertRecordItem[] = roles
      .filter((r) => r.url !== null)
      .map((r) => {
        const comp = parseCompRange(r.compensation);
        return {
          type: "job_posting",
          data: {
            title: r.title,
            ...(r.department ? { department: r.department } : {}),
            ...(r.location ? { location: r.location } : {}),
            ...(toDateOnly(r.date) ? { posted_at: toDateOnly(r.date) as string } : {}),
            url: r.url as string,
            ...(comp ? { comp_min: comp.min, comp_max: comp.max } : {}),
            ...(comp?.currency ? { currency: comp.currency } : {}),
          },
          sourceIds,
        };
      });
    await writeRecords(ctx, "jobs", recordItems);
    return { outcomes: [{ area: "hiring", status: "done" }] };
  },
};
