import { createRequire } from 'node:module';
import type { Facets, ListFilter, Memory, SearchHit } from './types.js';

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

/** Bump when SCHEMA changes shape; the index is derived, so we rebuild instead of migrating. */
const SCHEMA_VERSION = 4;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS memories (
  id             TEXT PRIMARY KEY,
  type           TEXT NOT NULL,
  tags           TEXT NOT NULL,
  source         TEXT NOT NULL,
  status         TEXT NOT NULL,
  pinned         INTEGER NOT NULL,
  scope          TEXT NOT NULL DEFAULT '',
  created        TEXT NOT NULL,
  updated        TEXT NOT NULL,
  last_confirmed TEXT NOT NULL,
  supersedes     TEXT,
  body           TEXT NOT NULL,
  hash           TEXT NOT NULL,
  mtime          INTEGER NOT NULL,
  size           INTEGER NOT NULL
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
  scope: string;
  created: string;
  updated: string;
  last_confirmed: string;
  supersedes: string | null;
  body: string;
  snippet?: string;
  rank?: number;
}

function rowToMemory(row: Row): Memory {
  return {
    id: row.id,
    type: row.type as Memory['type'],
    tags: JSON.parse(row.tags) as string[],
    source: row.source,
    status: row.status as Memory['status'],
    pinned: row.pinned === 1,
    scope: row.scope || undefined,
    created: row.created,
    updated: row.updated,
    lastConfirmed: row.last_confirmed,
    supersedes: row.supersedes ?? undefined,
    body: row.body,
  };
}

const DAY_MS = 86_400_000;
/** Unreviewed agent writes rank below human-approved facts of equal relevance. */
const UNREVIEWED_WEIGHT = 0.85;
/** Pinned facts are the user's declared core — boost them. */
const PINNED_BOOST = 1.25;
/** When recall is scoped, facts from that scope edge out equally-relevant global ones. */
const SCOPE_BOOST = 1.15;
/**
 * Freshness decays with time since the fact was last confirmed true, halving
 * once a year but never below the floor — old memories fade, they don't vanish.
 */
const FRESHNESS_FLOOR = 0.6;
const FRESHNESS_HALF_LIFE_DAYS = 365;

/** Higher is better. Blends BM25 relevance with trust (status, pinned), freshness, and scope affinity. */
function scoreHit(row: Row, now: number, scope?: string): number {
  const relevance = -(row.rank ?? 0); // fts5 bm25 rank: more negative = better match
  const confirmed = Date.parse(row.last_confirmed);
  const days = Number.isFinite(confirmed) ? Math.max(0, (now - confirmed) / DAY_MS) : Infinity;
  const freshness = FRESHNESS_FLOOR + (1 - FRESHNESS_FLOOR) * 2 ** (-days / FRESHNESS_HALF_LIFE_DAYS);
  const trust = (row.status === 'unreviewed' ? UNREVIEWED_WEIGHT : 1) * (row.pinned === 1 ? PINNED_BOOST : 1);
  const affinity = scope !== undefined && row.scope === scope ? SCOPE_BOOST : 1;
  return relevance * trust * freshness * affinity;
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
    const { user_version: version } = this.db.prepare('PRAGMA user_version').get() as {
      user_version: number;
    };
    if (version !== SCHEMA_VERSION) {
      // Older (or newer) index layout: drop it and let sync() rebuild from the files.
      this.db.exec('DROP TABLE IF EXISTS memories; DROP TABLE IF EXISTS memories_fts;');
      this.db.exec(`PRAGMA user_version = ${SCHEMA_VERSION};`);
    }
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
        `INSERT INTO memories (id, type, tags, source, status, pinned, scope, created, updated, last_confirmed, supersedes, body, hash, mtime, size)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           type = excluded.type, tags = excluded.tags, source = excluded.source,
           status = excluded.status, pinned = excluded.pinned, scope = excluded.scope,
           created = excluded.created, updated = excluded.updated, last_confirmed = excluded.last_confirmed,
           supersedes = excluded.supersedes, body = excluded.body, hash = excluded.hash,
           mtime = excluded.mtime, size = excluded.size`,
      )
      .run(
        memory.id,
        memory.type,
        JSON.stringify(memory.tags),
        memory.source,
        memory.status,
        memory.pinned ? 1 : 0,
        memory.scope ?? '',
        memory.created,
        memory.updated,
        memory.lastConfirmed,
        memory.supersedes ?? null,
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
    if (filter.scope !== undefined) {
      conditions.push('scope = ?');
      params.push(filter.scope);
    }
    const limit = Math.min(filter.limit ?? 50, 500);
    const rows = this.db
      .prepare(
        `SELECT * FROM memories WHERE ${conditions.join(' AND ')} ORDER BY updated DESC LIMIT ?`,
      )
      .all(...params, limit) as unknown as Row[];
    return rows.map(rowToMemory);
  }

  search(
    query: string,
    opts: { limit?: number; status?: Memory['status']; scope?: string } = {},
  ): SearchHit[] {
    const match = ftsQuery(query);
    if (!match) return [];
    const conditions = [opts.status ? 'm.status = ?' : "m.status != 'archived'"];
    const limit = Math.min(opts.limit ?? 8, 50);
    const params: Array<string | number> = [match];
    if (opts.status) params.push(opts.status);
    if (opts.scope !== undefined) {
      // Scoped recall sees the world from inside one project: its facts plus global ones.
      conditions.push("(m.scope = '' OR m.scope = ?)");
      params.push(opts.scope);
    }
    // Over-fetch by BM25, then re-rank with trust and freshness in JS.
    params.push(Math.max(limit * 4, 50));
    const rows = this.db
      .prepare(
        `SELECT m.*, snippet(memories_fts, 1, '', '', ' … ', 18) AS snippet, rank
         FROM memories_fts
         JOIN memories m ON m.id = memories_fts.id
         WHERE memories_fts MATCH ? AND ${conditions.join(' AND ')}
         ORDER BY rank
         LIMIT ?`,
      )
      .all(...params) as unknown as Row[];
    const now = Date.now();
    return rows
      .map((row) => ({ row, score: scoreHit(row, now, opts.scope) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map(({ row }) => ({ ...rowToMemory(row), snippet: row.snippet ?? '' }));
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

  /** Direct successors: memories whose `supersedes` points at this id (any status). */
  successorsOf(id: string): string[] {
    const rows = this.db
      .prepare('SELECT id FROM memories WHERE supersedes = ? ORDER BY created')
      .all(id) as unknown as Array<{ id: string }>;
    return rows.map((r) => r.id);
  }

  /** Counts by type/source/scope/tag over non-archived memories — filter dropdowns, dashboard. */
  facets(): Facets {
    const facets: Facets = { types: {}, sources: {}, scopes: {}, tags: {} };
    const rows = this.db
      .prepare("SELECT type, source, scope, tags FROM memories WHERE status != 'archived'")
      .all() as unknown as Array<{ type: string; source: string; scope: string; tags: string }>;
    for (const row of rows) {
      facets.types[row.type] = (facets.types[row.type] ?? 0) + 1;
      facets.sources[row.source] = (facets.sources[row.source] ?? 0) + 1;
      if (row.scope) facets.scopes[row.scope] = (facets.scopes[row.scope] ?? 0) + 1;
      for (const tag of JSON.parse(row.tags) as string[]) {
        facets.tags[tag] = (facets.tags[tag] ?? 0) + 1;
      }
    }
    return facets;
  }

  /** Non-archived memories not confirmed since the cutoff. */
  staleCount(cutoffIso: string): number {
    const row = this.db
      .prepare("SELECT COUNT(*) AS n FROM memories WHERE status != 'archived' AND last_confirmed < ?")
      .get(cutoffIso) as { n: number };
    return row.n;
  }

  integrityCheck(): string {
    const row = this.db.prepare('PRAGMA quick_check').get() as { quick_check: string };
    return row.quick_check;
  }
}
