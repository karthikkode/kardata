import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Db } from "../db/client.js";
import { callBriefsStatus, exportCallBriefs, prepareCallBriefs } from "../domain/call-briefs/prepare.js";
import { registerTool, type AuthContext } from "./auth.js";
import { wrap } from "./result.js";
import { monthlySourceRow } from "../domain/call-briefs/evidence.js";

const batch = { sectorId: z.string().uuid(), companyIds: z.array(z.string().uuid()).min(1).max(100), callDate: z.string() };
export function registerCallBriefTools(server: McpServer, db: Db, auth: AuthContext) {
  registerTool(server, db, auth, "sec_adv_monthly_row", {
    description: "Read one firm's raw row from its verified retained SEC monthly source, after canonical file digest and stored CRD checks. Supports manual source checks; no fetches, model calls or data changes.",
    annotations: { readOnlyHint: true }, inputSchema: { companyId: z.string().uuid(), sourceId: z.string().uuid() },
  }, async input => wrap(async () => ({ summary: "Verified stored SEC monthly row", data: await monthlySourceRow(db, input) })));
  registerTool(server, db, auth, "ria_call_briefs_prepare", {
    description: "Prepare private one-screen solo call briefs from dated stored SEC facts/Schedule A and strict public website/brochure fetches. Codex only, no global provider or quota/job changes. Saves cited facts/guesses in DB and ordered Markdown/CSV under var/sectors/<slug>/analysis/call-briefs-<date>. Reuses ready briefs; process first 20 before later offsets.",
    inputSchema: { ...batch, offset: z.number().int().nonnegative().optional(), limit: z.number().int().min(1).max(20).optional(),
      concurrency: z.number().int().min(1).max(4).optional(), force: z.boolean().optional() },
  }, async input => wrap(async () => {
    const data = await prepareCallBriefs(db, input);
    return { summary: `${data.prepared} prepared, ${data.reused} reused, ${data.errors.length} errors`, data };
  }));
  registerTool(server, db, auth, "ria_call_briefs_status", {
    description: "Read call-list order, stored brief coverage, source-access gaps and word counts without fetching or making model calls.",
    annotations: { readOnlyHint: true }, inputSchema: batch,
  }, async input => wrap(async () => ({ summary: "Private call-brief coverage", data: await callBriefsStatus(db, input) })));
  registerTool(server, db, auth, "ria_call_briefs_export", {
    description: "Re-export existing stored call briefs as ordered private Markdown and CSV, with no network or model calls. Missing firms are listed with their status.",
    inputSchema: batch,
  }, async input => wrap(async () => ({ summary: "Private call briefs exported", data: await exportCallBriefs(db, input) })));
}
