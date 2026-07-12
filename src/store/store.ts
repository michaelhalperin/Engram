import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { IndexDb } from './db.js';
import { bodyHash, makeId, parseMemoryFile, serializeMemory } from './files.js';
import {
  MAX_BODY_BYTES,
  VALID_ID,
  type CreateInput,
  type ListFilter,
  type Memory,
  type SearchHit,
  type UpdatePatch,
} from './types.js';

export function defaultHome(): string {
  return process.env.ENGRAM_HOME ?? join(homedir(), '.engram');
}

/** How stale the index may get while a long-lived process (MCP server, UI) runs. */
const SYNC_INTERVAL_MS = 2000;

export interface SyncResult {
  added: number;
  updated: number;
  removed: number;
  errors: string[];
}

/**
 * The vault. Markdown files under `<home>/memories/` are the source of truth;
 * the SQLite index is derived and disposable. Hand-edits are picked up lazily,
 * so a running MCP server sees changes a human makes in their editor.
 */
export class Store {
  readonly home: string;
  readonly memoriesDir: string;
  readonly dbPath: string;
  private db: IndexDb;
  private lastSync = 0;

  constructor(home: string = defaultHome()) {
    this.home = home;
    this.memoriesDir = join(home, 'memories');
    this.dbPath = join(home, 'index.db');
    mkdirSync(this.memoriesDir, { recursive: true });
    this.db = new IndexDb(this.dbPath);
    this.sync();
  }

  close(): void {
    this.db.close();
  }

  pathFor(id: string): string {
    if (!VALID_ID.test(id)) throw new Error(`invalid memory id: ${JSON.stringify(id)}`);
    return join(this.memoriesDir, `${id}.md`);
  }

  sync(): SyncResult {
    const indexed = this.db.fileStates();
    const result: SyncResult = { added: 0, updated: 0, removed: 0, errors: [] };
    const seen = new Set<string>();
    for (const entry of readdirSync(this.memoriesDir)) {
      if (!entry.endsWith('.md') || entry.startsWith('.')) continue;
      const id = entry.slice(0, -3);
      if (!VALID_ID.test(id)) {
        result.errors.push(`${entry}: filename is not a valid memory id (lowercase a-z, 0-9, dashes)`);
        continue;
      }
      seen.add(id);
      let stat;
      try {
        stat = statSync(join(this.memoriesDir, entry));
      } catch {
        continue;
      }
      const mtime = Math.floor(stat.mtimeMs);
      const known = indexed.get(id);
      if (known && known.mtime === mtime && known.size === stat.size) continue;
      try {
        const memory = this.readFile(id);
        this.db.upsert(memory, bodyHash(memory.body), mtime, stat.size);
        known ? result.updated++ : result.added++;
      } catch (err) {
        result.errors.push(`${entry}: ${(err as Error).message}`);
      }
    }
    for (const id of indexed.keys()) {
      if (!seen.has(id)) {
        this.db.remove(id);
        result.removed++;
      }
    }
    this.lastSync = Date.now();
    return result;
  }

  reindex(): SyncResult {
    this.db.clear();
    return this.sync();
  }

  create(input: CreateInput): { memory: Memory; existing: boolean } {
    const body = input.text.trim();
    validateBody(body);
    this.maybeSync();
    const duplicate = this.db.byHash(bodyHash(body));
    if (duplicate) {
      const memory = this.get(duplicate);
      if (memory) return { memory, existing: true };
    }
    const now = new Date().toISOString();
    const memory: Memory = {
      id: makeId(body, now, (candidate) => existsSync(this.pathFor(candidate))),
      type: input.type ?? 'fact',
      tags: (input.tags ?? []).map((t) => t.trim().toLowerCase()).filter(Boolean),
      source: input.source.trim() || 'unknown',
      status: input.status ?? 'active',
      pinned: input.pinned ?? false,
      created: now,
      updated: now,
      lastConfirmed: now,
      body,
    };
    this.writeFile(memory);
    return { memory, existing: false };
  }

  get(id: string): Memory | undefined {
    this.maybeSync();
    try {
      return this.readFile(id);
    } catch {
      return undefined;
    }
  }

  update(id: string, patch: UpdatePatch): Memory {
    const memory = this.get(id);
    if (!memory) throw new Error(`no memory with id ${JSON.stringify(id)}`);
    if (patch.text !== undefined) {
      const body = patch.text.trim();
      validateBody(body);
      memory.body = body;
      // Restating the fact is a fresh assertion that it is true.
      memory.lastConfirmed = new Date().toISOString();
    }
    if (patch.type !== undefined) memory.type = patch.type;
    if (patch.tags !== undefined) {
      memory.tags = patch.tags.map((t) => t.trim().toLowerCase()).filter(Boolean);
    }
    if (patch.status !== undefined) memory.status = patch.status;
    if (patch.pinned !== undefined) memory.pinned = patch.pinned;
    memory.updated = new Date().toISOString();
    this.writeFile(memory);
    return memory;
  }

  /** Soft delete: the file stays (greppable, restorable), search stops seeing it. */
  archive(id: string): Memory {
    return this.update(id, { status: 'archived' });
  }

  /** Human review is the strongest confirmation there is. */
  approve(id: string): Memory {
    this.update(id, { status: 'active' });
    return this.confirm(id);
  }

  /** Re-affirm a fact as still true. Bumps `lastConfirmed` without touching the content. */
  confirm(id: string): Memory {
    const memory = this.get(id);
    if (!memory) throw new Error(`no memory with id ${JSON.stringify(id)}`);
    memory.lastConfirmed = new Date().toISOString();
    this.writeFile(memory);
    return memory;
  }

  /** Hard delete. The CLI asks for --hard; agents never get this. */
  remove(id: string): void {
    rmSync(this.pathFor(id), { force: true });
    this.db.remove(id);
  }

  list(filter: ListFilter = {}): Memory[] {
    this.maybeSync();
    return this.db.list(filter);
  }

  search(query: string, opts: { limit?: number; status?: Memory['status'] } = {}): SearchHit[] {
    this.maybeSync();
    return this.db.search(query, opts);
  }

  /** The core profile: pinned, non-archived memories. */
  pinned(): Memory[] {
    this.maybeSync();
    return this.db.list({ pinned: true, limit: 100 });
  }

  counts(): Record<Memory['status'] | 'pinned', number> {
    this.maybeSync();
    return this.db.counts();
  }

  integrityCheck(): string {
    return this.db.integrityCheck();
  }

  private maybeSync(): void {
    if (Date.now() - this.lastSync > SYNC_INTERVAL_MS) this.sync();
  }

  private readFile(id: string): Memory {
    const path = this.pathFor(id);
    const stat = statSync(path);
    return parseMemoryFile(id, readFileSync(path, 'utf8'), new Date(stat.mtimeMs).toISOString());
  }

  private writeFile(memory: Memory): void {
    const path = this.pathFor(memory.id);
    const tmp = join(this.memoriesDir, `.${memory.id}.md.tmp-${process.pid}`);
    writeFileSync(tmp, serializeMemory(memory), 'utf8');
    renameSync(tmp, path);
    const stat = statSync(path);
    this.db.upsert(memory, bodyHash(memory.body), Math.floor(stat.mtimeMs), stat.size);
  }
}

function validateBody(body: string): void {
  if (!body) throw new Error('memory text is empty');
  const bytes = Buffer.byteLength(body, 'utf8');
  if (bytes > MAX_BODY_BYTES) {
    throw new Error(
      `memory too large (${bytes} bytes, limit ${MAX_BODY_BYTES}). Store one atomic fact per memory.`,
    );
  }
}
