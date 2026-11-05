import { Readable } from "node:stream";
import { parse } from "csv-parse/sync";
import { expect, it } from "vitest";
import { readArchiveCsv } from "../../src/lib/sec/archive.js";

async function read(csv: string, chunkSize = 64 * 1024) {
  const bytes = Buffer.from(csv);
  const chunks = Array.from({ length: Math.ceil(bytes.length / chunkSize) }, (_, i) => bytes.subarray(i * chunkSize, (i + 1) * chunkSize));
  const rows: Record<string, string>[] = [];
  const report = await readArchiveCsv(Readable.from(chunks), "synthetic.csv", row => rows.push(row));
  return { rows, report };
}

it.each([1, 7, 65536])("retains stray quotes and commas inside a quoted description (chunks=%i)", async size => {
  const csv = 'FilingID,Description,State,Amount\r\n1,"NOT AN "ADVISER, MANAGER" UNDER THE ACT.",WA,100\r\n';
  const { rows, report } = await read(csv, size);
  expect(rows).toEqual([{ FilingID: "1", Description: 'NOT AN "ADVISER, MANAGER" UNDER THE ACT.', State: "WA", Amount: "100" }]);
  expect(report).toEqual({ file: "synthetic.csv", rows: 1, accepted: 1, tolerant: 1, rejected: 0, rejections: [] });
});

it.each([1, 3, 65536])("preserves standard CSV values, escaped quotes, empty fields, BOM and multiline text (chunks=%i)", async size => {
  const csv = '\ufeffFilingID,Description,State\r\n1,"A ""quoted"", café",WA\r\n\r\n2,"two\r\nlines",\r\n3,"",OR';
  const { rows, report } = await read(csv, size);
  expect(rows).toEqual(parse(csv, { bom: true, columns: true, skip_empty_lines: true }));
  expect(report).toMatchObject({ rows: 3, accepted: 3, tolerant: 0, rejected: 0 });
});

it("keeps valid quote runs before delimiters identical to the existing strict parser", async () => {
  const texts = ['"', '""', 'ends"', '"starts', 'a", b', 'a """,b', '",",', 'one\ntwo', 'one\rtwo'];
  const csv = "ID,Text,Tail\n" + texts.map((text, i) => `${i},"${text.replaceAll('"', '""')}",sentinel`).join("\n");
  const { rows, report } = await read(csv, 1);
  expect(rows).toEqual(parse(csv, { columns: true }));
  expect(report).toMatchObject({ rows: texts.length, accepted: texts.length, tolerant: 0, rejected: 0 });
});

it("counts each tolerant row once and retains literal quotes in unquoted fields", async () => {
  const { rows, report } = await read('ID,Text\n1,one "two" "three"\n2,"four "five" six"\n3,normal\n');
  expect(rows.map(row => row.Text)).toEqual(['one "two" "three"', 'four "five" six', "normal"]);
  expect(report).toMatchObject({ rows: 3, accepted: 3, tolerant: 2, rejected: 0 });
});

it.each([1, 65536])("repairs one unambiguous missing closing quote without swallowing the next field (chunks=%i)", async size => {
  const { rows, report } = await read('ID,Text,State,Flag\r\n1,"description ends here"","WA","Y"\r\n', size);
  expect(rows).toEqual([{ ID: "1", Text: 'description ends here"', State: "WA", Flag: "Y" }]);
  expect(report).toMatchObject({ rows: 1, accepted: 1, tolerant: 1, rejected: 0 });
});

it("handles stray inner quotes adjacent to a closing quote while preserving following fields", async () => {
  const { rows, report } = await read('ID,Text,State,Flag\n1,"SEE "OTHER TERMS"","WA","N"\n2,""RELATED ENTITY"","OR","Y"\n');
  expect(rows).toEqual([
    { ID: "1", Text: 'SEE "OTHER TERMS"', State: "WA", Flag: "N" },
    { ID: "2", Text: '"RELATED ENTITY"', State: "OR", Flag: "Y" },
  ]);
  expect(report).toMatchObject({ rows: 2, accepted: 2, tolerant: 2, rejected: 0 });
});

it("does not repair a genuinely missing column by reinterpreting valid escaped quotes before a comma", async () => {
  const { rows, report } = await read('ID,Text,State,Flag\n1,"contains ""quotes"", more",WA\n');
  expect(rows).toEqual([]);
  expect(report).toMatchObject({ rows: 1, accepted: 0, tolerant: 0, rejected: 1,
    rejections: [{ line: 2, expectedColumns: 4, actualColumns: 3 }] });
});

it("rejects too few or too many columns before mapping, with original physical line numbers", async () => {
  const { rows, report } = await read('ID,Text,State\n\n1,"two\nlines",WA\n2,missing\n3,extra,OR,99\n4,"has "stray" quotes",WA,99\n5,valid,OR\n', 1);
  expect(rows.map(row => row.ID)).toEqual(["1", "5"]);
  expect(report).toEqual({ file: "synthetic.csv", rows: 5, accepted: 2, tolerant: 1, rejected: 3,
    rejections: [
      { line: 5, endLine: 5, expectedColumns: 3, actualColumns: 2 },
      { line: 6, endLine: 6, expectedColumns: 3, actualColumns: 4 },
      { line: 7, endLine: 7, expectedColumns: 3, actualColumns: 4 },
    ] });
});

it("keeps fatal truncation and unexpected headers visible instead of skipping them", async () => {
  await expect(read('ID,Text\n1,"never closed\n')).rejects.toThrow(/synthetic.csv:.*Quote Not Closed/);
  await expect(readArchiveCsv(Readable.from(['ID,Text\n1,hello']), "missing.csv", () => undefined, ["FilingID"]))
    .rejects.toThrow("unexpected headers in missing.csv");
  await expect(read('ID,ID\n1,2\n')).rejects.toThrow("unexpected headers in synthetic.csv");
});
