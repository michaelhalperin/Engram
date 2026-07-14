import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  MAX_BODY_BYTES,
  Store,
  extractMarkdownNotes,
  importFacts,
  parseFactLines,
} from '../src/index.js';

let home: string;
let store: Store;
let scratch: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'engram-test-'));
  scratch = mkdtempSync(join(tmpdir(), 'engram-import-'));
  store = new Store(home);
});

afterEach(() => {
  store.close();
  rmSync(home, { recursive: true, force: true });
  rmSync(scratch, { recursive: true, force: true });
});

describe('parseFactLines', () => {
  it('strips bullets and numbering, drops headings and separators', () => {
    const raw = [
      '# My memories',
      '',
      '- Prefers TypeScript for new projects',
      '* Works at Acme Corp',
      '  • Has a dog named Biscuit',
      '3. Uses vim keybindings everywhere',
      '---',
      'Plain unbulleted fact',
    ].join('\n');
    expect(parseFactLines(raw)).toEqual([
      'Prefers TypeScript for new projects',
      'Works at Acme Corp',
      'Has a dog named Biscuit',
      'Uses vim keybindings everywhere',
      'Plain unbulleted fact',
    ]);
  });

  it('returns nothing for empty input', () => {
    expect(parseFactLines('\n  \n---\n')).toEqual([]);
  });
});

describe('importFacts', () => {
  it('lands everything unreviewed, attributed to the importer', () => {
    const report = importFacts(
      store,
      [{ text: 'Prefers dark mode.' }, { text: 'Deploys on Fridays.', scope: 'acme-api' }],
      { source: 'import:text' },
    );
    expect(report.added).toHaveLength(2);
    expect(report.added.every((m) => m.status === 'unreviewed')).toBe(true);
    expect(report.added.every((m) => m.source === 'import:text')).toBe(true);
    expect(report.added[1].scope).toBe('acme-api');
    expect(store.counts().unreviewed).toBe(2);
  });

  it('skips facts already in the vault — re-running an import is a no-op', () => {
    store.create({ text: 'Prefers dark mode.', source: 'cli' });
    const facts = [{ text: 'prefers  dark mode.' }, { text: 'New fact.' }];
    const first = importFacts(store, facts, { source: 'import:text' });
    expect(first.added.map((m) => m.body)).toEqual(['New fact.']);
    expect(first.duplicates).toBe(1);
    const rerun = importFacts(store, facts, { source: 'import:text' });
    expect(rerun.added).toHaveLength(0);
    expect(rerun.duplicates).toBe(2);
  });

  it('applies option overrides and keeps provenance timestamps', () => {
    const report = importFacts(
      store,
      [{ text: 'Standup is at 10am.', created: '2024-01-05T09:00:00.000Z', tags: ['team'] }],
      { source: 'import:text', scope: 'acme-api', tags: ['imported'], type: 'project' },
    );
    const memory = report.added[0];
    expect(memory.created).toBe('2024-01-05T09:00:00.000Z');
    expect(memory.id).toMatch(/^20240105-/);
    expect(memory.scope).toBe('acme-api');
    expect(memory.type).toBe('project');
    expect(memory.tags).toEqual(['team', 'imported']);
  });

  it('flags likely contradictions against existing memories', () => {
    store.create({ text: 'Standup is at 10am every day.', source: 'cli' });
    const report = importFacts(store, [{ text: 'Standup is at 9:30am every day.' }], {
      source: 'import:text',
    });
    expect(report.conflicts).toHaveLength(1);
    expect(report.conflicts[0].existing.body).toContain('10am');
  });

  it('captures refusals instead of aborting the batch', () => {
    const report = importFacts(
      store,
      [{ text: 'x'.repeat(MAX_BODY_BYTES + 1) }, { text: 'Small fact survives.' }],
      { source: 'import:text' },
    );
    expect(report.errors).toHaveLength(1);
    expect(report.errors[0].error).toMatch(/too large/);
    expect(report.added.map((m) => m.body)).toEqual(['Small fact survives.']);
  });

  it('dry run writes nothing and dedupes within the batch', () => {
    store.create({ text: 'Already known fact.', source: 'cli' });
    const report = importFacts(
      store,
      [{ text: 'Already known fact.' }, { text: 'Fresh fact.' }, { text: 'fresh  fact.' }],
      { source: 'import:text', dryRun: true },
    );
    expect(report.planned.map((f) => f.text)).toEqual(['Fresh fact.']);
    expect(report.duplicates).toBe(2);
    expect(report.added).toHaveLength(0);
    expect(store.counts().unreviewed).toBe(0);
  });
});

describe('extractMarkdownNotes', () => {
  it('turns each note into a fact, keeping frontmatter tags and dates', () => {
    mkdirSync(join(scratch, 'nested'));
    writeFileSync(
      join(scratch, 'biscuit.md'),
      '---\ntags: [pets, dogs]\ncreated: 2023-06-01T12:00:00.000Z\n---\n\nBiscuit is allergic to chicken.\n',
    );
    writeFileSync(join(scratch, 'nested', 'plain.md'), 'The wifi password lives in 1Password.\n');
    writeFileSync(join(scratch, 'empty.md'), '---\ntags: [x]\n---\n\n');
    writeFileSync(join(scratch, 'not-a-note.txt'), 'ignored');

    const { facts, errors } = extractMarkdownNotes(scratch);
    expect(errors).toEqual([]);
    expect(facts).toHaveLength(2);
    const biscuit = facts.find((f) => f.text.includes('Biscuit'))!;
    expect(biscuit.tags).toEqual(['pets', 'dogs']);
    expect(biscuit.created).toBe('2023-06-01T12:00:00.000Z');
    expect(facts.some((f) => f.text.includes('wifi password'))).toBe(true);
  });

  it('skips hidden and vault-internal directories', () => {
    mkdirSync(join(scratch, '.obsidian'));
    mkdirSync(join(scratch, 'node_modules'));
    writeFileSync(join(scratch, '.obsidian', 'config.md'), 'not a note');
    writeFileSync(join(scratch, 'node_modules', 'readme.md'), 'not a note');
    expect(extractMarkdownNotes(scratch).facts).toEqual([]);
  });
});
