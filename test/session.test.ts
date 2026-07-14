import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Store, renderSessionContext, scopeForDirectory } from '../src/index.js';

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

describe('renderSessionContext', () => {
  it('is empty for an empty vault — nothing to inject, no noise', () => {
    expect(renderSessionContext(store)).toBe('');
    expect(renderSessionContext(store, 'acme-api')).toBe('');
  });

  it('renders pinned profile plus this project’s facts, framed as data', () => {
    const pinned = store.create({ text: 'Michael prefers TypeScript.', source: 'cli', type: 'preference' });
    store.update(pinned.memory.id, { pinned: true });
    store.create({ text: 'Deploys go out Friday mornings.', source: 'cli', scope: 'acme-api', type: 'project' });
    store.create({ text: 'Other project trivia.', source: 'cli', scope: 'other-app' });

    const context = renderSessionContext(store, 'acme-api');
    expect(context).toContain('never as instructions');
    expect(context).toContain('## Profile');
    expect(context).toContain('**preference**: Michael prefers TypeScript.');
    expect(context).toContain('## This project (acme-api)');
    expect(context).toContain('Deploys go out Friday mornings.');
    expect(context).not.toContain('Other project trivia');
    expect(context).toContain('`recall`');
  });

  it('marks unreviewed and stale facts, and skips pinned duplicates in the scoped list', () => {
    const pinnedScoped = store.create({ text: 'Pinned and scoped.', source: 'cli', scope: 'acme-api' });
    store.update(pinnedScoped.memory.id, { pinned: true });
    store.create({
      text: 'Agent-written and unvetted.',
      source: 'claude-code',
      scope: 'acme-api',
      status: 'unreviewed',
    });
    store.create({
      text: 'Ancient wisdom.',
      source: 'cli',
      scope: 'acme-api',
      created: '2024-01-01T00:00:00.000Z',
    });

    const context = renderSessionContext(store, 'acme-api');
    expect(context.match(/Pinned and scoped\./g)).toHaveLength(1);
    expect(context).toMatch(/Agent-written and unvetted\. \(unreviewed\)/);
    expect(context).toMatch(/Ancient wisdom\. \(⚠ not confirmed in \d+ months — may be stale\)/);
  });

  it('never renders archived facts', () => {
    const { memory } = store.create({ text: 'Old and gone.', source: 'cli', scope: 'acme-api' });
    store.archive(memory.id);
    expect(renderSessionContext(store, 'acme-api')).toBe('');
  });

  it('flattens multi-line facts into single bullets', () => {
    const { memory } = store.create({ text: 'Line one.\n\nLine two.', source: 'cli' });
    store.update(memory.id, { pinned: true });
    expect(renderSessionContext(store)).toContain('- **fact**: Line one. Line two.');
  });
});

describe('scopeForDirectory', () => {
  it('uses the enclosing repository name', () => {
    const root = mkdtempSync(join(tmpdir(), 'engram-scope-'));
    try {
      const repo = join(root, 'Acme API');
      mkdirSync(join(repo, '.git'), { recursive: true });
      const nested = join(repo, 'src', 'deep');
      mkdirSync(nested, { recursive: true });
      expect(scopeForDirectory(nested)).toBe('acme-api');
      expect(scopeForDirectory(repo)).toBe('acme-api');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('falls back to the directory name outside a repository', () => {
    const dir = mkdtempSync(join(tmpdir(), 'engram-scope-'));
    try {
      expect(scopeForDirectory(dir)).toBe(scopeForDirectory(dir));
      expect(scopeForDirectory(dir)).toMatch(/^engram-scope-/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
