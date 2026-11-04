import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Db } from "../db/client.js";
import { ensureEvidenceLibrary } from "../domain/evidence-library.js";
import { importSnapshot } from "../domain/sec-adv/snapshot.js";
import { registerTool, type AuthContext } from "./auth.js";
import { wrap } from "./result.js";

const secUrl = z.string().url().refine(value => {
  const url = new URL(value);
  return url.protocol === "https:" && ["www.sec.gov", "sec.gov", "adviserinfo.sec.gov"].includes(url.hostname) && !url.username && !url.password;
}, "use the official SEC HTTPS URL");

export function registerBenchmarkTools(server: McpServer, db: Db, auth: AuthContext) {
  registerTool(server, db, auth, "evidence_library_ensure", {
    description: "Create or resolve the internal evidence library and return its sector and company IDs.",
    inputSchema: {},
  }, async () => wrap(async () => ({ summary: "Evidence library ready", data: await ensureEvidenceLibrary(db) })));

  registerTool(server, db, auth, "sec_adv_snapshot_import", {
    description: "Match an allowlisted SEC Form ADV monthly CSV or ZIP to existing sector members. Dry run by default.",
    inputSchema: {
      sectorId: z.string().uuid(), path: z.string().min(1), snapshotDate: z.string(),
      sourceUrl: secUrl, dryRun: z.boolean().optional(), companyIds: z.array(z.string().uuid()).max(200).optional(),
    },
  }, async input => wrap(async () => {
    const data = await importSnapshot(db, input);
    return { summary: `${data.counts.crd + data.counts.secNumber} verified matches, ${data.candidates.length} unverified candidates`, data };
  }));
}
