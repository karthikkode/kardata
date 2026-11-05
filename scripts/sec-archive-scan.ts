/** Read-only archive validation. No environment loading, database or network access. */
import { basename } from "node:path";
import { forEachZipCsv, zipMembers } from "../src/lib/sec/archive.js";
import { parseSecDate } from "../src/lib/sec/parse.js";

const paths = process.argv.slice(2);
if (paths.length !== 2) throw new Error("usage: tsx scripts/sec-archive-scan.ts <part1.zip> <part2.zip>");
// Include Base B for the importer's historical snapshot fallback as well.
const tables = /^IA_(?:ADV_Base_[AB]|Schedule_A_B|Schedule_D_(?:1F|1I|5K3|7A))_\d{8}_\d{8}\.csv$/;
const files = [];
let scanned = 0;
for (const path of paths) {
  for (const member of (await zipMembers(path)).filter(entry => tables.test(basename(entry.name)))) {
    scanned++;
    console.error(`Scanning ${basename(member.name)}`);
    let newestFilingDate: string | null = null;
    try {
      const report = await forEachZipCsv(path, member, row => {
        const date = parseSecDate(row.DateSubmitted?.split(" ")[0]);
        if (date && (!newestFilingDate || date > newestFilingDate)) newestFilingDate = date;
      });
      files.push({ archive: basename(path), ...report, newestFilingDate });
      if (report.rejected) process.exitCode = 1;
    } catch (error) {
      files.push({ archive: basename(path), file: member.name, error: String(error) });
      process.exitCode = 1;
    }
  }
}
if (scanned !== 7) { process.exitCode = 1; console.error(`Expected 7 importer tables; found ${scanned}`); }
console.log(JSON.stringify({ files }, null, 2));
