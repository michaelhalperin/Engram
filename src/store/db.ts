import { createRequire } from 'node:module';
import type { ListFilter, Memory, SearchHit } from './types.js';

// node:sqlite still carries an experimental tag on Node 22 even though the API
// is frozen in practice; swallow exactly that one warning during module load,
// then restore. Loaded via createRequire so the patch is guaranteed to run first.
const originalEmitWarning = process.emitWarning;
process.emitWarning = ((warning: string | Error, ...rest: unknown[]) => {
  const message = typeof warning === 'string' ? warning : (warning?.message ?? '');
  if (message.includes('SQLite is an experimental feature')) return;
  return (originalEmitWarning as (...a: unknown[]) => void).call(process, warning, ...rest);
}) as typeof process.emitWarning;
const require = createRequire(import.meta.url);
const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite');
process.emitWarning = originalEmitWarning;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS memories (
  id      TEXT PRIMARY KEY,
  type    TEXT NOT NULL,
  tags    TEXT NOT NULL,
  source  TEXT NOT NULL,
  status  TEXT NOT NULL,
  pinned  INTEGER NOT NULL,
  created TEXT NOT NULL,
  updated TEXT NOT NULL,
  body    TEXT NOT NULL,
  hash    TEXT NOT NULL,
  mtime   INTEGER NOT NULL,
  size    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_memories_status ON memories(status);
CREATE INDEX IF NOT EXISTS idx_memories_hash ON memories(hash);
CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
  id UNINDEXED, body, tags, tokenize = 'porter unicode61'
);
`;

interface Row {
  id: string;
  type: string;
  tags: string;
  source: string;
  status: string;
  pinned: number;
  created: string;
  updated: string;
  body: string;
  snippet?: string;
}

function rowToMemory(row: Row): Memory {
  return {
    id: row.id,
    type: row.type as Memory['type'],
    tags: JSON.parse(row.tags) as string[],
    source: row.source,
    status: row.status as Memory['status'],
    pinned: row.pinned === 1,
    created: row.created,
    updated: row.updated,
    body: row.body,
  };
}

/** `null` when the query contains no indexable terms. */
export function ftsQuery(query: string): string | null {
  const tokens = query.toLowerCase().match(/[\p{L}\p{N}]+/gu);
  if (!tokens || tokens.length === 0) return null;
  return tokens.map((t) => `"${t}"`).join(' OR ');
}

export interface IndexedFile {
  mtime: number;
  size: number;
}

/**
 * Derived search index over the markdown files. Disposable by design: if it is
 * ever wrong or corrupt, `reindex` rebuilds it from the files.
 */
export class IndexDb {
  private db: InstanceType<typeof DatabaseSync>;

  constructor(path: string) {
    this.db = new DatabaseSync(path);
    if (path !== ':memory:') this.db.exec('PRAGMA journal_mode = WAL;');
    this.db.exec(SCHEMA);
  }

  close(): void {
    this.db.close();
  }

  fileStates(): Map<string, IndexedFile> {
    const rows = this.db.prepare('SELECT id, mtime, size FROM memories').all() as unknown as Array<{
      id: string;
      mtime: number;
      size: number;
    }>;
    return new Map(rows.map((r) => [r.id, { mtime: r.mtime, size: r.size }]));
  }

  upsert(memory: Memory, hash: string, mtime: number, size: number): void {
    this.db
      .prepare(
        `INSERT INTO memories (id, type, tags, source, status, pinned, created, updated, body, hash, mtime, size)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           type = excluded.type, tags = excluded.tags, source = excluded.source,
           status = excluded.status, pinned = excluded.pinned, created = excluded.created,
           updated = excluded.updated, body = excluded.body, hash = excluded.hash,
           mtime = excluded.mtime, size = excluded.size`,
      )
      .run(
        memory.id,
        memory.type,
        JSON.stringify(memory.tags),
        memory.source,
        memory.status,
        memory.pinned ? 1 : 0,
        memory.created,
        memory.updated,
        memory.body,
        hash,
        mtime,
        size,
      );
    this.db.prepare('DELETE FROM memories_fts WHERE id = ?').run(memory.id);
    this.db
      .prepare('INSERT INTO memories_fts (id, body, tags) VALUES (?, ?, ?)')
      .run(memory.id, memory.body, memory.tags.join(' '));
  }

  remove(id: string): void {
    this.db.prepare('DELETE FROM memories WHERE id = ?').run(id);
    this.db.prepare('DELETE FROM memories_fts WHERE id = ?').run(id);
  }

  clear(): void {
    this.db.exec('DELETE FROM memories; DELETE FROM memories_fts;');
  }

  byHash(hash: string): string | undefined {
    const row = this.db
      .prepare("SELECT id FROM memories WHERE hash = ? AND status != 'archived' LIMIT 1")
      .get(hash) as { id: string } | undefined;
    return row?.id;
  }

  list(filter: ListFilter = {}): Memory[] {
    const conditions: string[] = [];
    const params: Array<string | number> = [];
    if (filter.status) {
      conditions.push('status = ?');
      params.push(filter.status);
    } else {
      conditions.push("status != 'archived'");
    }
    if (filter.type) {
      conditions.push('type = ?');
      params.push(filter.type);
    }
    if (filter.tag) {
      conditions.push('tags LIKE ?');
      params.push(`%"${filter.tag.toLowerCase()}"%`);
    }
    if (filter.pinned !== undefined) {
      conditions.push('pinned = ?');
      params.push(filter.pinned ? 1 : 0);
    }
    const limit = Math.min(filter.limit ?? 50, 500);
    const rows = this.db
      .prepare(
        `SELECT * FROM memories WHERE ${conditions.join(' AND ')} ORDER BY updated DESC LIMIT ?`,
      )
      .all(...params, limit) as unknown as Row[];
    return rows.map(rowToMemory);
  }

  search(query: string, opts: { limit?: number; status?: Memory['status'] } = {}): SearchHit[] {
    const match = ftsQuery(query);
    if (!match) return [];
    const statusCondition = opts.status ? 'm.status = ?' : "m.status != 'archived'";
    const params: Array<string | number> = [match];
    if (opts.status) params.push(opts.status);
    params.push(Math.min(opts.limit ?? 8, 50));
    const rows = this.db
      .prepare(
        `SELECT m.*, snippet(memories_fts, 1, '', '', ' … ', 18) AS snippet
         FROM memories_fts
         JOIN memories m ON m.id = memories_fts.id
         WHERE memories_fts MATCH ? AND ${statusCondition}
         ORDER BY rank
         LIMIT ?`,
      )
      .all(...params) as unknown as Row[];
    return rows.map((row) => ({ ...rowToMemory(row), snippet: row.snippet ?? '' }));
  }

  counts(): Record<Memory['status'] | 'pinned', number> {
    const rows = this.db
      .prepare('SELECT status, COUNT(*) AS n FROM memories GROUP BY status')
      .all() as unknown as Array<{ status: Memory['status']; n: number }>;
    const counts = { active: 0, unreviewed: 0, archived: 0, pinned: 0 };
    for (const row of rows) counts[row.status] = row.n;
    const pinned = this.db
      .prepare("SELECT COUNT(*) AS n FROM memories WHERE pinned = 1 AND status != 'archived'")
      .get() as { n: number };
    counts.pinned = pinned.n;
    return counts;
  }

  integrityCheck(): string {
    const row = this.db.prepare('PRAGMA quick_check').get() as { quick_check: string };
    return row.quick_check;
  }
}
