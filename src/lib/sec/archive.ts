import { createReadStream } from "node:fs";
import { open, type FileHandle } from "node:fs/promises";
import { createInflateRaw } from "node:zlib";
import { pipeline } from "node:stream/promises";
import { Transform, type Readable, type TransformCallback } from "node:stream";
import { parse } from "csv-parse";
import { parse as parseRecord } from "csv-parse/sync";
import { SecFileError } from "./parse.js";

type Member = { name: string; method: number; size: number; localOffset: number };

export type ArchiveCsvReport = {
  file: string; rows: number; accepted: number; tolerant: number; rejected: number;
  rejections: { line: number; endLine: number; expectedColumns: number; actualColumns: number }[];
};

/** Repair only non-closing quotes; never discard delimiters or strip outer quotes. */
class ArchiveQuotes extends Transform {
  private pending = "";
  private first = true;
  private quoted = false;
  private fieldStart = true;
  private hasContent = false;
  private tolerant = false;
  private line = 1;
  private startLine = 1;
  private raw = "";
  readonly rows: { line: number; endLine: number; tolerant: boolean; raw: string }[] = [];

  static normalize(raw: string) { return new ArchiveQuotes().repair(raw, true).toString("latin1"); }

  private repair(chunk: string, final: boolean) {
    const text = this.pending + chunk;
    this.pending = "";
    if (this.first && text.length < 3 && !final) { this.pending = text; return Buffer.alloc(0); }
    let i = this.first && text.startsWith("\xef\xbb\xbf") ? 3 : 0;
    this.first = false;
    let copied = 0;
    let rawCopied = 0;
    const pieces: string[] = [];
    // Keep one byte of lookahead, including across stream chunk boundaries.
    for (; i < text.length - (final ? 0 : 1); i++) {
      const char = text[i], next = text[i + 1];
      if (char === "\r" || char === "\n") {
        if (!this.quoted) {
          if (this.hasContent) this.rows.push({ line: this.startLine, endLine: this.line,
            tolerant: this.tolerant, raw: this.raw + text.slice(rawCopied, i) });
          this.raw = "";
          rawCopied = i + (char === "\r" && next === "\n" ? 2 : 1);
          this.hasContent = false;
          this.tolerant = false;
          this.fieldStart = true;
          this.startLine = this.line + 1;
        }
        this.line++;
        if (char === "\r" && next === "\n") i++;
        continue;
      }
      this.hasContent = true;
      if (char === '"') {
        if (this.quoted) {
          if (next === '"') i++; // A normal escaped quote stays byte-for-byte intact.
          else if (next === "," || next === "\r" || next === "\n" || next === undefined) this.quoted = false;
          else {
            pieces.push(text.slice(copied, i), '""');
            copied = i + 1;
            this.tolerant = true;
          }
        } else if (this.fieldStart) this.quoted = true;
        else this.tolerant = true; // Literal quote in an unquoted field (relax_quotes).
        this.fieldStart = false;
      } else if (!this.quoted) this.fieldStart = char === ",";
    }
    pieces.push(text.slice(copied, i));
    this.raw += text.slice(rawCopied, i);
    this.pending = text.slice(i);
    if (final && this.hasContent) this.rows.push({ line: this.startLine, endLine: this.line, tolerant: this.tolerant, raw: this.raw });
    return Buffer.from(pieces.join(""), "latin1");
  }

  override _transform(chunk: Buffer, _encoding: BufferEncoding, callback: TransformCallback) {
    this.push(this.repair(chunk.toString("latin1"), false));
    callback();
  }

  override _flush(callback: TransformCallback) {
    this.push(this.repair("", true));
    callback();
  }
}

function repairClosingQuote(raw: string, columns: number): string[] | null {
  // Never reinterpret a syntactically valid row merely to make its width fit.
  try { parseRecord(raw); return null; } catch { /* Consider only malformed CSV. */ }
  const candidates = [...raw.matchAll(/"{2,}(?=,|\r|\n|$)/g)]
    .filter(match => match[0].length % 2 === 0 && match.index > 0 && raw[match.index - 1] !== ",");
  if (candidates.length > 32) return null;
  let result: string[] | null = null;
  for (const match of candidates) {
    const end = match.index + match[0].length;
    try {
      // Preserve the literal quote and add its missing field terminator.
      const rows = parseRecord(ArchiveQuotes.normalize(raw.slice(0, end) + '"' + raw.slice(end))) as string[][];
      if (rows.length !== 1 || rows[0]!.length !== columns) continue;
      if (result) return null; // Ambiguous repairs stay rejected.
      result = rows[0]!;
    } catch { /* This candidate is not structurally valid. */ }
  }
  return result;
}

async function read(file: FileHandle, size: number, position: number) {
  const buffer = Buffer.alloc(size);
  if ((await file.read(buffer, 0, size, position)).bytesRead !== size) throw new SecFileError("truncated ZIP");
  return buffer;
}

/** List regular, single-disk SEC ZIP members by reading only the central directory. */
export async function zipMembers(path: string): Promise<Member[]> {
  const file = await open(path, "r");
  try {
    const { size } = await file.stat();
    const tailSize = Math.min(size, 65557);
    const tail = await read(file, tailSize, size - tailSize);
    let end = tail.length - 22;
    while (end >= 0 && (tail.readUInt32LE(end) !== 0x06054b50 || end + 22 + tail.readUInt16LE(end + 20) !== tail.length)) end--;
    if (end < 0 || tail.readUInt32LE(end + 4) !== 0) throw new SecFileError("expected a single-disk ZIP");
    const count = tail.readUInt16LE(end + 10);
    const bytes = tail.readUInt32LE(end + 12);
    const start = tail.readUInt32LE(end + 16);
    if (count === 65535 || bytes > 16 * 1024 * 1024 || start + bytes > size) throw new SecFileError("unsupported ZIP directory");
    const directory = await read(file, bytes, start);
    const members: Member[] = [];
    let offset = 0;
    for (let i = 0; i < count; i++) {
      if (offset + 46 > bytes || directory.readUInt32LE(offset) !== 0x02014b50) throw new SecFileError("invalid ZIP member");
      const length = directory.readUInt16LE(offset + 28);
      const name = directory.subarray(offset + 46, offset + 46 + length).toString("utf8");
      const member = {
        name, method: directory.readUInt16LE(offset + 10), size: directory.readUInt32LE(offset + 20),
        localOffset: directory.readUInt32LE(offset + 42),
      };
      offset += 46 + length + directory.readUInt16LE(offset + 30) + directory.readUInt16LE(offset + 32);
      if (offset > bytes || member.localOffset + member.size > start) throw new SecFileError("invalid ZIP member range");
      members.push(member);
    }
    return members;
  } finally {
    await file.close();
  }
}

export async function openZipEntry(path: string, member: Member) {
  const file = await open(path, "r");
  let start: number;
  try {
    const header = await read(file, 30, member.localOffset);
    if (header.readUInt32LE(0) !== 0x04034b50 || (header.readUInt16LE(6) & 1) !== 0) {
      throw new SecFileError("invalid or encrypted ZIP member");
    }
    start = member.localOffset + 30 + header.readUInt16LE(26) + header.readUInt16LE(28);
  } finally {
    await file.close();
  }
  if (!member.size || (member.method !== 0 && member.method !== 8)) throw new SecFileError("empty or unsupported ZIP member");
  const input = createReadStream(path, { start, end: start + member.size - 1 });
  return { input, inflate: member.method === 8 ? createInflateRaw() : null };
}

export async function forEachZipCsv(path: string, member: Member, visit: (row: Record<string, string>) => void, required: string[] = []) {
  const { input, inflate } = await openZipEntry(path, member);
  return readArchiveCsv(input, member.name, visit, required, inflate);
}

export async function readArchiveCsv(input: Readable, file: string, visit: (row: Record<string, string>) => void,
  required: string[] = [], inflate: Transform | null = null) {
  const report: ArchiveCsvReport = { file, rows: 0, accepted: 0, tolerant: 0, rejected: 0, rejections: [] };
  const quotes = new ArchiveQuotes();
  const parser = parse({
    bom: true, skip_empty_lines: true, max_record_size: 1024 * 1024,
    encoding: "latin1", relax_quotes: true, relax_column_count: true,
  });
  let headers: string[] | undefined;
  const consume = async (records: AsyncIterable<string[]>) => {
    const legacy = new TextDecoder("windows-1252");
    for await (let values of records) {
      const position = quotes.rows.shift()!;
      if (!headers) {
        headers = values.map(header => header.trim());
        if (new Set(headers).size !== headers.length || required.some(key => !headers!.includes(key))) {
          throw new SecFileError(`unexpected headers in ${file}`);
        }
        continue;
      }
      report.rows++;
      if (values.length !== headers.length) {
        const repaired = repairClosingQuote(position.raw, headers.length);
        if (repaired) { values = repaired; position.tolerant = true; }
      }
      if (position.tolerant) report.tolerant++;
      if (values.length !== headers.length) {
        report.rejected++;
        report.rejections.push({ line: position.line, endLine: position.endLine,
          expectedColumns: headers.length, actualColumns: values.length });
        continue;
      }
      const row = Object.fromEntries(headers.map((header, index) => [header, values[index]!]));
      for (const key of Object.keys(row)) {
        const value = row[key]!;
        if (/[^\x00-\x7f]/.test(value)) {
          const bytes = Buffer.from(value, "latin1");
          const utf8 = bytes.toString("utf8");
          row[key] = utf8.includes("\ufffd") ? legacy.decode(bytes) : utf8;
        }
      }
      visit(row);
      report.accepted++;
    }
  };
  try {
    if (inflate) await pipeline(input, inflate, quotes, parser, consume);
    else await pipeline(input, quotes, parser, consume);
  } catch (error) {
    throw new SecFileError(`${file}: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!headers) throw new SecFileError(`missing headers in ${file}`);
  return report;
}
