import type { McpServer, RegisteredTool, ToolCallback } from "@modelcontextprotocol/sdk/server/mcp.js";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { recordEvent } from "../collect/db.js";
import type { Db } from "../db/client.js";
import { researchRuns } from "../db/schema.js";
import { DomainError } from "../domain/errors.js";
import { storeBlob } from "../domain/research/sources.js";
import { getOrCreateManualRun } from "../runs/queue.js";
import { fail } from "./result.js";

/**
 * Caller identity for MCP tools (Stage 3b Step 1). The operator token sees
 * every tool with no scoping; a run token sees only AGENT_TOOLSET, forced to
 * its run's company, with every call audited to run_events.
 */
export type AuthContext =
  | { kind: "operator" }
  | { kind: "run"; runId: string; companyId: string };

export const OPERATOR_AUTH: AuthContext = { kind: "operator" };

export const AGENT_TOOLSET = new Set([
  "registry_list",
  "registry_describe",
  "company_context",
  "facts_get",
  "records_list",
  "search",
  "document_list",
  "document_get",
  "document_history",
  "source_fetch",
  "source_get",
  "source_capture",
  "fact_add",
  "record_upsert",
  "reviews_ingest",
  "document_save",
  "finding_add",
  "area_status_set",
  "run_finish",
  "preflight_report_save",
]);

/** Preflight runs are recon-only: reads plus the report save plus finish. */
export const PREFLIGHT_TOOLSET = new Set([
  "registry_list",
  "registry_describe",
  "company_context",
  "facts_get",
  "records_list",
  "search",
  "document_list",
  "document_get",
  "document_history",
  "source_fetch",
  "source_get",
  "preflight_report_save",
  "run_finish",
]);

const AUDIT_ARGS_MAX = 2048;
const AUDIT_RESULT_INLINE_MAX = 2048;
const AUDIT_BLOB_MAX = 262144;

export interface AuditOverflow {
  inline: string;
  sha: string | null;
  truncated: boolean;
}

/**
 * Inline small texts, blob-store medium ones, and record size + a truncated
 * flag for huge ones (replay fidelity without unbounded jsonb).
 */
export async function auditInlineOrBlob(db: Db, text: string, inlineMax: number): Promise<AuditOverflow> {
  if (text.length <= inlineMax) return { inline: text, sha: null, truncated: false };
  if (text.length <= AUDIT_BLOB_MAX) {
    const sha = await storeBlob(db, "application/json", Buffer.from(text, "utf8"));
    return { inline: text.slice(0, inlineMax), sha, truncated: false };
  }
  return { inline: text.slice(0, inlineMax), sha: null, truncated: true };
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value ?? null);
  } catch {
    return "(unserializable)";
  }
}

/** Structural copy of the SDK ToolAnnotations (not re-exported by mcp.js). */
export interface ToolHints {
  title?: string;
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
}

function resultStatus(result: unknown): string {
  if (typeof result !== "object" || result === null) return "unknown";
  const r = result as { isError?: unknown; structuredContent?: unknown };
  if (r.isError !== true) return "ok";
  const code = (r.structuredContent as { code?: unknown } | null)?.code;
  return typeof code === "string" ? code : "error";
}

async function auditCall(
  db: Db,
  runId: string,
  tool: string,
  args: unknown,
  result: unknown,
  startedAt: number,
): Promise<void> {
  try {
    const argsRef = await auditInlineOrBlob(db, safeJson(args ?? {}), AUDIT_ARGS_MAX);
    const resultJson = safeJson(result);
    const resultRef = await auditInlineOrBlob(db, resultJson, AUDIT_RESULT_INLINE_MAX);
    await recordEvent(db, runId, "mcp_call", {
      tool,
      args: argsRef.inline,
      argsSha: argsRef.sha,
      argsTruncated: argsRef.truncated,
      status: resultStatus(result),
      durationMs: Math.round(performance.now() - startedAt),
      result: resultRef.inline,
      resultSha: resultRef.sha,
      resultSize: Buffer.byteLength(resultJson, "utf8"),
      resultTruncated: resultRef.truncated,
    });
  } catch (err) {
    // The audit must never mask the tool result (same DB, so this is rare).
    console.error(`audit failed for ${tool}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * registerTool with run-token gating and auditing. Inference for the handler
 * args is preserved from the input schema, as with server.registerTool.
 */
export function registerTool<Args extends z.ZodRawShape | undefined>(
  server: McpServer,
  db: Db,
  auth: AuthContext,
  name: string,
  config: {
    title?: string;
    description?: string;
    inputSchema?: Args;
    annotations?: ToolHints;
  },
  handler: ToolCallback<Args>,
): RegisteredTool {
  const wrapped = (async (args: Record<string, unknown>, extra: unknown) => {
    const startedAt = performance.now();
    if (auth.kind === "run" && !AGENT_TOOLSET.has(name)) {
      const result = fail("forbidden", `run tokens cannot call ${name}`);
      await auditCall(db, auth.runId, name, args, result, startedAt);
      return result;
    }
    if (auth.kind === "run" && !PREFLIGHT_TOOLSET.has(name)) {
      const [run] = await db
        .select({ stage: researchRuns.stage })
        .from(researchRuns)
        .where(eq(researchRuns.id, auth.runId));
      if (run?.stage === "preflight") {
        const result = fail("forbidden", "preflight runs can only read and save the preflight report");
        await auditCall(db, auth.runId, name, args, result, startedAt);
        return result;
      }
    }
    const result = await (handler as (a: unknown, e: unknown) => Promise<unknown>)(args, extra);
    if (auth.kind === "run") {
      await auditCall(db, auth.runId, name, args, result, startedAt);
    }
    return result;
  }) as ToolCallback<Args>;
  return server.registerTool(name, config, wrapped);
}

/**
 * The company id a call is scoped to. A run token is forced to its company
 * (a different explicit id is forbidden); an absent id is injected for runs
 * (search) and stays absent for the operator (global).
 */
export function scopedCompany(auth: AuthContext, companyId: string): string;
export function scopedCompany(auth: AuthContext, companyId: undefined): string | undefined;
export function scopedCompany(auth: AuthContext, companyId: string | undefined): string | undefined;
export function scopedCompany(auth: AuthContext, companyId: string | undefined): string | undefined {
  if (auth.kind === "operator") return companyId;
  if (companyId !== undefined && companyId !== auth.companyId) {
    throw new DomainError("forbidden", "run token is scoped to another company");
  }
  return auth.companyId;
}

/**
 * The run id a call writes to. A run token is forced to its run; the
 * operator keeps the explicit id or today's manual run.
 */
export async function resolveRunId(
  db: Db,
  auth: AuthContext,
  companyId: string,
  givenRunId: string | undefined,
): Promise<string> {
  if (auth.kind === "run") {
    if (givenRunId !== undefined && givenRunId !== auth.runId) {
      throw new DomainError("forbidden", "run token is scoped to another run");
    }
    return auth.runId;
  }
  return givenRunId ?? getOrCreateManualRun(db, companyId);
}

/** created_by for content writes: owner, or agent:<runId>/<label>. */
export function createdByFor(auth: AuthContext, agentLabel?: string): string {
  if (auth.kind === "operator") return "owner";
  const label = agentLabel?.trim().replace(/\//g, "-") || "main";
  return `agent:${auth.runId}/${label}`;
}

export const agentLabelSchema = z
  .string()
  .max(64)
  .optional()
  .describe('Subagent label for attribution (created_by "agent:<run>/<label>")');
