import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Store, type Embedder } from '../src/index.js';

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

/**
 * Deterministic stand-in for the real model: texts map to fixed unit vectors,
 * so tests control exactly how "similar" any two texts are. Unknown text gets
 * an orthogonal-to-everything zero vector.
 */
export function fakeEmbedder(table: Record<string, number[]>): Embedder {
  const normalized = new Map<string, Float32Array>();
  for (const [text, values] of Object.entries(table)) {
    const norm = Math.hypot(...values) || 1;
    normalized.set(text.toLowerCase().trim(), new Float32Array(values.map((v) => v / norm)));
  }
  const dims = Object.values(table)[0]?.length ?? 3;
  return {
    model: 'fake-embedder',
    async embed(texts: string[]): Promise<Float32Array[]> {
      return texts.map(
        (t) => normalized.get(t.toLowerCase().trim()) ?? new Float32Array(dims),
      );
    },
  };
}

describe('embedIndex', () => {
  it('embeds non-archived memories once and re-embeds on body change', async () => {
    store.attachEmbedder(
      fakeEmbedder({
        'michael prefers vim.': [1, 0, 0],
        'deploys happen on fridays.': [0, 1, 0],
        'michael prefers neovim.': [0, 0, 1],
      }),
    );
    const vim = store.create({ text: 'Michael prefers vim.', source: 'cli' });
    store.create({ text: 'Deploys happen on Fridays.', source: 'cli' });

    const first = await store.embedIndex();
    expect(first).toMatchObject({ model: 'fake-embedder', embedded: 2, total: 2 });
    const rerun = await store.embedIndex();
    expect(rerun).toMatchObject({ embedded: 0, total: 2 });

    store.update(vim.memory.id, { text: 'Michael prefers neovim.' });
    const afterEdit = await store.embedIndex();
    expect(afterEdit).toMatchObject({ embedded: 1, total: 2 });
  });

  it('prunes vectors of archived and deleted memories', async () => {
    store.attachEmbedder(fakeEmbedder({ 'fact one.': [1, 0], 'fact two.': [0, 1] }));
    const one = store.create({ text: 'Fact one.', source: 'cli' });
    store.create({ text: 'Fact two.', source: 'cli' });
    await store.embedIndex();
    store.archive(one.memory.id);
    const result = await store.embedIndex();
    expect(result).toMatchObject({ pruned: 1, total: 1 });
  });

  it('returns undefined when no embedder is available', async () => {
    process.env.ENGRAM_NO_EMBED = '1';
    try {
      expect(await store.embedIndex()).toBeUndefined();
    } finally {
      delete process.env.ENGRAM_NO_EMBED;
    }
  });
});

describe('semantic search', () => {
  it('finds meaning where keywords fail', async () => {
    store.attachEmbedder(
      fakeEmbedder({
        'michael prefers vim keybindings everywhere.': [0.9, 0.1, 0],
        'michael follows kosher dietary rules.': [0, 0.1, 0.9],
        'which editor does he use': [1, 0, 0],
      }),
    );
    store.create({ text: 'Michael prefers vim keybindings everywhere.', source: 'cli' });
    store.create({ text: 'Michael follows kosher dietary rules.', source: 'cli' });
    await store.embedIndex();

    // BM25 has nothing: no shared words.
    expect(store.search('which editor does he use')).toHaveLength(0);

    const semantics = (await store.semantics())!;
    const hits = await semantics.search('which editor does he use');
    expect(hits).toHaveLength(1);
    expect(hits[0].memory.body).toContain('vim');
    expect(hits[0].similarity).toBeGreaterThan(0.9);
  });

  it('respects scope filtering like keyword search does', async () => {
    store.attachEmbedder(
      fakeEmbedder({
        'standup is at ten.': [1, 0],
        'standup is at nine thirty.': [0.99, 0.14],
        'when is standup': [1, 0],
      }),
    );
    store.create({ text: 'Standup is at ten.', source: 'cli', scope: 'acme-api' });
    store.create({ text: 'Standup is at nine thirty.', source: 'cli', scope: 'other-app' });
    await store.embedIndex();
    const semantics = (await store.semantics())!;
    const hits = await semantics.search('when is standup', { scope: 'acme-api' });
    expect(hits.map((h) => h.memory.scope)).toEqual(['acme-api']);
  });

  it('drops low-similarity noise', async () => {
    store.attachEmbedder(
      fakeEmbedder({
        'michael dislikes almonds.': [1, 0, 0],
        'completely unrelated question': [0, 0, 1],
      }),
    );
    store.create({ text: 'Michael dislikes almonds.', source: 'cli' });
    await store.embedIndex();
    const semantics = (await store.semantics())!;
    expect(await semantics.search('completely unrelated question')).toHaveLength(0);
  });
});

describe('hybrid recall', () => {
  it('finds paraphrases keyword search misses, and fuses when both agree', async () => {
    store.attachEmbedder(
      fakeEmbedder({
        'michael prefers vim keybindings everywhere.': [0.9, 0.1, 0],
        'michael uses an editor config from 2019.': [0.8, 0.2, 0],
        'deploys happen on fridays.': [0, 0, 1],
        'which editor does he use': [1, 0, 0],
      }),
    );
    store.create({ text: 'Michael prefers vim keybindings everywhere.', source: 'cli' });
    store.create({ text: 'Michael uses an editor config from 2019.', source: 'cli' });
    store.create({ text: 'Deploys happen on Fridays.', source: 'cli' });
    await store.embedIndex();

    const hits = await store.recall('which editor does he use');
    // "editor config" matches by keyword AND meaning — fusion puts it first;
    // the vim fact arrives on meaning alone, which keyword search alone missed.
    expect(hits[0].body).toContain('editor config');
    expect(hits.map((h) => h.body)).toContain('Michael prefers vim keybindings everywhere.');
    expect(hits.map((h) => h.body)).not.toContain('Deploys happen on Fridays.');
    expect(hits.find((h) => h.body.includes('vim'))!.snippet).toContain('vim');
  });

  it('is plain keyword search when no embedder is available', async () => {
    process.env.ENGRAM_NO_EMBED = '1';
    try {
      store.create({ text: 'Deploys happen on Fridays.', source: 'cli' });
      const hits = await store.recall('deploys');
      expect(hits).toHaveLength(1);
      expect(await store.recall('which editor')).toHaveLength(0);
    } finally {
      delete process.env.ENGRAM_NO_EMBED;
    }
  });

  it('embeds fresh writes on the fly — recall sees a fact saved a moment ago', async () => {
    store.attachEmbedder(
      fakeEmbedder({
        'biscuit is allergic to chicken.': [1, 0],
        'what can the dog not eat': [0.95, 0.31],
      }),
    );
    await store.embedIndex();
    store.create({ text: 'Biscuit is allergic to chicken.', source: 'cli' });
    const hits = await store.recall('what can the dog not eat');
    expect(hits).toHaveLength(1);
    expect(hits[0].body).toContain('allergic');
  });
});

describe('neighbors and similarity', () => {
  it('reads stored vectors without re-embedding', async () => {
    store.attachEmbedder(
      fakeEmbedder({
        'standup is at ten.': [1, 0.05, 0],
        'standup is at nine thirty.': [1, 0.1, 0],
        'michael dislikes almonds.': [0, 0, 1],
      }),
    );
    const ten = store.create({ text: 'Standup is at ten.', source: 'cli' });
    store.create({ text: 'Standup is at nine thirty.', source: 'cli' });
    store.create({ text: 'Michael dislikes almonds.', source: 'cli' });
    await store.embedIndex();

    const semantics = (await store.semantics())!;
    const neighbors = semantics.neighbors(ten.memory, 2);
    expect(neighbors[0].memory.body).toContain('nine thirty');
    expect(neighbors[0].similarity).toBeGreaterThan(0.99);
    expect(neighbors[1].similarity).toBeLessThan(0.1);

    const almonds = store.list().find((m) => m.body.includes('almonds'))!;
    expect(semantics.similarityBetween(ten.memory, almonds)).toBeLessThan(0.1);
  });
});
