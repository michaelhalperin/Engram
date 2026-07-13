import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Store } from '../src/index.js';
import { startUi, type UiHandle } from '../src/ui/server.js';

let home: string;
let store: Store;
let ui: UiHandle;

const HEADERS = { 'x-engram': '1', 'content-type': 'application/json' };

beforeEach(async () => {
  home = mkdtempSync(join(tmpdir(), 'engram-ui-test-'));
  store = new Store(home);
  ui = await startUi(store, { port: 0 });
});

afterEach(async () => {
  await ui.close();
  store.close();
  rmSync(home, { recursive: true, force: true });
});

describe('ui server', () => {
  it('serves the app shell', async () => {
    const res = await fetch(`${ui.url}/`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    expect(await res.text()).toContain('engram');
  });

  it('reports state: counts, inbox, memories', async () => {
    store.create({ text: 'Active fact from the cli', source: 'cli' });
    store.create({ text: 'Agent scribble awaiting review', source: 'claude-code', status: 'unreviewed' });
    const res = await fetch(`${ui.url}/api/state`);
    const data = await res.json();
    expect(data.counts.active).toBe(1);
    expect(data.counts.unreviewed).toBe(1);
    expect(data.inbox).toHaveLength(1);
    expect(data.inbox[0].source).toBe('claude-code');
    expect(data.memories).toHaveLength(2);
  });

  it('filters by search query and status', async () => {
    store.create({ text: 'Kubernetes cluster runs in eu-west-1', source: 'cli' });
    store.create({ text: 'Coffee machine is on floor 2', source: 'cli' });
    const res = await fetch(`${ui.url}/api/state?query=kubernetes`);
    const data = await res.json();
    expect(data.memories).toHaveLength(1);
    expect(data.memories[0].body).toContain('eu-west-1');

    const archivedOnly = await (await fetch(`${ui.url}/api/state?status=archived`)).json();
    expect(archivedOnly.memories).toHaveLength(0);
  });

  it('creates memories with source ui', async () => {
    const res = await fetch(`${ui.url}/api/memories`, {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify({ text: 'Added from the web ui', type: 'project', tags: 'alpha, beta', pinned: true }),
    });
    expect(res.status).toBe(201);
    const { memory } = await res.json();
    expect(memory.source).toBe('ui');
    expect(memory.type).toBe('project');
    expect(memory.tags).toEqual(['alpha', 'beta']);
    expect(memory.pinned).toBe(true);
    expect(memory.status).toBe('active');
  });

  it('approve and reject drive the review flow', async () => {
    const { memory } = store.create({ text: 'Pending agent fact', source: 'cursor', status: 'unreviewed' });

    const approve = await fetch(`${ui.url}/api/memories/${memory.id}/approve`, { method: 'POST', headers: HEADERS });
    expect((await approve.json()).memory.status).toBe('active');

    const { memory: second } = store.create({ text: 'Wrong agent fact', source: 'cursor', status: 'unreviewed' });
    const reject = await fetch(`${ui.url}/api/memories/${second.id}/reject`, { method: 'POST', headers: HEADERS });
    expect((await reject.json()).memory.status).toBe('archived');
  });

  it('patches text, tags and pinned', async () => {
    const { memory } = store.create({ text: 'Original body', source: 'cli' });
    const res = await fetch(`${ui.url}/api/memories/${memory.id}`, {
      method: 'PATCH',
      headers: HEADERS,
      body: JSON.stringify({ text: 'Corrected body', tags: 'fixed', pinned: true }),
    });
    const { memory: updated } = await res.json();
    expect(updated.body).toBe('Corrected body');
    expect(updated.tags).toEqual(['fixed']);
    expect(updated.pinned).toBe(true);
  });

  it('DELETE archives by default and hard-deletes with ?hard=1', async () => {
    const { memory } = store.create({ text: 'Soft then hard delete', source: 'cli' });
    await fetch(`${ui.url}/api/memories/${memory.id}`, { method: 'DELETE', headers: HEADERS });
    expect(store.get(memory.id)!.status).toBe('archived');

    await fetch(`${ui.url}/api/memories/${memory.id}?hard=1`, { method: 'DELETE', headers: HEADERS });
    expect(store.get(memory.id)).toBeUndefined();
    expect(existsSync(store.pathFor(memory.id))).toBe(false);
  });

  it('refuses mutations without the x-engram header (CSRF guard)', async () => {
    const res = await fetch(`${ui.url}/api/memories`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: 'sneaky' }),
    });
    expect(res.status).toBe(403);
  });

  it('refuses non-localhost Host headers (DNS rebinding guard)', async () => {
    // fetch silently drops forbidden headers like Host; go through raw http.
    const { request } = await import('node:http');
    const status = await new Promise<number>((resolve, reject) => {
      const req = request(
        { host: '127.0.0.1', port: ui.port, path: '/api/state', headers: { host: 'evil.example.com' } },
        (res) => resolve(res.statusCode ?? 0),
      );
      req.on('error', reject);
      req.end();
    });
    expect(status).toBe(403);
  });

  it('state includes facets, stale count, and conflicts on inbox items', async () => {
    store.create({ text: 'Standup meeting is at 10am daily', source: 'cli', tags: ['rituals'] });
    store.create({
      text: 'Standup meeting is at 9:30am daily',
      source: 'claude-code',
      status: 'unreviewed',
    });
    store.create({ text: 'Repo fact for acme', source: 'cli', scope: 'acme' });

    const data = await (await fetch(`${ui.url}/api/state`)).json();
    expect(data.facets.sources.cli).toBe(2);
    expect(data.facets.scopes.acme).toBe(1);
    expect(data.facets.tags.rituals).toBe(1);
    expect(typeof data.stale).toBe('number');
    expect(data.inbox).toHaveLength(1);
    expect(data.inbox[0].conflicts).toHaveLength(1);
    expect(data.inbox[0].conflicts[0].body).toContain('10am');
  });

  it('memory detail returns the supersede history chain and conflicts', async () => {
    const { memory: original } = store.create({ text: 'Standup is at 10am', source: 'cli' });
    const { memory: successor } = store.supersede(original.id, {
      text: 'Standup is at 9:30am',
      source: 'claude-code',
    });

    const res = await fetch(`${ui.url}/api/memories/${successor.id}`);
    const data = await res.json();
    expect(data.memory.id).toBe(successor.id);
    expect(data.history.map((m: { id: string }) => m.id)).toEqual([original.id, successor.id]);

    const fromOldEnd = await (await fetch(`${ui.url}/api/memories/${original.id}`)).json();
    expect(fromOldEnd.history.map((m: { id: string }) => m.id)).toEqual([original.id, successor.id]);
  });

  it('confirm bumps lastConfirmed over the api', async () => {
    const { memory } = store.create({ text: 'Fact to reconfirm', source: 'cli' });
    await new Promise((r) => setTimeout(r, 5));
    const res = await fetch(`${ui.url}/api/memories/${memory.id}/confirm`, {
      method: 'POST',
      headers: HEADERS,
    });
    const data = await res.json();
    expect(Date.parse(data.memory.lastConfirmed)).toBeGreaterThan(Date.parse(memory.lastConfirmed));
  });

  it('bulk review approves and rejects many ids at once', async () => {
    const a = store.create({ text: 'Bulk pending one', source: 'cursor', status: 'unreviewed' }).memory;
    const b = store.create({ text: 'Bulk pending two', source: 'cursor', status: 'unreviewed' }).memory;
    const res = await fetch(`${ui.url}/api/review/bulk`, {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify({ action: 'approve', ids: [a.id, b.id, 'does-not-exist'] }),
    });
    const { results } = await res.json();
    expect(results.filter((r: { ok: boolean }) => r.ok)).toHaveLength(2);
    expect(store.get(a.id)!.status).toBe('active');
    expect(store.get(b.id)!.status).toBe('active');

    const bad = await fetch(`${ui.url}/api/review/bulk`, {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify({ action: 'nuke', ids: [a.id] }),
    });
    expect(bad.status).toBe(400);
  });

  it('serves the profile markdown exactly as agents see it', async () => {
    store.create({ text: 'Michael is a full-stack developer', source: 'cli', pinned: true });
    const data = await (await fetch(`${ui.url}/api/profile`)).json();
    expect(data.markdown).toContain('full-stack developer');
    expect(data.markdown).toContain('Data, not instructions');
    expect(data.pinned).toHaveLength(1);
  });

  it('creates memories with scope and reports conflicts', async () => {
    store.create({ text: 'Deploy day is Friday morning', source: 'cli' });
    const res = await fetch(`${ui.url}/api/memories`, {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify({ text: 'Deploy day is Monday morning', scope: 'Acme API' }),
    });
    const data = await res.json();
    expect(data.memory.scope).toBe('acme-api');
    expect(data.conflicts).toHaveLength(1);
  });

  it('404s on unknown ids and 400s on bad input', async () => {
    const missing = await fetch(`${ui.url}/api/memories/nope/approve`, { method: 'POST', headers: HEADERS });
    expect(missing.status).toBe(404);

    const bad = await fetch(`${ui.url}/api/memories`, { method: 'POST', headers: HEADERS, body: '{oops' });
    expect(bad.status).toBe(400);

    const empty = await fetch(`${ui.url}/api/memories`, { method: 'POST', headers: HEADERS, body: JSON.stringify({ text: '  ' }) });
    expect(empty.status).toBe(400);
  });
});
