import { randomUUID } from "node:crypto";
import type { Db } from "../../src/db/client.js";
import { companies, researchRuns, type NewCompany } from "../../src/db/schema.js";

export async function seedCompany(db: Db, opts: Partial<NewCompany> = {}): Promise<string> {
  const [row] = await db
    .insert(companies)
    .values({ id: randomUUID(), source: "manual", name: "Fake Site Co", ...opts })
    .returning({ id: companies.id });
  if (!row) throw new Error("no company row");
  return row.id;
}

export async function seedRun(db: Db, companyId: string): Promise<string> {
  const [row] = await db
    .insert(researchRuns)
    .values({ id: randomUUID(), companyId, kind: "collect", status: "running" })
    .returning({ id: researchRuns.id });
  if (!row) throw new Error("no run row");
  return row.id;
}
