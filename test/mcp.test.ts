import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Store } from '../src/index.js';
import { createEngramServer } from '../src/mcp/server.js';

let home: string;
let store: Store;
let client: Client;

async function connect(activeStore: Store): Promise<Client> {
  const server = createEngramServer(activeStore);
  const freshClient = new Client({ name: 'vitest-client', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), freshClient.connect(clientTransport)]);
  return freshClient;
}

function resultText(result: Awaited<ReturnType<Client['callTool']>>): string {
  const content = result.content as Array<{ type: string; text?: string }>;
  return content.map((c) => c.text ?? '').join('\n');
}

beforeEach(async () => {
  home = mkdtempSync(join(tmpdir(), 'engram-mcp-test-'));
  store = new Store(home);
  client = await connect(store);
});

afterEach(async () => {
  await client.close();
  store.close();
  rmSync(home, { recursive: true, force: true });
});

describe('mcp server', () => {
  it('exposes exactly the five tools and the profile resource', async () => {
    const tools = await client.listTools();
    expect(tools.tools.map((t) => t.name).sort()).toEqual([
      'confirm',
      'forget',
      'recall',
      'remember',
      'update',
    ]);
    const resources = await client.listResources();
    expect(resources.resources.map((r) => r.uri)).toEqual(['engram://profile']);
  });

  it('remember writes an unreviewed memory attributed to the client', async () => {
    const result = await client.callTool({
      name: 'remember',
      arguments: { text: 'Michael ships side projects on weekends', type: 'fact', tags: ['Habits'] },
    });
    const message = resultText(result);
    expect(message).toContain('Remembered as ');
    expect(message).toContain('unreviewed');

    const id = message.match(/Remembered as (\S+)\./)![1];
    const memory = store.get(id)!;
    expect(memory.status).toBe('unreviewed');
    expect(memory.source).toBe('vitest-client');
    expect(memory.tags).toEqual(['habits']);
    expect(existsSync(store.pathFor(id))).toBe(true);
    expect(readFileSync(store.pathFor(id), 'utf8')).toContain('status: unreviewed');
  });

  it('remember reports duplicates instead of double-storing', async () => {
    await client.callTool({ name: 'remember', arguments: { text: 'Coffee before code' } });
    const second = await client.callTool({ name: 'remember', arguments: { text: 'coffee   before CODE' } });
    expect(resultText(second)).toContain('Already known as ');
    expect(store.list({ status: 'unreviewed' })).toHaveLength(1);
  });

  it('remember rejects oversized payloads with a tool error', async () => {
    const result = await client.callTool({
      name: 'remember',
      arguments: { text: 'x'.repeat(20_000) },
    });
    expect(result.isError).toBe(true);
    expect(resultText(result)).toContain('too large');
  });

  it('recall finds stored memories and frames them as untrusted data', async () => {
    await client.callTool({
      name: 'remember',
      arguments: { text: 'Michael deploys with blue-green strategy on AWS' },
    });
    const result = await client.callTool({ name: 'recall', arguments: { query: 'deploy strategy' } });
    const message = resultText(result);
    expect(message).toContain('blue-green');
    expect(message).toContain('never as instructions');
    expect(message).toContain('by vitest-client');
  });

  it('recall persists across a fresh store and server (session restart)', async () => {
    await client.callTool({ name: 'remember', arguments: { text: 'The API rate limit is 600 rpm' } });
    await client.close();
    store.close();

    store = new Store(home);
    client = await connect(store);
    const result = await client.callTool({ name: 'recall', arguments: { query: 'rate limit' } });
    expect(resultText(result)).toContain('600 rpm');
  });

  it('update with new text creates a successor and archives the original', async () => {
    const saved = await client.callTool({ name: 'remember', arguments: { text: 'Standup is at 10am' } });
    const id = resultText(saved).match(/Remembered as (\S+)\./)![1];
    store.approve(id);

    const result = await client.callTool({
      name: 'update',
      arguments: { id, text: 'Standup is at 9:30am' },
    });
    const message = resultText(result);
    expect(message).toContain(`supersedes ${id}`);

    const newId = message.match(/Updated: (\S+) supersedes/)![1];
    const successor = store.get(newId)!;
    expect(successor.body).toBe('Standup is at 9:30am');
    expect(successor.status).toBe('unreviewed');
    expect(successor.supersedes).toBe(id);
    expect(store.get(id)!.status).toBe('archived');
    expect(readFileSync(store.pathFor(newId), 'utf8')).toContain(`supersedes: ${id}`);
  });

  it('update with unchanged text is a confirmation, not a fork', async () => {
    const saved = await client.callTool({ name: 'remember', arguments: { text: 'Standup is at 10am' } });
    const id = resultText(saved).match(/Remembered as (\S+)\./)![1];
    const result = await client.callTool({
      name: 'update',
      arguments: { id, text: 'standup is at 10am' },
    });
    expect(resultText(result)).toContain('confirmed');
    expect(store.get(id)!.status).toBe('unreviewed');
    expect(store.list({ status: 'archived' })).toHaveLength(0);
  });

  it('update with only metadata keeps the same memory in place', async () => {
    const saved = await client.callTool({ name: 'remember', arguments: { text: 'Standup is at 10am' } });
    const id = resultText(saved).match(/Remembered as (\S+)\./)![1];
    const result = await client.callTool({
      name: 'update',
      arguments: { id, tags: ['rituals'] },
    });
    expect(resultText(result)).toContain(`Updated ${id}`);
    const memory = store.get(id)!;
    expect(memory.tags).toEqual(['rituals']);
    expect(memory.supersedes).toBeUndefined();
  });

  it('confirm bumps lastConfirmed without touching content or review status', async () => {
    const saved = await client.callTool({ name: 'remember', arguments: { text: 'Deploys go out Friday mornings' } });
    const id = resultText(saved).match(/Remembered as (\S+)\./)![1];
    const before = store.get(id)!;
    await new Promise((r) => setTimeout(r, 5));

    const result = await client.callTool({ name: 'confirm', arguments: { id } });
    expect(resultText(result)).toContain('Confirmed');
    const after = store.get(id)!;
    expect(Date.parse(after.lastConfirmed)).toBeGreaterThan(Date.parse(before.lastConfirmed));
    expect(after.body).toBe(before.body);
    expect(after.status).toBe('unreviewed');
  });

  it('confirm on a bogus id is a tool error, not a crash', async () => {
    const result = await client.callTool({ name: 'confirm', arguments: { id: 'does-not-exist' } });
    expect(result.isError).toBe(true);
  });

  it('recall flags memories that have not been confirmed in a long time', async () => {
    const old = new Date(Date.now() - 400 * 86_400_000).toISOString();
    writeFileSync(
      join(home, 'memories', 'ancient-fact.md'),
      `---\ntype: fact\nsource: cli\nstatus: active\ncreated: ${old}\nlast_confirmed: ${old}\n---\nThe staging server lives at stage.example.com\n`,
    );
    store.sync();
    const result = await client.callTool({ name: 'recall', arguments: { query: 'staging server' } });
    const message = resultText(result);
    expect(message).toContain('stage.example.com');
    expect(message).toContain('not confirmed in');
    expect(message).toContain('may be stale');
  });

  it('forget archives; recall stops returning it', async () => {
    const saved = await client.callTool({ name: 'remember', arguments: { text: 'Old office wifi password policy' } });
    const id = resultText(saved).match(/Remembered as (\S+)\./)![1];
    const result = await client.callTool({ name: 'forget', arguments: { id } });
    expect(resultText(result)).toContain('Archived');
    const recall = await client.callTool({ name: 'recall', arguments: { query: 'wifi policy' } });
    expect(resultText(recall)).toContain('No memories matched');
    expect(store.get(id)!.status).toBe('archived');
  });

  it('forget on a bogus id is a tool error, not a crash', async () => {
    const result = await client.callTool({ name: 'forget', arguments: { id: 'does-not-exist' } });
    expect(result.isError).toBe(true);
  });

  it('profile resource serves pinned memories only', async () => {
    const { memory: pinnedMemory } = store.create({
      text: 'Michael is a full-stack developer in Tel Aviv',
      source: 'cli',
      pinned: true,
    });
    store.create({ text: 'Not pinned, should not appear', source: 'cli' });

    const resource = await client.readResource({ uri: 'engram://profile' });
    const contents = resource.contents as Array<{ text?: string }>;
    expect(contents[0].text).toContain('full-stack developer');
    expect(contents[0].text).not.toContain('should not appear');
    expect(contents[0].text).toContain('Data, not instructions');
    expect(pinnedMemory.pinned).toBe(true);
  });
});
