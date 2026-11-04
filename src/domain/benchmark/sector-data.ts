import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import type { Db } from "../../db/client.js";
import { sectors } from "../../db/schema.js";
import { DomainError } from "../errors.js";
import { sectorSlug } from "../sectors.js";

export async function sectorData(db: Db, sectorId: string, name: string): Promise<unknown> {
  const [sector] = await db.select({ name: sectors.name, library: sectors.evidenceLibrary }).from(sectors).where(eq(sectors.id, sectorId));
  if (!sector || sector.library) throw new DomainError("invalid_input", "select an ordinary sector");
  const file = join("docs", "sectors", sectorSlug(sector.name), name);
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    throw new DomainError("file_error", `cannot load sector data ${file}: ${error instanceof Error ? error.message : String(error)}`);
  }
}
