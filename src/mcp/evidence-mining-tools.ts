import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Db } from "../db/client.js";
import { enqueueEvidenceMining, evidenceMiningStatus } from "../domain/research/evidence-mining-jobs.js";
import { checkSourceQuotes } from "../domain/research/source-quote-check.js";
import { registerTool, type AuthContext } from "./auth.js";
import { wrap } from "./result.js";

export function registerEvidenceMiningTools(server: McpServer, db: Db, auth: AuthContext) {
  registerTool(server, db, auth, "evidence_mine_run", {
    description: "Operator: queue restart-safe mining of complete stored library sources. Codex only, high effort, automatic 85% weekly stop; no provider/breaker changes or web fetches. Verifies literal quotes and retains grounded fields after bounded citation repair.",
    inputSchema: { companyId: z.string().uuid(), documentIds: z.array(z.string().uuid()).min(1).max(2000),
      themes: z.array(z.object({ key: z.string().regex(/^[a-z0-9_]+$/).max(64), name: z.string().min(1).max(120), definition: z.string().min(1).max(1000) })).min(1).max(30),
      researchContext: z.string().max(4000).optional(), metadataType: z.string().regex(/^[a-z0-9_]+$/).optional(),
      concurrency: z.number().int().min(1).max(4).optional(), requestId: z.string().uuid().optional(),
      resume: z.boolean().optional().describe("Explicitly resume this request only with fresh Codex capacity below85%; never clears a hold") },
  }, async input => wrap(async () => ({ summary: "Stored-source mining queued", data: await enqueueEvidenceMining(db, input) })));
  registerTool(server, db, auth, "evidence_mine_status", {
    description: "Operator: read mining progress, every pending/exception reason, quote repairs and token/time telemetry. Paged includeEvidence returns the versioned stored records; never resumes a paused job.",
    inputSchema: { jobId: z.string().uuid(), offset: z.number().int().min(0).optional(), limit: z.number().int().min(1).max(100).optional(), includeEvidence: z.boolean().optional() },
  }, async input => wrap(async () => ({ summary: "Stored-source mining status", data: await evidenceMiningStatus(db, input.jobId, input.offset, input.limit, input.includeEvidence) })));
  registerTool(server, db, auth, "evidence_quote_check", {
    description: "Operator: confirm each short quote occurs word for word in its company-owned stored source. Optional physical PDF page; no normalization, fetch, model call or database mutation.",
    inputSchema: { companyId: z.string().uuid(), quotes: z.array(z.object({ sourceId: z.string().uuid(), quote: z.string().min(1).max(800), pdfPage: z.number().int().positive().optional() })).min(1).max(200) },
  }, async input => wrap(async () => ({ summary: "Literal source quote checks", data: await checkSourceQuotes(db, input.companyId, input.quotes) })));
}
