import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { crc32, deflateRawSync } from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { extractChatgptFacts, listZipEntries, unzipEntry } from '../src/index.js';

let scratch: string;

beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), 'engram-chatgpt-'));
});

afterEach(() => {
  rmSync(scratch, { recursive: true, force: true });
});

/**
 * A real ChatGPT export in miniature: memory writes are assistant messages
 * addressed to the `bio` tool; everything else in the conversation is noise.
 */
const conversations = [
  {
    title: 'chat one',
    mapping: {
      a: {
        message: {
          author: { role: 'user' },
          recipient: 'all',
          content: { content_type: 'text', parts: ['remember I have a dog named Biscuit'] },
          create_time: 1710000000,
        },
      },
      b: {
        message: {
          author: { role: 'assistant' },
          recipient: 'bio',
          content: { content_type: 'text', parts: ['User has a dog named Biscuit.'] },
          create_time: 1710000001.5,
        },
      },
      c: {
        message: {
          author: { role: 'tool', name: 'bio' },
          recipient: 'all',
          content: { content_type: 'text', parts: ['Model set context updated.'] },
          create_time: 1710000002,
        },
      },
    },
  },
  {
    mapping: {
      d: {
        message: {
          author: { role: 'assistant' },
          recipient: 'bio',
          content: { parts: ['User prefers TypeScript.'] },
          create_time: 1700000000,
        },
      },
      e: { message: null },
    },
  },
  { mapping: null },
];

function buildZip(entries: Array<{ name: string; data: string }>): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const { name, data } of entries) {
    const raw = Buffer.from(data);
    const compressed = deflateRawSync(raw);
    const nameBuf = Buffer.from(name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt32LE(crc32(raw), 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    const localFull = Buffer.concat([local, nameBuf, compressed]);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4); // version made by
    central.writeUInt16LE(20, 6); // version needed
    central.writeUInt16LE(8, 10); // deflate
    central.writeUInt32LE(crc32(raw), 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(Buffer.concat([central, nameBuf]));
    locals.push(localFull);
    offset += localFull.length;
  }
  const centralBuf = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralBuf, eocd]);
}

describe('zip reader', () => {
  it('lists and extracts deflated entries', () => {
    const zip = buildZip([
      { name: 'user.json', data: '{"id":"u1"}' },
      { name: 'conversations.json', data: '["hello"]' },
    ]);
    expect(listZipEntries(zip)).toEqual(['user.json', 'conversations.json']);
    const entry = unzipEntry(zip, (n) => n.endsWith('conversations.json'));
    expect(entry?.data.toString('utf8')).toBe('["hello"]');
  });

  it('rejects non-zip input clearly', () => {
    expect(() => listZipEntries(Buffer.from('definitely not a zip archive, sorry'))).toThrow(
      /not a zip file/,
    );
  });
});

describe('extractChatgptFacts', () => {
  it('pulls memory writes out of conversations.json, oldest first', () => {
    const path = join(scratch, 'conversations.json');
    writeFileSync(path, JSON.stringify(conversations));
    const { facts, errors } = extractChatgptFacts(path);
    expect(errors).toEqual([]);
    expect(facts.map((f) => f.text)).toEqual([
      'User prefers TypeScript.',
      'User has a dog named Biscuit.',
    ]);
    expect(facts[1].created).toBe(new Date(1710000001.5 * 1000).toISOString());
  });

  it('reads the export zip directly', () => {
    const path = join(scratch, 'export.zip');
    writeFileSync(
      path,
      buildZip([
        { name: 'chat.html', data: '<html></html>' },
        { name: 'conversations.json', data: JSON.stringify(conversations) },
      ]),
    );
    const { facts } = extractChatgptFacts(path);
    expect(facts).toHaveLength(2);
  });

  it('reads an unzipped export folder', () => {
    writeFileSync(join(scratch, 'conversations.json'), JSON.stringify(conversations));
    expect(extractChatgptFacts(scratch).facts).toHaveLength(2);
  });

  it('treats a .txt file as a pasted Manage-memories list', () => {
    const path = join(scratch, 'memories.txt');
    writeFileSync(path, '- Has a dog named Biscuit\n- Prefers TypeScript\n');
    expect(extractChatgptFacts(path).facts.map((f) => f.text)).toEqual([
      'Has a dog named Biscuit',
      'Prefers TypeScript',
    ]);
  });

  it('explains itself when an export holds no memory writes', () => {
    const path = join(scratch, 'conversations.json');
    writeFileSync(path, JSON.stringify([{ mapping: {} }]));
    const { facts, errors } = extractChatgptFacts(path);
    expect(facts).toEqual([]);
    expect(errors[0]).toMatch(/no memory writes/);
  });

  it('fails clearly on wrong inputs', () => {
    expect(() => extractChatgptFacts(join(scratch, 'missing.zip'))).toThrow(/no such file/);
    const empty = join(scratch, 'empty-dir');
    mkdirSync(empty);
    expect(() => extractChatgptFacts(empty)).toThrow(/no conversations\.json/);
    const bad = join(scratch, 'bad.json');
    writeFileSync(bad, '{not json');
    expect(() => extractChatgptFacts(bad)).toThrow(/not valid JSON/);
  });
});
