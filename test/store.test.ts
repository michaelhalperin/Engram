import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MAX_BODY_BYTES, Store } from '../src/index.js';

let home: string;
let store: Store;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'engram-test-'));
  store = new Store(home);
});

afterEach(() => {
  store.close();
  rmSync(home, { recursive: true, force: true });
});

describe('create / get roundtrip', () => {
  it('persists a memory as a markdown file with frontmatter', () => {
    const { memory, existing } = store.create({
      text: 'Michael prefers TypeScript for new projects.',
      type: 'preference',
      tags: ['Tooling', ' languages '],
      source: 'cli',
    });
    expect(existing).toBe(false);
    expect(memory.id).toMatch(/^\d{8}-michael-prefers-typescript/);
    expect(memory.tags).toEqual(['tooling', 'languages']);
    expect(memory.status).toBe('active');

    const raw = readFileSync(store.pathFor(memory.id), 'utf8');
    expect(raw).toContain('type: preference');
    expect(raw).toContain('source: cli');
    expect(raw).toContain('Michael prefers TypeScript');

    const loaded = store.get(memory.id);
    expect(loaded).toBeDefined();
    expect(loaded!.body).toBe('Michael prefers TypeScript for new projects.');
    expect(loaded!.type).toBe('preference');
  });

  it('detects duplicates by normalized body', () => {
    const first = store.create({ text: 'Deploys go out on  Fridays.', source: 'cli' });
    const second = store.create({ text: 'deploys go out on fridays.', source: 'mcp' });
    expect(second.existing).toBe(true);
    expect(second.memory.id).toBe(first.memory.id);
    expect(readdirSync(join(home, 'memories'))).toHaveLength(1);
  });

  it('rejects empty and oversized bodies', () => {
    expect(() => store.create({ text: '   ', source: 'cli' })).toThrow(/empty/);
    expect(() => store.create({ text: 'x'.repeat(MAX_BODY_BYTES + 1), source: 'cli' })).toThrow(
      /too large/,
    );
  });
});

describe('update / archive', () => {
  it('updates fields and bumps updated timestamp', async () => {
    const { memory } = store.create({ text: 'The staging URL is stage.example.com', source: 'cli' });
    await new Promise((r) => setTimeout(r, 5));
    const updated = store.update(memory.id, { text: 'The staging URL is stage2.example.com', pinned: true });
    expect(updated.body).toContain('stage2');
    expect(updated.pinned).toBe(true);
    expect(Date.parse(updated.updated)).toBeGreaterThan(Date.parse(memory.updated));
    expect(store.get(memory.id)!.body).toContain('stage2');
  });

  it('archives out of default list and search, but stays on disk', () => {
    const { memory } = store.create({ text: 'Temporary API key rotation note', source: 'cli' });
    store.archive(memory.id);
    expect(store.list().map((m) => m.id)).not.toContain(memory.id);
    expect(store.search('rotation')).toHaveLength(0);
    expect(store.list({ status: 'archived' }).map((m) => m.id)).toContain(memory.id);
    expect(store.get(memory.id)!.status).toBe('archived');
    expect(readdirSync(join(home, 'memories'))).toHaveLength(1);
  });

  it('hard remove deletes the file', () => {
    const { memory } = store.create({ text: 'Delete me completely', source: 'cli' });
    store.remove(memory.id);
    expect(store.get(memory.id)).toBeUndefined();
    expect(readdirSync(join(home, 'memories'))).toHaveLength(0);
  });
});

describe('supersede / reject', () => {
  it('supersede links the successor, archives the original, and inherits type/tags', () => {
    const { memory: old } = store.create({
      text: 'Standup is at 10am',
      type: 'fact',
      tags: ['rituals'],
      source: 'cli',
    });
    const { memory, replaced } = store.supersede(old.id, {
      text: 'Standup is at 9:30am',
      source: 'mcp',
    });
    expect(replaced!.id).toBe(old.id);
    expect(memory.supersedes).toBe(old.id);
    expect(memory.type).toBe('fact');
    expect(memory.tags).toEqual(['rituals']);
    expect(memory.status).toBe('unreviewed');
    expect(store.get(old.id)!.status).toBe('archived');
    expect(readFileSync(store.pathFor(memory.id), 'utf8')).toContain(`supersedes: ${old.id}`);
  });

  it('supersede with a restatement of the same text confirms instead of forking', async () => {
    const { memory: old } = store.create({ text: 'Deploys go out Fridays', source: 'cli' });
    await new Promise((r) => setTimeout(r, 5));
    const { memory, replaced } = store.supersede(old.id, {
      text: 'deploys go out  fridays',
      source: 'mcp',
    });
    expect(replaced).toBeUndefined();
    expect(memory.id).toBe(old.id);
    expect(Date.parse(memory.lastConfirmed)).toBeGreaterThan(Date.parse(old.lastConfirmed));
    expect(readdirSync(join(home, 'memories'))).toHaveLength(1);
  });

  it('reject archives the correction and restores what it superseded', () => {
    const { memory: old } = store.create({ text: 'The staging URL is stage.example.com', source: 'cli' });
    const { memory: successor } = store.supersede(old.id, {
      text: 'The staging URL is stage-wrong.example.com',
      source: 'mcp',
    });
    const { restored } = store.reject(successor.id);
    expect(restored!.id).toBe(old.id);
    expect(store.get(successor.id)!.status).toBe('archived');
    expect(store.get(old.id)!.status).toBe('active');
  });

  it('superseding a pinned memory never pins the successor; rejecting restores the profile', () => {
    const { memory: old } = store.create({
      text: 'Michael works at Acme Corp',
      source: 'cli',
      pinned: true,
    });
    const { memory: successor } = store.supersede(old.id, {
      text: 'Michael works at Evil Corp',
      source: 'mcp',
    });
    expect(successor.pinned).toBe(false);
    expect(store.pinned()).toHaveLength(0);
    store.reject(successor.id);
    expect(store.pinned().map((m) => m.id)).toEqual([old.id]);
  });

  it('reject without a supersedes link just archives', () => {
    const { memory } = store.create({ text: 'A plain unlinked memory', source: 'mcp' });
    const { restored } = store.reject(memory.id);
    expect(restored).toBeUndefined();
    expect(store.get(memory.id)!.status).toBe('archived');
  });
});

describe('confirm / staleness', () => {
  it('create stamps lastConfirmed and persists it as last_confirmed frontmatter', () => {
    const { memory } = store.create({ text: 'Standup is at 10am daily', source: 'cli' });
    expect(memory.lastConfirmed).toBe(memory.created);
    expect(readFileSync(store.pathFor(memory.id), 'utf8')).toContain('last_confirmed:');
  });

  it('confirm bumps lastConfirmed but not updated', async () => {
    const { memory } = store.create({ text: 'The API gateway is Kong', source: 'cli' });
    await new Promise((r) => setTimeout(r, 5));
    const confirmed = store.confirm(memory.id);
    expect(Date.parse(confirmed.lastConfirmed)).toBeGreaterThan(Date.parse(memory.lastConfirmed));
    expect(confirmed.updated).toBe(memory.updated);
    expect(confirmed.body).toBe(memory.body);
  });

  it('approve activates and counts as a confirmation', async () => {
    const { memory } = store.create({ text: 'CI runs on GitHub Actions', source: 'mcp', status: 'unreviewed' });
    await new Promise((r) => setTimeout(r, 5));
    const approved = store.approve(memory.id);
    expect(approved.status).toBe('active');
    expect(Date.parse(approved.lastConfirmed)).toBeGreaterThan(Date.parse(memory.lastConfirmed));
  });

  it('rewriting the text counts as a fresh assertion', async () => {
    const { memory } = store.create({ text: 'Standup is at 10am', source: 'cli' });
    await new Promise((r) => setTimeout(r, 5));
    const updated = store.update(memory.id, { text: 'Standup is at 9:30am' });
    expect(Date.parse(updated.lastConfirmed)).toBeGreaterThan(Date.parse(memory.lastConfirmed));
  });

  it('files without last_confirmed default it to created', () => {
    writeFileSync(
      join(home, 'memories', 'legacy-memory.md'),
      '---\ncreated: 2025-01-01T00:00:00.000Z\n---\nA memory from before staleness existed.\n',
    );
    const fresh = new Store(home);
    expect(fresh.get('legacy-memory')!.lastConfirmed).toBe('2025-01-01T00:00:00.000Z');
    fresh.close();
  });
});

describe('search', () => {
  it('ranks documents matching more terms higher', () => {
    store.create({ text: 'Our deploy pipeline uses blue green deploy strategy on AWS', source: 'cli' });
    store.create({ text: 'Michael drinks green tea in the morning', source: 'cli' });
    const hits = store.search('blue green deploy');
    expect(hits.length).toBeGreaterThanOrEqual(2);
    expect(hits[0].body).toContain('blue green deploy');
  });

  it('matches tags as well as body', () => {
    store.create({ text: 'Uses pnpm not npm', tags: ['tooling'], source: 'cli' });
    const hits = store.search('tooling');
    expect(hits).toHaveLength(1);
    expect(hits[0].body).toContain('pnpm');
  });

  it('survives hostile query syntax', () => {
    store.create({ text: 'Perfectly normal memory', source: 'cli' });
    expect(() => store.search('"; DROP TABLE -- ()*')).not.toThrow();
    expect(store.search('!!! ???')).toEqual([]);
    expect(store.search('normal')).toHaveLength(1);
  });

  it('ranks approved memories above unreviewed ones of equal relevance', () => {
    // Same length, same matching terms — BM25 ties; trust breaks it.
    const unreviewed = store.create({
      text: 'Deploy window opens Friday morning maybe',
      source: 'mcp',
      status: 'unreviewed',
    });
    const active = store.create({
      text: 'Deploy window opens Friday morning yes',
      source: 'cli',
      status: 'active',
    });
    const hits = store.search('deploy window friday');
    expect(hits.map((h) => h.id)).toEqual([active.memory.id, unreviewed.memory.id]);
  });

  it('ranks recently confirmed memories above long-unconfirmed ones', () => {
    const old = new Date(Date.now() - 500 * 86_400_000).toISOString();
    writeFileSync(
      join(home, 'memories', 'stale-deploy-fact.md'),
      `---\nstatus: active\ncreated: ${old}\nlast_confirmed: ${old}\n---\nDeploys happen Monday evenings always\n`,
    );
    store.sync();
    const fresh = store.create({ text: 'Deploys happen Friday mornings always', source: 'cli' });
    const hits = store.search('deploys happen always');
    expect(hits.map((h) => h.id)).toEqual([fresh.memory.id, 'stale-deploy-fact']);
  });

  it('stems words (porter): "preferences" finds "prefers"', () => {
    store.create({ text: 'Michael prefers dark mode everywhere', source: 'cli' });
    expect(store.search('preferences').length).toBe(1);
  });
});

describe('files are the source of truth', () => {
  it('picks up a hand-written file without frontmatter, defaulting to active', () => {
    writeFileSync(join(home, 'memories', 'my-handwritten-note.md'), 'I wrote this by hand.\n');
    const fresh = new Store(home);
    const memory = fresh.get('my-handwritten-note');
    expect(memory).toBeDefined();
    expect(memory!.body).toBe('I wrote this by hand.');
    expect(memory!.status).toBe('active');
    expect(memory!.type).toBe('fact');
    expect(memory!.source).toBe('unknown');
    fresh.close();
  });

  it('normalizes messy frontmatter (string tags, unknown type/status)', () => {
    writeFileSync(
      join(home, 'memories', 'messy.md'),
      '---\ntype: banana\nstatus: wat\ntags: Alpha, Beta\n---\nMessy but salvageable.\n',
    );
    const fresh = new Store(home);
    const memory = fresh.get('messy')!;
    expect(memory.type).toBe('fact');
    expect(memory.status).toBe('active');
    expect(memory.tags).toEqual(['alpha', 'beta']);
    fresh.close();
  });

  it('sees hand-edits made while the store is open (lazy sync)', async () => {
    const { memory } = store.create({ text: 'Original text before hand edit', source: 'cli' });
    await new Promise((r) => setTimeout(r, 10));
    writeFileSync(store.pathFor(memory.id), 'Edited by hand in vim.\n');
    // Sync is lazy with a 2s window; force it as reindex would.
    store.sync();
    const hits = store.search('vim');
    expect(hits).toHaveLength(1);
    expect(hits[0].id).toBe(memory.id);
  });

  it('removes index entries when files are deleted', () => {
    const { memory } = store.create({ text: 'Soon to be deleted from disk', source: 'cli' });
    rmSync(store.pathFor(memory.id));
    const result = store.sync();
    expect(result.removed).toBe(1);
    expect(store.list()).toHaveLength(0);
  });

  it('rebuilds the index from files when the schema version changes', async () => {
    const { memory } = store.create({ text: 'Fact that must survive schema bumps', source: 'cli' });
    store.close();
    const { DatabaseSync } = await import('node:sqlite');
    const raw = new DatabaseSync(join(home, 'index.db'));
    raw.exec('PRAGMA user_version = 0;');
    raw.close();
    store = new Store(home);
    expect(store.search('survive schema').map((h) => h.id)).toContain(memory.id);
  });

  it('reindex is idempotent', () => {
    store.create({ text: 'First memory about kubernetes', source: 'cli' });
    store.create({ text: 'Second memory about terraform', source: 'cli' });
    const first = store.reindex();
    const second = store.reindex();
    expect(first.added).toBe(2);
    expect(second.added).toBe(2);
    expect(store.search('kubernetes')).toHaveLength(1);
    expect(store.counts().active).toBe(2);
  });
});

describe('safety rails', () => {
  it('rejects path traversal in ids', () => {
    expect(store.get('../../../etc/passwd')).toBeUndefined();
    expect(() => store.pathFor('../escape')).toThrow(/invalid memory id/);
    expect(() => store.pathFor('.hidden')).toThrow(/invalid memory id/);
  });

  it('generates unique ids for same-day same-slug memories', () => {
    const a = store.create({ text: 'Meeting notes context alpha', source: 'cli' });
    // Same first words -> same slug; must not collide.
    const b = store.create({ text: 'Meeting notes context alpha two', source: 'cli' });
    expect(a.memory.id).not.toBe(b.memory.id);
  });

  it('pinned() returns only pinned, non-archived memories', () => {
    const a = store.create({ text: 'Pinned core fact about the user', source: 'cli', pinned: true });
    store.create({ text: 'Regular unpinned fact', source: 'cli' });
    const c = store.create({ text: 'Pinned then archived', source: 'cli', pinned: true });
    store.archive(c.memory.id);
    const pinned = store.pinned();
    expect(pinned.map((m) => m.id)).toEqual([a.memory.id]);
  });
});
