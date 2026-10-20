import { eq } from "drizzle-orm";
import type { DbLike } from "../../db/client.js";
import { area, areaStatuses, areaStatus, researchRuns } from "../../db/schema.js";
import { DomainError } from "../errors.js";

export interface SetAreaStatusInput {
  runId: string;
  area: string;
  status: string;
  reason?: string | null;
}

export async function setAreaStatus(db: DbLike, input: SetAreaStatusInput): Promise<void> {
  const [run] = await db
    .select({ id: researchRuns.id, companyId: researchRuns.companyId })
    .from(researchRuns)
    .where(eq(researchRuns.id, input.runId));
  if (!run) throw new DomainError("not_found", `run not found: ${input.runId}`);
  if (!area.enumValues.includes(input.area as (typeof area.enumValues)[number])) {
    throw new DomainError(
      "invalid_input",
      `unknown area "${input.area}". Valid areas: ${area.enumValues.join(", ")}`,
    );
  }
  if (!areaStatus.enumValues.includes(input.status as (typeof areaStatus.enumValues)[number])) {
    throw new DomainError(
      "invalid_input",
      `unknown status "${input.status}". Valid statuses: ${areaStatus.enumValues.join(", ")}`,
    );
  }
  if (input.status !== "done" && !input.reason) {
    throw new DomainError("invalid_input", `area status "${input.status}" needs a reason`);
  }
  await db
    .insert(areaStatuses)
    .values({
      runId: run.id,
      area: input.area as typeof areaStatuses.$inferInsert.area,
      companyId: run.companyId,
      status: input.status as typeof areaStatuses.$inferInsert.status,
      reason: input.status === "done" ? null : (input.reason as string),
    })
    .onConflictDoUpdate({
      target: [areaStatuses.runId, areaStatuses.area],
      set: {
        status: input.status as typeof areaStatuses.$inferInsert.status,
        reason: input.status === "done" ? null : (input.reason as string),
      },
    });
}
