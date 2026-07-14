import { inflateRawSync } from 'node:zlib';

/**
 * Minimal read-only zip support — just enough to pull one file out of a data
 * export without taking on a dependency. Stored and deflated entries only;
 * zip64 archives get a clear "unzip it yourself" error instead of garbage.
 */

const EOCD_SIG = 0x06054b50;
const CENTRAL_SIG = 0x02014b50;
const LOCAL_SIG = 0x04034b50;

export function listZipEntries(zip: Buffer): string[] {
  return centralEntries(zip).map((entry) => entry.name);
}

/** Extract the first entry whose name matches. */
export function unzipEntry(
  zip: Buffer,
  match: (name: string) => boolean,
): { name: string; data: Buffer } | undefined {
  const entry = centralEntries(zip).find((e) => match(e.name));
  return entry && { name: entry.name, data: extract(zip, entry) };
}

interface CentralEntry {
  name: string;
  method: number;
  compressedSize: number;
  localOffset: number;
}

function centralEntries(zip: Buffer): CentralEntry[] {
  // The end-of-central-directory record is 22 bytes plus a trailing comment
  // of up to 64k, so scan backwards for its signature.
  let eocd = -1;
  const stop = Math.max(0, zip.length - 22 - 0xffff);
  for (let i = zip.length - 22; i >= stop; i--) {
    if (zip.readUInt32LE(i) === EOCD_SIG) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('not a zip file (no end-of-central-directory record)');
  const count = zip.readUInt16LE(eocd + 10);
  const dirOffset = zip.readUInt32LE(eocd + 16);
  if (count === 0xffff || dirOffset === 0xffffffff) {
    throw new Error('zip64 archive — unzip it first and pass the extracted folder');
  }
  const entries: CentralEntry[] = [];
  let pos = dirOffset;
  for (let i = 0; i < count; i++) {
    if (pos + 46 > zip.length || zip.readUInt32LE(pos) !== CENTRAL_SIG) {
      throw new Error('corrupt zip central directory');
    }
    const nameLen = zip.readUInt16LE(pos + 28);
    const extraLen = zip.readUInt16LE(pos + 30);
    const commentLen = zip.readUInt16LE(pos + 32);
    entries.push({
      name: zip.subarray(pos + 46, pos + 46 + nameLen).toString('utf8'),
      method: zip.readUInt16LE(pos + 10),
      compressedSize: zip.readUInt32LE(pos + 20),
      localOffset: zip.readUInt32LE(pos + 42),
    });
    pos += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

function extract(zip: Buffer, entry: CentralEntry): Buffer {
  const { name, method, compressedSize, localOffset } = entry;
  if (compressedSize === 0xffffffff || localOffset === 0xffffffff) {
    throw new Error(`${name}: zip64 entry — unzip it first and pass the extracted folder`);
  }
  if (localOffset + 30 > zip.length || zip.readUInt32LE(localOffset) !== LOCAL_SIG) {
    throw new Error(`${name}: corrupt local file header`);
  }
  // The local header's name/extra lengths can differ from the central copy.
  const nameLen = zip.readUInt16LE(localOffset + 26);
  const extraLen = zip.readUInt16LE(localOffset + 28);
  const start = localOffset + 30 + nameLen + extraLen;
  const data = zip.subarray(start, start + compressedSize);
  if (method === 0) return Buffer.from(data);
  if (method === 8) return inflateRawSync(data);
  throw new Error(`${name}: unsupported compression method ${method}`);
}
