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

  it('404s on unknown ids and 400s on bad input', async () => {
    const missing = await fetch(`${ui.url}/api/memories/nope/approve`, { method: 'POST', headers: HEADERS });
    expect(missing.status).toBe(404);

    const bad = await fetch(`${ui.url}/api/memories`, { method: 'POST', headers: HEADERS, body: '{oops' });
    expect(bad.status).toBe(400);

    const empty = await fetch(`${ui.url}/api/memories`, { method: 'POST', headers: HEADERS, body: JSON.stringify({ text: '  ' }) });
    expect(empty.status).toBe(400);
  });
});
