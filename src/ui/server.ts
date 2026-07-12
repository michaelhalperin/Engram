import { readFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { Store } from '../store/store.js';
import {
  MEMORY_STATUSES,
  MEMORY_TYPES,
  type MemoryStatus,
  type MemoryType,
} from '../store/types.js';

const HTML_URL = new URL('./public/index.html', import.meta.url);
const MAX_BODY_BYTES = 64 * 1024;
/** Loopback names we accept in Host — anything else smells like DNS rebinding. */
const ALLOWED_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

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

export function startUi(store: Store, opts: { port?: number } = {}): Promise<UiHandle> {
  const html = readFileSync(HTML_URL, 'utf8');

  const server = createServer(async (req, res) => {
    try {
      const hostname = (req.headers.host ?? '').replace(/:\d+$/, '');
      if (!ALLOWED_HOSTS.has(hostname)) {
        return send(res, 403, { error: 'engram ui only answers on localhost' });
      }

      const url = new URL(req.url ?? '/', 'http://localhost');
      const method = req.method ?? 'GET';

      if (method === 'GET' && url.pathname === '/') {
        return send(res, 200, html, 'text/html');
      }

      if (method === 'GET' && url.pathname === '/api/state') {
        const query = url.searchParams.get('query')?.trim() ?? '';
        const status = parseStatus(url.searchParams.get('status'));
        const type = parseType(url.searchParams.get('type'));
        const memories = query
          ? store.search(query, { limit: 100, status })
          : store.list({ status, type, limit: 200 });
        return send(res, 200, {
          counts: store.counts(),
          inbox: store.list({ status: 'unreviewed', limit: 100 }),
          memories: type && query ? memories.filter((m) => m.type === type) : memories,
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
          pinned: body.pinned === true,
          source: 'ui',
        });
        return send(res, existing ? 200 : 201, { memory, existing });
      }

      const idMatch = url.pathname.match(/^\/api\/memories\/([a-z0-9-]+)(?:\/(approve|reject))?$/);
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
        if (method === 'PATCH' && !action) {
          const body = await readBody(req);
          const memory = store.update(id, {
            text: typeof body.text === 'string' ? body.text : undefined,
            type: parseType(typeof body.type === 'string' ? body.type : null),
            tags: asTags(body.tags),
            status: parseStatus(typeof body.status === 'string' ? body.status : null),
            pinned: typeof body.pinned === 'boolean' ? body.pinned : undefined,
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
