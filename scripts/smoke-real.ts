/**
 * Real-file acceptance (Step 6). Drives the RUNNING dev server over MCP.
 * Reads CSV paths from SMOKE_CSV_PATHS. Prints only counts, never company data.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { loadDotenv, requireEnv } from "../src/lib/env.js";

loadDotenv();

const HOST = process.env.HOST ?? "127.0.0.1";
const PORT = Number(process.env.PORT ?? "8787");
const TOKEN = requireEnv("KARDATA_OPERATOR_TOKEN");
const PATHS = (process.env.SMOKE_CSV_PATHS ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter((s) => s !== "");

const SECTOR = "smoke-real";

interface ToolResult {
  isError?: boolean;
  structuredContent?: Record<string, unknown>;
}

interface FileResult {
  ok: boolean;
  path: string;
  import?: {
    filename: string;
    rowsRead: number;
    createdCount: number;
    linkedCount: number;
    updatedCount: number;
    skippedCount: number;
  };
  error?: { code: string; message: string };
}

function fail(message: string, failures: string[]): void {
  console.error(`FAIL: ${message}`);
  failures.push(message);
}

function check(cond: boolean, message: string, failures: string[]): void {
  if (cond) console.log(`ok: ${message}`);
  else fail(message, failures);
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return NaN;
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)] ?? NaN;
}

async function main(): Promise<void> {
  const failures: string[] = [];
  if (PATHS.length === 0) {
    console.error("SMOKE_CSV_PATHS is empty");
    process.exit(1);
  }
  const client = new Client({ name: "smoke-real", version: "1.0.0" });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`http://${HOST}:${PORT}/mcp`), {
      requestInit: { headers: { Authorization: `Bearer ${TOKEN}` } },
    }),
  );
  const call = async (
    name: string,
    args: Record<string, unknown> = {},
  ): Promise<Record<string, unknown>> => {
    const result = (await client.callTool({ name, arguments: args })) as unknown as ToolResult;
    if (result.isError) {
      throw new Error(`${name} failed: ${JSON.stringify(result.structuredContent)}`);
    }
    return result.structuredContent ?? {};
  };

  try {
    const existing = (await call("sector_list")) as unknown as {
      sectors: { id: string; name: string }[];
    };
    const leftover = existing.sectors.find((s) => s.name === SECTOR);
    if (leftover) {
      await call("sector_delete", { sectorId: leftover.id, confirmName: SECTOR });
      console.log("ok: removed a leftover smoke sector");
    }

    const created = (await call("sector_create", {
      name: SECTOR,
      csvPaths: PATHS,
    })) as unknown as { sector: { id: string }; imports: FileResult[] };
    const sectorId = created.sector.id;
    for (const r of created.imports) {
      if (r.ok && r.import) {
        const i = r.import;
        console.log(
          `file ${i.filename}: rows=${i.rowsRead} created=${i.createdCount} linked=${i.linkedCount} updated=${i.updatedCount} skipped=${i.skippedCount}`,
        );
      } else {
        fail(`file failed: ${r.path} (${r.error?.message ?? "unknown"})`, failures);
      }
    }
    const sum = (pick: (i: NonNullable<FileResult["import"]>) => number): number =>
      created.imports.reduce((n, r) => n + (r.ok && r.import ? pick(r.import) : 0), 0);
    check(sum((i) => i.rowsRead) === 2559, `rows read = ${sum((i) => i.rowsRead)} (want 2559)`, failures);
    check(
      sum((i) => i.createdCount) === 2559,
      `created = ${sum((i) => i.createdCount)} (want 2559)`,
      failures,
    );

    const list0 = (await call("company_list", { sectorId, pageSize: 50 })) as unknown as {
      total: number;
    };
    check(list0.total === 2559, `companies = ${list0.total} (want 2559)`, failures);

    let noDomain = 0;
    let seen = 0;
    for (let page = 1; ; page++) {
      const chunk = (await call("company_list", {
        sectorId,
        page,
        pageSize: 200,
      })) as unknown as { items: { domain: string | null }[]; total: number };
      if (page === 1) seen = chunk.total;
      if (chunk.items.length === 0) break;
      noDomain += chunk.items.filter((c) => c.domain === null).length;
      if (page * 200 >= chunk.total) break;
    }
    check(seen === 2559, `paged companies = ${seen} (want 2559)`, failures);
    check(noDomain === 28, `companies with no domain = ${noDomain} (want 28)`, failures);

    const shared = (await call("company_list", {
      sectorId,
      sharedDomain: true,
      pageSize: 200,
    })) as unknown as { items: { domain: string | null }[]; total: number };
    const sharedDomains = new Set(shared.items.map((c) => c.domain));
    check(shared.total === 3, `shared_domain companies = ${shared.total} (want 3)`, failures);
    check(sharedDomains.size === 1, `shared domains = ${sharedDomains.size} (want 1)`, failures);

    const reimport = (await call("companies_import_csv", {
      sectorId,
      paths: PATHS,
    })) as unknown as { imports: FileResult[] };
    const resum = (pick: (i: NonNullable<FileResult["import"]>) => number): number =>
      reimport.imports.reduce((n, r) => n + (r.ok && r.import ? pick(r.import) : 0), 0);
    check(
      resum((i) => i.createdCount) === 0,
      `re-import created = ${resum((i) => i.createdCount)} (want 0)`,
      failures,
    );
    check(
      resum((i) => i.updatedCount) === 2559,
      `re-import updated = ${resum((i) => i.updatedCount)} (want 2559)`,
      failures,
    );
    const list1 = (await call("company_list", { sectorId, pageSize: 50 })) as unknown as {
      total: number;
    };
    check(list1.total === 2559, `companies after re-import = ${list1.total} (want 2559)`, failures);

    const fac = (await call("company_facets", { sectorId })) as unknown as {
      countries: { value: string }[];
      industries: { value: string }[];
      technologies: { value: string }[];
    };
    const combos: Record<string, unknown>[] = [
      { search: "skin" },
      { search: "beauty" },
      { search: "lab" },
      { search: "glow" },
    ];
    if (fac.countries[0]) combos.push({ country: [fac.countries[0].value] });
    if (fac.countries[1]) combos.push({ country: [fac.countries[1].value] });
    if (fac.countries[0] && fac.countries[1]) {
      combos.push({ country: [fac.countries[0].value, fac.countries[1].value] });
    }
    for (const band of ["1-10", "11-50", "51-200", "201-500", "501+"]) {
      combos.push({ employeeBand: [band] });
    }
    if (fac.technologies[0]) combos.push({ technologiesAny: [fac.technologies[0].value] });
    if (fac.technologies[1]) combos.push({ technologiesAny: [fac.technologies[1].value] });
    if (fac.industries[0]) combos.push({ industry: [fac.industries[0].value] });
    combos.push({ hasFunding: true });
    combos.push({ hasFunding: false });
    combos.push({ sort: "employees", order: "desc" });
    combos.push({ sort: "revenue", order: "desc" });
    combos.push({ sort: "founded", order: "asc" });
    while (combos.length < 20) combos.push({ page: combos.length + 1 });
    const picked = combos.slice(0, 20);
    const durations: number[] = [];
    for (const combo of picked) {
      const res = (await call("company_list", {
        sectorId,
        pageSize: 50,
        ...combo,
      })) as unknown as { durationMs: number };
      durations.push(res.durationMs);
    }
    durations.sort((a, b) => a - b);
    const p95 = percentile(durations, 95);
    console.log(`company_list durations over 20 combos: p50=${percentile(durations, 50).toFixed(1)}ms p95=${p95.toFixed(1)}ms max=${durations[durations.length - 1]?.toFixed(1)}ms`);
    check(p95 < 300, `company_list p95 = ${p95.toFixed(1)}ms (want < 300ms)`, failures);

    const sample = (await call("company_list", { sectorId, pageSize: 50 })) as unknown as {
      items: unknown[];
    };
    const pageBytes = Buffer.byteLength(JSON.stringify(sample.items), "utf8");
    console.log(
      `50-row page payload: ${(pageBytes / 1024).toFixed(1)} KB (${pageBytes} bytes, ${sample.items.length} rows)`,
    );

    if (failures.length === 0) {
      await call("sector_delete", { sectorId, confirmName: SECTOR });
      console.log("ok: smoke sector cleaned up");
    } else {
      console.error(`keeping sector "${SECTOR}" for inspection`);
    }
  } finally {
    await client.close();
  }

  if (failures.length > 0) {
    console.error(`${failures.length} smoke check(s) failed`);
    process.exit(1);
  }
  console.log("smoke: all checks passed");
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
