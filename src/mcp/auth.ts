import type { McpServer, RegisteredTool, ToolCallback } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { recordEvent } from "../collect/db.js";
import type { Db } from "../db/client.js";
import { DomainError } from "../domain/errors.js";
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
]);

const AUDIT_ARGS_MAX = 2048;

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
  status: string,
  startedAt: number,
): Promise<void> {
  let argsJson = "";
  try {
    argsJson = JSON.stringify(args ?? {});
  } catch {
    argsJson = "{}";
  }
  try {
    await recordEvent(db, runId, "mcp_call", {
      tool,
      args: argsJson.slice(0, AUDIT_ARGS_MAX),
      status,
      durationMs: Math.round(performance.now() - startedAt),
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
      await auditCall(db, auth.runId, name, args, "forbidden", startedAt);
      return result;
    }
    const result = await (handler as (a: unknown, e: unknown) => Promise<unknown>)(args, extra);
    if (auth.kind === "run") {
      await auditCall(db, auth.runId, name, args, resultStatus(result), startedAt);
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
