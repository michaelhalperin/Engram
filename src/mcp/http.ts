import { randomUUID, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import type { Store } from '../store/store.js';
import { createEngramServer } from './server.js';

/**
 * Streamable-HTTP MCP endpoint, for clients that can't spawn a local process:
 * claude.ai remote MCP, another machine on a tailnet, mobile apps. Stdio stays
 * the default; this is opt-in via `engram serve --http`.
 *
 * Every request must carry `Authorization: Bearer <token>` — the vault is the
 * user's whole context, so there is no unauthenticated mode. When bound to
 * loopback we also reject non-loopback Host headers (DNS rebinding).
 */

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);
const MCP_PATH = '/mcp';
const MAX_BODY_BYTES = 4 * 1024 * 1024;

export interface HttpServeOptions {
  token: string;
  port?: number;
  host?: string;
}

export interface HttpHandle {
  server: Server;
  port: number;
  url: string;
  close(): Promise<void>;
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'x-content-type-options': 'nosniff',
    ...(status === 401 ? { 'www-authenticate': 'Bearer realm="engram"' } : {}),
  });
  res.end(JSON.stringify(body));
}

function rpcError(res: ServerResponse, status: number, code: number, message: string): void {
  sendJson(res, status, { jsonrpc: '2.0', error: { code, message }, id: null });
}

function authorized(req: IncomingMessage, token: string): boolean {
  const match = /^Bearer\s+(.+)$/i.exec(req.headers.authorization ?? '');
  if (!match) return false;
  const presented = Buffer.from(match[1]);
  const expected = Buffer.from(token);
  return presented.length === expected.length && timingSafeEqual(presented, expected);
}

function readBody(req: IncomingMessage): Promise<unknown> {
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
      if (!raw) return resolve(undefined);
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error('invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

export function startHttpServer(store: Store, opts: HttpServeOptions): Promise<HttpHandle> {
  const token = opts.token.trim();
  if (!token) throw new Error('http mode requires a non-empty token');
  const bindHost = opts.host ?? '127.0.0.1';
  const loopbackBound = LOOPBACK_HOSTS.has(bindHost);

  // One transport + MCP server pair per client session, all over one Store.
  const sessions = new Map<string, StreamableHTTPServerTransport>();

  const server = createServer(async (req, res) => {
    try {
      if (loopbackBound) {
        const hostname = (req.headers.host ?? '').replace(/:\d+$/, '');
        if (!LOOPBACK_HOSTS.has(hostname)) {
          return rpcError(res, 403, -32000, 'engram http server only answers on localhost');
        }
      }
      if (!authorized(req, token)) {
        return rpcError(res, 401, -32000, 'missing or invalid bearer token');
      }

      const url = new URL(req.url ?? '/', 'http://localhost');
      if (url.pathname !== MCP_PATH) {
        return rpcError(res, 404, -32000, `not found — the MCP endpoint is ${MCP_PATH}`);
      }

      const sessionId = req.headers['mcp-session-id'];
      const existing = typeof sessionId === 'string' ? sessions.get(sessionId) : undefined;

      if (req.method === 'POST') {
        const body = await readBody(req);
        if (existing) return existing.handleRequest(req, res, body);
        if (typeof sessionId === 'string') {
          // Stale or unknown session: 404 tells spec-compliant clients to reinitialize.
          return rpcError(res, 404, -32001, 'session not found — reinitialize');
        }
        if (!isInitializeRequest(body)) {
          return rpcError(res, 400, -32000, 'no session — send an initialize request first');
        }
        const transport: StreamableHTTPServerTransport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (sid) => {
            sessions.set(sid, transport);
          },
          onsessionclosed: (sid) => {
            sessions.delete(sid);
          },
        });
        transport.onclose = () => {
          if (transport.sessionId) sessions.delete(transport.sessionId);
        };
        await createEngramServer(store).connect(transport);
        return transport.handleRequest(req, res, body);
      }

      // GET opens the server-notification stream; DELETE ends the session.
      if (!existing) return rpcError(res, 400, -32000, 'missing or unknown mcp-session-id');
      return existing.handleRequest(req, res);
    } catch (err) {
      if (!res.headersSent) rpcError(res, 400, -32000, (err as Error).message);
    }
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(opts.port ?? 5424, bindHost, () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : (opts.port ?? 5424);
      const displayHost = bindHost.includes(':') ? `[${bindHost}]` : bindHost;
      resolve({
        server,
        port,
        url: `http://${displayHost}:${port}${MCP_PATH}`,
        close: async () => {
          await Promise.all([...sessions.values()].map((t) => t.close().catch(() => {})));
          sessions.clear();
          await new Promise<void>((done) => server.close(() => done()));
        },
      });
    });
  });
}
