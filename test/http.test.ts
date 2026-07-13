import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Store } from '../src/index.js';
import { startHttpServer, type HttpHandle } from '../src/mcp/http.js';

const TOKEN = 'test-token-1234567890';

let home: string;
let store: Store;
let handle: HttpHandle;

function connect(token: string): { client: Client; transport: StreamableHTTPClientTransport } {
  const transport = new StreamableHTTPClientTransport(new URL(handle.url), {
    requestInit: { headers: { authorization: `Bearer ${token}` } },
  });
  const client = new Client({ name: 'vitest-http-client', version: '1.0.0' });
  return { client, transport };
}

function resultText(result: Awaited<ReturnType<Client['callTool']>>): string {
  const content = result.content as Array<{ type: string; text?: string }>;
  return content.map((c) => c.text ?? '').join('\n');
}

beforeEach(async () => {
  home = mkdtempSync(join(tmpdir(), 'engram-http-test-'));
  store = new Store(home);
  handle = await startHttpServer(store, { token: TOKEN, port: 0 });
});

afterEach(async () => {
  await handle.close();
  store.close();
  rmSync(home, { recursive: true, force: true });
});

describe('http mcp server', () => {
  it('rejects requests without a bearer token', async () => {
    const res = await fetch(handle.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'initialize', id: 1 }),
    });
    expect(res.status).toBe(401);
    expect(res.headers.get('www-authenticate')).toContain('Bearer');
  });

  it('rejects a wrong token', async () => {
    const res = await fetch(handle.url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer wrong-token-0000000000',
      },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'initialize', id: 1 }),
    });
    expect(res.status).toBe(401);
  });

  it('rejects non-loopback Host headers when bound to loopback', async () => {
    // fetch silently drops a custom Host header, so go through node:http.
    const { request } = await import('node:http');
    const status = await new Promise<number>((resolve, reject) => {
      const req = request(
        {
          host: '127.0.0.1',
          port: handle.port,
          path: '/mcp',
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${TOKEN}`,
            host: 'evil.example.com',
          },
        },
        (res) => {
          res.resume();
          resolve(res.statusCode ?? 0);
        },
      );
      req.on('error', reject);
      req.end('{}');
    });
    expect(status).toBe(403);
  });

  it('404s off the /mcp path', async () => {
    const res = await fetch(handle.url.replace('/mcp', '/other'), {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` },
      body: '{}',
    });
    expect(res.status).toBe(404);
  });

  it('serves the full tool surface over http with a valid token', async () => {
    const { client, transport } = connect(TOKEN);
    await client.connect(transport);
    try {
      const tools = await client.listTools();
      expect(tools.tools.map((t) => t.name).sort()).toEqual([
        'confirm',
        'forget',
        'recall',
        'remember',
        'update',
      ]);

      const saved = await client.callTool({
        name: 'remember',
        arguments: { text: 'Remote clients reach engram over http now' },
      });
      expect(resultText(saved)).toContain('Remembered as ');

      const recalled = await client.callTool({
        name: 'recall',
        arguments: { query: 'remote clients http' },
      });
      expect(resultText(recalled)).toContain('over http');
    } finally {
      await client.close();
    }
  });

  it('keeps sessions independent and survives two clients on one store', async () => {
    const a = connect(TOKEN);
    const b = connect(TOKEN);
    await a.client.connect(a.transport);
    await b.client.connect(b.transport);
    try {
      await a.client.callTool({
        name: 'remember',
        arguments: { text: 'Written by the first http session' },
      });
      const recalled = await b.client.callTool({
        name: 'recall',
        arguments: { query: 'first http session' },
      });
      expect(resultText(recalled)).toContain('Written by the first');
    } finally {
      await a.client.close();
      await b.client.close();
    }
  });
});
