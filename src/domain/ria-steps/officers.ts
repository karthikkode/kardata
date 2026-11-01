import { createHash } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "../../db/client.js";
import { records, recordTypes } from "../../db/schema.js";
import { cleanScheduleATitle } from "../../lib/sec/schedule-a.js";
import { eligibleCompanyIds } from "./status.js";

/** Repair stored SEC officer titles in place; no collection, AI, or provenance changes. */
export async function cleanStoredOfficerTitles(
  db: Db,
  input: { sectorId: string; companyIds: string[]; dryRun?: boolean },
): Promise<{ considered: number; matched: number; updated: number; dryRun: boolean }> {
  const requested = new Set(input.companyIds);
  const ids = (await eligibleCompanyIds(db, input.sectorId)).filter((id) => requested.has(id));
  const dryRun = input.dryRun !== false;
  if (!ids.length) return { considered: 0, matched: 0, updated: 0, dryRun };
  const rows = await db.select().from(records).where(and(
    inArray(records.companyId, ids), eq(records.type, "leader"), eq(records.createdBy, "collector:sec_firm"),
  ));
  const [type] = await db.select().from(recordTypes).where(eq(recordTypes.name, "leader"));
  if (!type) throw new Error("leader record type missing");
  let matched = 0;
  let updated = 0;
  for (const row of rows) {
    const title = row.data["title"];
    if (typeof title !== "string") continue;
    const clean = cleanScheduleATitle(title);
    if (!clean || clean === title) continue;
    matched += 1;
    if (dryRun) continue;
    const keyParts = Object.fromEntries([...type.naturalKey].sort().map((key) => [key, key === "title" ? clean : row.data[key]]));
    const hash = createHash("sha256").update(JSON.stringify(keyParts)).digest("hex");
    const [canonical] = await db.select({ id: records.id }).from(records).where(and(
      eq(records.companyId, row.companyId), eq(records.type, "leader"), eq(records.naturalKeyHash, hash),
    ));
    // Re-key corrected titles so later collector upserts match. If a canonical
    // record already exists, retain this legacy key rather than deleting either
    // record or losing its provenance. Subsequent upserts find the canonical one.
    // Change only title, guarding against concurrent edits. Keep citations,
    // verbatim quotes, tags, ids and run history intact.
    const changed = await db.update(records).set({
      naturalKeyHash: canonical && canonical.id !== row.id ? row.naturalKeyHash : hash,
      data: sql`jsonb_set(${records.data}, '{title}', to_jsonb(${clean}::text))`,
    }).where(and(eq(records.id, row.id), sql`${records.data}->>'title' = ${title}`)).returning({ id: records.id });
    updated += changed.length;
  }
  return { considered: rows.length, matched, updated, dryRun };
}
