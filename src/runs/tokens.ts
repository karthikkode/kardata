import { createHash, randomBytes } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import type { DbLike } from "../db/client.js";
import { researchRuns, runTokens } from "../db/schema.js";
import { DomainError } from "../domain/errors.js";

/**
 * Per-run agent tokens (Stage 3b Step 1). One token per agent run, scoped to
 * the run's company; revoked when the run ends (any status). Only the
 * sha256 hash is stored.
 */

export const RUN_TOKEN_PREFIX = "krau_";

export function hashRunToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export interface IssueRunTokenInput {
  runId: string;
  companyId: string;
  /** Minutes from now; the runner passes the run wall-time limit + 10. */
  ttlMinutes: number;
}

export async function issueRunToken(
  db: DbLike,
  input: IssueRunTokenInput,
): Promise<{ token: string; expiresAt: Date }> {
  if (!Number.isFinite(input.ttlMinutes) || input.ttlMinutes <= 0) {
    throw new DomainError("invalid_input", "ttlMinutes must be positive");
  }
  const [run] = await db
    .select({ id: researchRuns.id, companyId: researchRuns.companyId })
    .from(researchRuns)
    .where(eq(researchRuns.id, input.runId));
  if (!run) throw new DomainError("not_found", `run not found: ${input.runId}`);
  if (run.companyId !== input.companyId) {
    throw new DomainError("invalid_input", `run ${input.runId} belongs to another company`);
  }
  const token = `${RUN_TOKEN_PREFIX}${randomBytes(32).toString("base64url")}`;
  const expiresAt = new Date(Date.now() + input.ttlMinutes * 60_000);
  await db.insert(runTokens).values({
    tokenHash: hashRunToken(token),
    runId: input.runId,
    companyId: input.companyId,
    expiresAt,
  });
  return { token, expiresAt };
}

export interface RunTokenScope {
  runId: string;
  companyId: string;
}

/** Null when unknown, expired or revoked. */
export async function authenticateRunToken(db: DbLike, token: string): Promise<RunTokenScope | null> {
  const [row] = await db
    .select()
    .from(runTokens)
    .where(and(eq(runTokens.tokenHash, hashRunToken(token)), isNull(runTokens.revokedAt)));
  if (!row) return null;
  if (row.expiresAt.getTime() <= Date.now()) return null;
  return { runId: row.runId, companyId: row.companyId };
}

export async function revokeRunToken(db: DbLike, runId: string): Promise<void> {
  await db
    .update(runTokens)
    .set({ revokedAt: new Date() })
    .where(and(eq(runTokens.runId, runId), isNull(runTokens.revokedAt)));
}
