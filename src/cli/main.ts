#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { Command } from 'commander';
import { Store, defaultHome } from '../store/store.js';
import { MEMORY_STATUSES, MEMORY_TYPES, type MemoryStatus, type MemoryType } from '../store/types.js';
import { VERSION } from '../version.js';
import { runDoctor } from './doctor.js';
import { dim, fail, green, memoryCard, printMemories, yellow } from './format.js';

const program = new Command();

program
  .name('engram')
  .description('One memory. Every AI. Yours.\nA local-first memory vault your AI tools plug into over MCP.')
  .version(VERSION)
  .option('--home <dir>', 'data directory (default: $ENGRAM_HOME or ~/.engram)');

function home(): string {
  return (program.opts().home as string | undefined) ?? defaultHome();
}

function openStore(): Store {
  return new Store(home());
}

function parseType(value: string | undefined): MemoryType | undefined {
  if (value === undefined) return undefined;
  if (!MEMORY_TYPES.includes(value as MemoryType)) {
    fail(`invalid type ${JSON.stringify(value)} — use one of: ${MEMORY_TYPES.join(', ')}`);
  }
  return value as MemoryType;
}

function parseStatus(value: string | undefined): MemoryStatus | undefined {
  if (value === undefined) return undefined;
  if (!MEMORY_STATUSES.includes(value as MemoryStatus)) {
    fail(`invalid status ${JSON.stringify(value)} — use one of: ${MEMORY_STATUSES.join(', ')}`);
  }
  return value as MemoryStatus;
}

function parseTags(value: string | undefined): string[] | undefined {
  if (value === undefined) return undefined;
  return value.split(',').map((t) => t.trim()).filter(Boolean);
}

program
  .command('add')
  .description('save a memory')
  .argument('<text...>', 'the memory text')
  .option('-t, --type <type>', `one of: ${MEMORY_TYPES.join(', ')}`, 'fact')
  .option('--tags <tags>', 'comma-separated tags')
  .option('--pin', 'pin into the core profile served to AI tools')
  .option('--source <source>', 'provenance label', 'cli')
  .action((words: string[], opts) => {
    const store = openStore();
    try {
      const { memory, existing } = store.create({
        text: words.join(' '),
        type: parseType(opts.type),
        tags: parseTags(opts.tags),
        source: opts.source,
        pinned: opts.pin === true,
      });
      console.log(
        existing
          ? `${yellow('already known')} as ${memory.id}`
          : `${green('saved')} ${memory.id}`,
      );
    } catch (err) {
      fail((err as Error).message);
    } finally {
      store.close();
    }
  });

program
  .command('search')
  .description('full-text search across memories')
  .argument('<query...>')
  .option('-n, --limit <n>', 'max results', '8')
  .option('--status <status>', `filter: ${MEMORY_STATUSES.join(', ')} (default: not archived)`)
  .action((words: string[], opts) => {
    const store = openStore();
    printMemories(
      store.search(words.join(' '), {
        limit: Number(opts.limit) || 8,
        status: parseStatus(opts.status),
      }),
    );
    store.close();
  });

program
  .command('list')
  .description('list memories, most recently updated first')
  .option('--status <status>', `filter: ${MEMORY_STATUSES.join(', ')} (default: not archived)`)
  .option('-t, --type <type>', `filter: ${MEMORY_TYPES.join(', ')}`)
  .option('--tag <tag>', 'filter by tag')
  .option('--pinned', 'only pinned memories')
  .option('-n, --limit <n>', 'max results', '20')
  .action((opts) => {
    const store = openStore();
    printMemories(
      store.list({
        status: parseStatus(opts.status),
        type: parseType(opts.type),
        tag: opts.tag,
        pinned: opts.pinned === true ? true : undefined,
        limit: Number(opts.limit) || 20,
      }),
    );
    store.close();
  });

program
  .command('show')
  .description('print a memory file verbatim')
  .argument('<id>')
  .action((id: string) => {
    const store = openStore();
    if (!store.get(id)) fail(`no memory with id ${JSON.stringify(id)}`);
    const path = store.pathFor(id);
    process.stdout.write(readFileSync(path, 'utf8'));
    console.log(dim(path));
    store.close();
  });

program
  .command('edit')
  .description('open a memory in $EDITOR')
  .argument('<id>')
  .action((id: string) => {
    const store = openStore();
    if (!store.get(id)) fail(`no memory with id ${JSON.stringify(id)}`);
    const path = store.pathFor(id);
    const editor = process.env.EDITOR ?? process.env.VISUAL;
    if (!editor) {
      console.log(`$EDITOR is not set — edit the file directly:\n${path}`);
      store.close();
      return;
    }
    const result = spawnSync(editor, [path], { stdio: 'inherit', shell: false });
    if (result.status !== 0) fail(`${editor} exited with status ${result.status}`);
    store.sync();
    const memory = store.get(id);
    if (memory) console.log(memoryCard(memory));
    store.close();
  });

program
  .command('rm')
  .description('archive a memory (soft delete); --hard removes the file')
  .argument('<id>')
  .option('--hard', 'delete the file permanently')
  .action((id: string, opts) => {
    const store = openStore();
    if (!store.get(id)) fail(`no memory with id ${JSON.stringify(id)}`);
    if (opts.hard === true) {
      store.remove(id);
      console.log(`deleted ${id}`);
    } else {
      store.archive(id);
      console.log(`archived ${id} ${dim('(file kept; use --hard to delete)')}`);
    }
    store.close();
  });

program
  .command('pin')
  .description('pin a memory into the core profile served to AI tools')
  .argument('<id>')
  .action((id: string) => {
    const store = openStore();
    if (!store.get(id)) fail(`no memory with id ${JSON.stringify(id)}`);
    store.update(id, { pinned: true, status: 'active' });
    console.log(`${yellow('★')} pinned ${id}`);
    store.close();
  });

program
  .command('unpin')
  .description('remove a memory from the core profile')
  .argument('<id>')
  .action((id: string) => {
    const store = openStore();
    if (!store.get(id)) fail(`no memory with id ${JSON.stringify(id)}`);
    store.update(id, { pinned: false });
    console.log(`unpinned ${id}`);
    store.close();
  });

program
  .command('reindex')
  .description('rebuild the search index from the markdown files')
  .action(() => {
    const store = openStore();
    const result = store.reindex();
    console.log(`reindexed ${result.added} memories`);
    for (const error of result.errors) console.log(yellow(`skipped ${error}`));
    store.close();
  });

program
  .command('review')
  .description('review what your AIs wrote — approve, edit, or reject')
  .action(async () => {
    const { runReview } = await import('./review.js');
    const store = openStore();
    await runReview(store);
    store.close();
  });

program
  .command('ui')
  .description('open the local web UI (what do my AIs know about me?)')
  .option('-p, --port <n>', 'port to listen on', '5423')
  .option('--no-open', 'do not open the browser')
  .action(async (opts) => {
    const { startUi } = await import('../ui/server.js');
    const { spawn } = await import('node:child_process');
    const store = openStore();
    const { url } = await startUi(store, { port: Number(opts.port) || 5423 });
    console.log(`engram ui → ${url}  ${dim('(local only; ctrl-c to stop)')}`);
    if (opts.open !== false) {
      const opener =
        process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'explorer' : 'xdg-open';
      try {
        spawn(opener, [url], { stdio: 'ignore', detached: true }).unref();
      } catch {
        // No browser available; the URL is printed anyway.
      }
    }
  });

program
  .command('serve')
  .description('run the MCP server on stdio — this is what AI tools connect to')
  .action(async () => {
    const { StdioServerTransport } = await import('@modelcontextprotocol/sdk/server/stdio.js');
    const { createEngramServer } = await import('../mcp/server.js');
    const store = openStore();
    const server = createEngramServer(store);
    await server.connect(new StdioServerTransport());
    // stdout belongs to the MCP protocol; human-facing chatter goes to stderr.
    console.error(`engram ${VERSION} mcp server ready (data: ${store.home})`);
  });

program
  .command('doctor')
  .description('check that engram is healthy on this machine')
  .action(() => {
    runDoctor(home());
  });

program.parseAsync().catch((err: Error) => fail(err.message));
