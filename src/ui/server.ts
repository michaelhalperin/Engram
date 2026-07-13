import { existsSync, readFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderProfile } from '../store/profile.js';
import type { Store } from '../store/store.js';
import {
  MEMORY_STATUSES,
  MEMORY_TYPES,
  type Memory,
  type MemoryStatus,
  type MemoryType,
} from '../store/types.js';

/** Compiled React app (vite build output). Missing until `npm run build` has run. */
const PUBLIC_DIR = fileURLToPath(new URL('./public/', import.meta.url));
const MAX_BODY_BYTES = 64 * 1024;
/** Loopback names we accept in Host — anything else smells like DNS rebinding. */
const ALLOWED_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

const ASSET_TYPES: Record<string, string> = {
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.map': 'application/json',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

const PLACEHOLDER_HTML =
  '<!doctype html><meta charset="utf-8"><title>engram</title>' +
  '<body style="font-family:system-ui;padding:40px"><h1>◉ engram</h1>' +
  '<p>The web UI has not been built — run <code>npm run build</code> and restart <code>engram ui</code>.</p>';

export interface UiHandle {
  server: Server;
  port: number;
  url: string;
  close(): Promise<void>;
}

function send(res: ServerResponse, status: number, body: unknown, type = 'application/json'): void {
  const payload = type === 'application/json' ? JSON.stringify(body) : String(body);
  res.writeHead(status, {
    'content-type': `${type}; charset=utf-8`,
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  res.end(payload);
}

function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk: Buffer) => {
      raw += chunk;
      if (raw.length > MAX_BODY_BYTES) {
        reject(new Error('request body too large'));
        req.destroy();
      }
    });
    req.on('end', () => {
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw) as Record<string, unknown>);
      } catch {
        reject(new Error('invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

function parseStatus(value: string | null): MemoryStatus | undefined {
  return MEMORY_STATUSES.includes(value as MemoryStatus) ? (value as MemoryStatus) : undefined;
}

function parseType(value: string | null): MemoryType | undefined {
  return MEMORY_TYPES.includes(value as MemoryType) ? (value as MemoryType) : undefined;
}

function asTags(value: unknown): string[] | undefined {
  if (value === undefined) return undefined;
  if (Array.isArray(value)) return value.map((t) => String(t));
  if (typeof value === 'string') return value.split(',').map((t) => t.trim()).filter(Boolean);
  return undefined;
}

function withConflicts(store: Store, memory: Memory): Memory & { conflicts: Memory[] } {
  return { ...memory, conflicts: store.findConflicts(memory) };
}

/** Hashed vite assets under /assets/, plus the odd root-level file (favicon). */
function serveStatic(res: ServerResponse, pathname: string): boolean {
  const type = ASSET_TYPES[extname(pathname)];
  if (!type) return false;
  const relative = normalize(pathname).replace(/^[/\\]+/, '');
  if (relative.startsWith('..') || relative.includes('..')) return false;
  const path = join(PUBLIC_DIR, relative);
  if (!path.startsWith(PUBLIC_DIR) || !existsSync(path)) return false;
  res.writeHead(200, {
    'content-type': `${type}; charset=utf-8`,
    // Vite fingerprints /assets/* filenames, so they are safe to cache forever.
    'cache-control': pathname.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-store',
    'x-content-type-options': 'nosniff',
  });
  res.end(readFileSync(path));
  return true;
}

export function startUi(store: Store, opts: { port?: number } = {}): Promise<UiHandle> {
  const indexPath = join(PUBLIC_DIR, 'index.html');
  const html = existsSync(indexPath) ? readFileSync(indexPath, 'utf8') : PLACEHOLDER_HTML;

  const server = createServer(async (req, res) => {
    try {
      const hostname = (req.headers.host ?? '').replace(/:\d+$/, '');
      if (!ALLOWED_HOSTS.has(hostname)) {
        return send(res, 403, { error: 'engram ui only answers on localhost' });
      }

      const url = new URL(req.url ?? '/', 'http://localhost');
      const method = req.method ?? 'GET';

      if ((method === 'GET' || method === 'HEAD') && !url.pathname.startsWith('/api/')) {
        if (url.pathname === '/' || url.pathname === '/index.html') {
          return send(res, 200, html, 'text/html');
        }
        if (serveStatic(res, url.pathname)) return;
        return send(res, 404, { error: 'not found' });
      }

      if (method === 'GET' && url.pathname === '/api/state') {
        const query = url.searchParams.get('query')?.trim() ?? '';
        const status = parseStatus(url.searchParams.get('status'));
        const type = parseType(url.searchParams.get('type'));
        const scope = url.searchParams.get('scope') ?? undefined;
        const tag = url.searchParams.get('tag') ?? undefined;
        const pinned = url.searchParams.get('pinned') === '1' ? true : undefined;
        let memories: Memory[] = query
          ? store.search(query, { limit: 100, status, scope })
          : store.list({ status, type, scope, tag, pinned, limit: 200 });
        if (query) {
          // search() has no type/tag/pinned filters; narrow the hits here.
          memories = memories.filter(
            (m) =>
              (!type || m.type === type) &&
              (!tag || m.tags.includes(tag.toLowerCase())) &&
              (pinned === undefined || m.pinned === pinned),
          );
        }
        return send(res, 200, {
          counts: store.counts(),
          stale: store.staleCount(),
          facets: store.facets(),
          inbox: store.list({ status: 'unreviewed', limit: 100 }).map((m) => withConflicts(store, m)),
          memories,
        });
      }

      if (method === 'GET' && url.pathname === '/api/profile') {
        return send(res, 200, { markdown: renderProfile(store), pinned: store.pinned() });
      }

      const detailMatch = url.pathname.match(/^\/api\/memories\/([a-z0-9-]+)$/);
      if (method === 'GET' && detailMatch) {
        const memory = store.get(detailMatch[1]);
        if (!memory) return send(res, 404, { error: `no memory with id ${detailMatch[1]}` });
        return send(res, 200, {
          memory,
          history: store.history(memory.id),
          conflicts: store.findConflicts(memory),
        });
      }

      // Everything below mutates. The custom header forces a CORS preflight for
      // cross-origin callers, which we never answer — simple anti-CSRF.
      if (req.headers['x-engram'] !== '1') {
        return send(res, 403, { error: 'missing x-engram header' });
      }

      if (method === 'POST' && url.pathname === '/api/memories') {
        const body = await readBody(req);
        const { memory, existing } = store.create({
          text: String(body.text ?? ''),
          type: parseType(typeof body.type === 'string' ? body.type : null),
          tags: asTags(body.tags),
          scope: typeof body.scope === 'string' ? body.scope : undefined,
          pinned: body.pinned === true,
          source: 'ui',
        });
        return send(res, existing ? 200 : 201, {
          memory,
          existing,
          conflicts: existing ? [] : store.findConflicts(memory),
        });
      }

      if (method === 'POST' && url.pathname === '/api/review/bulk') {
        const body = await readBody(req);
        const action = body.action === 'approve' || body.action === 'reject' ? body.action : null;
        const ids = Array.isArray(body.ids) ? body.ids.map((v) => String(v)) : null;
        if (!action || !ids || ids.length === 0) {
          return send(res, 400, { error: 'expected { action: "approve"|"reject", ids: [...] }' });
        }
        const results = ids.map((id) => {
          try {
            if (!store.get(id)) return { id, ok: false, error: 'not found' };
            action === 'approve' ? store.approve(id) : store.reject(id);
            return { id, ok: true };
          } catch (err) {
            return { id, ok: false, error: (err as Error).message };
          }
        });
        return send(res, 200, { results });
      }

      const idMatch = url.pathname.match(
        /^\/api\/memories\/([a-z0-9-]+)(?:\/(approve|reject|confirm))?$/,
      );
      if (idMatch) {
        const [, id, action] = idMatch;
        if (!store.get(id)) return send(res, 404, { error: `no memory with id ${id}` });

        if (method === 'POST' && action === 'approve') {
          return send(res, 200, { memory: store.approve(id) });
        }
        if (method === 'POST' && action === 'reject') {
          const { memory, restored } = store.reject(id);
          return send(res, 200, { memory, restored });
        }
        if (method === 'POST' && action === 'confirm') {
          return send(res, 200, { memory: store.confirm(id) });
        }
        if (method === 'PATCH' && !action) {
          const body = await readBody(req);
          const memory = store.update(id, {
            text: typeof body.text === 'string' ? body.text : undefined,
            type: parseType(typeof body.type === 'string' ? body.type : null),
            tags: asTags(body.tags),
            status: parseStatus(typeof body.status === 'string' ? body.status : null),
            pinned: typeof body.pinned === 'boolean' ? body.pinned : undefined,
            scope: typeof body.scope === 'string' || body.scope === null ? body.scope : undefined,
          });
          return send(res, 200, { memory });
        }
        if (method === 'DELETE' && !action) {
          if (url.searchParams.get('hard') === '1') {
            store.remove(id);
            return send(res, 200, { deleted: id });
          }
          return send(res, 200, { memory: store.archive(id) });
        }
      }

      return send(res, 404, { error: 'not found' });
    } catch (err) {
      return send(res, 400, { error: (err as Error).message });
    }
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(opts.port ?? 5423, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : (opts.port ?? 5423);
      resolve({
        server,
        port,
        url: `http://127.0.0.1:${port}`,
        close: () => new Promise((done) => server.close(() => done())),
      });
    });
  });
}
