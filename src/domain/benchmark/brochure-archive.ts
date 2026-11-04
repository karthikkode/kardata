import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import { and, eq } from "drizzle-orm";
import type { Db } from "../../db/client.js";
import { documents, sources } from "../../db/schema.js";
import { getImportDirs } from "../../lib/env.js";
import { openZipEntry, zipMembers } from "../../lib/sec/archive.js";
import { pdfText } from "../../lib/sec/pdf-text.js";
import { DomainError } from "../errors.js";
import { checkImportPaths } from "../imports.js";
import { storeBlob } from "../research/sources.js";
import { saveDocument } from "../research/documents.js";
import { isValidDateString } from "../research/validate.js";
import { brochureKind, splitBrochureItems } from "../ria-steps/brochure.js";
import { canonicalFile, companyFileEvidence, lockEvidence } from "../sec-adv/evidence.js";
import { activeMembers, normalizeCrd } from "../sec-adv/snapshot.js";
import { ITEM_5_PATH } from "./brochure-review.js";

const COLLECTOR = "sec_adv_brochure_archive";
const PDF_LIMIT = 25 * 1024 * 1024;

export async function importBrochureArchive(db: Db, input: {
  sectorId: string; path: string; sourceUrl: string; mappingUrl: string; entries: { crd: string; member: string; filedOn: string }[];
  dryRun?: boolean;
}, extractPdf = pdfText) {
  const [path] = await checkImportPaths([input.path], getImportDirs(), 4 * 1024 ** 3);
  const cohort = new Map((await activeMembers(db, input.sectorId)).flatMap(row => {
    const crd = normalizeCrd(row.crd);
    return crd ? [[crd, row.id] as const] : [];
  }));
  const members = await zipMembers(path!);
  const rows = input.entries.map(entry => {
    if (!isValidDateString(entry.filedOn)) throw new DomainError("invalid_input", "filedOn must be YYYY-MM-DD");
    const crd = normalizeCrd(entry.crd);
    const companyId = crd && cohort.get(crd);
    const matches = members.filter(member => member.name === entry.member && /\.pdf$/i.test(member.name));
    if (!companyId || matches.length !== 1) throw new DomainError("invalid_input", "mapping entry requires one PDF member and a verified sector CRD");
    return { ...entry, companyId, archiveMember: matches[0]! };
  });
  if (new Set(rows.map(row => row.companyId)).size !== rows.length) {
    throw new DomainError("invalid_input", "provide one verified current Part 2A entry per company");
  }
  if (input.dryRun !== false) return { matched: rows.length, written: 0, gaps: [] };
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path!)) hash.update(chunk as Buffer);
  const file = await db.transaction(tx => canonicalFile(tx, {
    collector: COLLECTOR, release: input.sourceUrl, url: input.sourceUrl,
    filename: new URL(input.sourceUrl).pathname.split("/").at(-1)!, digest: hash.digest("hex"),
  }));
  let written = 0;
  const gaps: { companyId: string; reason: string }[] = [];
  for (const row of rows) {
    const { input: stream, inflate } = await openZipEntry(path!, row.archiveMember);
    const extract = async (chunks: AsyncIterable<Buffer>) => {
      const buffers: Buffer[] = [];
      let bytes = 0;
      for await (const chunk of chunks) {
        bytes += chunk.length;
        if (bytes > PDF_LIMIT) throw new Error("brochure exceeds 25 MB");
        buffers.push(chunk);
      }
      return Buffer.concat(buffers);
    };
    let pdf: Buffer;
    let text: string;
    try {
      pdf = await (inflate ? pipeline(stream, inflate, extract) : pipeline(stream, extract));
      const full = await extractPdf(pdf);
      if (brochureKind(full) === "supplement") {
        gaps.push({ companyId: row.companyId, reason: "archive member is a Part 2B supplement" });
        continue;
      }
      text = splitBrochureItems(full)["5"] ?? "";
    } catch {
      gaps.push({ companyId: row.companyId, reason: "archive brochure PDF could not be read" });
      continue;
    }

    written += await db.transaction(async tx => {
      await lockEvidence(tx, `company:${row.companyId}:fees`);
      const [current] = await tx.select().from(documents).where(and(
        eq(documents.companyId, row.companyId), eq(documents.path, ITEM_5_PATH), eq(documents.isCurrent, true),
      ));
      const contentMd = `Filed ${row.filedOn}\nPDF source: ${input.sourceUrl} — ${row.member}\n\n${text || "PDF retained for page review. No Item 5 section was extracted."}`;
      const currentDate = current?.title.match(/\b\d{4}-\d\d-\d\d\b/)?.[0];
      const sha256 = createHash("sha256").update(pdf).digest("hex");
      if (currentDate && currentDate > row.filedOn) return 0;
      if (currentDate === row.filedOn && current?.sourceIds?.length) {
        const [existing] = await tx.select({ digest: sources.blobSha256 }).from(sources).where(eq(sources.id, current.sourceIds[0]!));
        if (existing?.digest === sha256) return 0;
      }
      const evidence = await companyFileEvidence(tx, file, row.companyId, {
        member: row.member, mappingUrl: input.mappingUrl, filedOn: row.filedOn,
      });
      await storeBlob(tx, "application/pdf", pdf);
      await tx.update(sources).set({ blobSha256: sha256 }).where(eq(sources.id, evidence.id));
      await saveDocument(tx, { companyId: row.companyId, runId: evidence.runId, path: ITEM_5_PATH,
        title: `Part 2A brochure Item 5 (${row.filedOn})`, contentMd, sourceIds: [evidence.id], createdBy: COLLECTOR });
      return 1;
    });
  }
  return { matched: rows.length, written, gaps };
}
