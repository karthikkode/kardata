import { createReadStream } from "node:fs";
import { open, type FileHandle } from "node:fs/promises";
import { createInflateRaw } from "node:zlib";
import { pipeline } from "node:stream/promises";
import { parse } from "csv-parse";
import { SecFileError } from "./parse.js";

type Member = { name: string; method: number; size: number; localOffset: number };

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
  const parser = parse({
    bom: true, skip_empty_lines: true, max_record_size: 1024 * 1024,
    columns: (headers: string[]) => {
      const trimmed = headers.map(header => header.trim());
      if (required.some(key => !trimmed.includes(key))) throw new SecFileError(`unexpected headers in ${member.name}`);
      return trimmed;
    },
    encoding: "latin1",
  });
  const consume = async (records: AsyncIterable<Record<string, string>>) => {
    const legacy = new TextDecoder("windows-1252");
    for await (const row of records) {
      for (const key of Object.keys(row)) {
        const value = row[key]!;
        if (/[^\x00-\x7f]/.test(value)) {
          const bytes = Buffer.from(value, "latin1");
          const utf8 = bytes.toString("utf8");
          row[key] = utf8.includes("\ufffd") ? legacy.decode(bytes) : utf8;
        }
      }
      visit(row);
    }
  };
  if (inflate) await pipeline(input, inflate, parser, consume);
  else await pipeline(input, parser, consume);
}
