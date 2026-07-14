#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
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

/** The HTTP bearer token lives next to the vault, readable only by the user. */
function loadOrCreateHttpToken(home: string): string {
  const path = join(home, 'http-token');
  if (existsSync(path)) {
    const token = readFileSync(path, 'utf8').trim();
    if (token) return token;
  }
  const token = randomBytes(32).toString('base64url');
  writeFileSync(path, `${token}\n`, { mode: 0o600 });
  console.error(`generated http token → ${path}`);
  return token;
}

program
  .command('add')
  .description('save a memory')
  .argument('<text...>', 'the memory text')
  .option('-t, --type <type>', `one of: ${MEMORY_TYPES.join(', ')}`, 'fact')
  .option('--tags <tags>', 'comma-separated tags')
  .option('--scope <scope>', 'project/workspace this fact belongs to (omit for global)')
  .option('--pin', 'pin into the core profile served to AI tools')
  .option('--source <source>', 'provenance label', 'cli')
  .action((words: string[], opts) => {
    const store = openStore();
    try {
      const { memory, existing } = store.create({
        text: words.join(' '),
        type: parseType(opts.type),
        tags: parseTags(opts.tags),
        scope: opts.scope,
        source: opts.source,
        pinned: opts.pin === true,
      });
      console.log(
        existing
          ? `${yellow('already known')} as ${memory.id}`
          : `${green('saved')} ${memory.id}`,
      );
      if (!existing) {
        for (const conflict of store.findConflicts(memory)) {
          console.log(yellow(`⚠ possibly conflicts with ${conflict.id}: ${conflict.body}`));
        }
      }
    } catch (err) {
      fail((err as Error).message);
    } finally {
      store.close();
    }
  });

const importCmd = program
  .command('import')
  .description('bring memories in from other tools — everything lands in the review inbox');

type ImportCliOpts = { scope?: string; tags?: string; type?: string; dryRun?: boolean };

function withImportOptions(cmd: Command): Command {
  return cmd
    .option('--scope <scope>', 'scope every imported fact to this project')
    .option('--tags <tags>', 'comma-separated tags added to every fact')
    .option('-t, --type <type>', `force a type: ${MEMORY_TYPES.join(', ')}`)
    .option('--dry-run', 'show what would be imported without writing anything');
}

async function executeImport(
  source: string,
  opts: ImportCliOpts,
  extract: () => Promise<import('../import/core.js').Extraction>,
): Promise<void> {
  const { runImport } = await import('../cli/import.js');
  let extraction;
  try {
    extraction = await extract();
  } catch (err) {
    fail((err as Error).message);
  }
  const store = openStore();
  try {
    runImport(store, extraction, {
      source,
      scope: opts.scope,
      tags: parseTags(opts.tags),
      type: parseType(opts.type),
      dryRun: opts.dryRun === true,
    });
  } finally {
    store.close();
  }
}

withImportOptions(
  importCmd
    .command('text')
    .description('a pasted memory list — one fact per line, bullets ok')
    .argument('<file>'),
).action((file: string, opts: ImportCliOpts) =>
  executeImport('import:text', opts, async () => {
    const { parseFactLines } = await import('../import/text.js');
    return { facts: parseFactLines(readFileSync(file, 'utf8')).map((text) => ({ text })), errors: [] };
  }),
);

withImportOptions(
  importCmd
    .command('chatgpt')
    .description("a ChatGPT data export (.zip, unzipped folder, or conversations.json) or a pasted 'Manage memories' list (.txt)")
    .argument('<path>'),
).action((path: string, opts: ImportCliOpts) =>
  executeImport('import:chatgpt', opts, async () => {
    const { extractChatgptFacts } = await import('../import/chatgpt.js');
    return extractChatgptFacts(path);
  }),
);

withImportOptions(
  importCmd
    .command('claude')
    .description('Claude Code project memories (default: ~/.claude/projects) or a pasted claude.ai memory summary (.txt)')
    .argument('[path]'),
).action((path: string | undefined, opts: ImportCliOpts) =>
  executeImport('import:claude', opts, async () => {
    const { extractClaudeFacts } = await import('../import/claude.js');
    return extractClaudeFacts(path);
  }),
);

withImportOptions(
  importCmd
    .command('markdown')
    .description('a folder of markdown notes (Obsidian-style) — one note per memory')
    .argument('<dir>'),
).action((dir: string, opts: ImportCliOpts) =>
  executeImport('import:markdown', opts, async () => {
    const { extractMarkdownNotes } = await import('../import/markdown.js');
    return extractMarkdownNotes(dir);
  }),
);

program
  .command('search')
  .description('full-text search across memories')
  .argument('<query...>')
  .option('-n, --limit <n>', 'max results', '8')
  .option('--status <status>', `filter: ${MEMORY_STATUSES.join(', ')} (default: not archived)`)
  .option('--scope <scope>', 'search this scope plus global memories')
  .action((words: string[], opts) => {
    const store = openStore();
    printMemories(
      store.search(words.join(' '), {
        limit: Number(opts.limit) || 8,
        status: parseStatus(opts.status),
        scope: opts.scope,
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
  .option('--scope <scope>', 'only memories in this exact scope')
  .option('--pinned', 'only pinned memories')
  .option('-n, --limit <n>', 'max results', '20')
  .action((opts) => {
    const store = openStore();
    printMemories(
      store.list({
        status: parseStatus(opts.status),
        type: parseType(opts.type),
        tag: opts.tag,
        scope: opts.scope,
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
  .command('confirm')
  .description('mark a memory as re-verified — fresh memories rank higher in recall')
  .argument('<id>')
  .action((id: string) => {
    const store = openStore();
    if (!store.get(id)) fail(`no memory with id ${JSON.stringify(id)}`);
    store.confirm(id);
    console.log(`${green('✓')} confirmed ${id}`);
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
  .description('run the MCP server — stdio by default, --http for remote-capable clients')
  .option('--scope <scope>', 'default scope for remember/recall (e.g. this project’s name)')
  .option('--http', 'serve over token-authenticated streamable HTTP instead of stdio')
  .option('-p, --port <n>', 'HTTP port (with --http)', '5424')
  .option('--host <host>', 'HTTP bind address (with --http); non-loopback exposes the vault to the network', '127.0.0.1')
  .option('--token <token>', 'HTTP bearer token (default: $ENGRAM_HTTP_TOKEN, else ~/.engram/http-token, generated on first use)')
  .action(async (opts) => {
    if (typeof opts.scope === 'string' && opts.scope.trim()) {
      process.env.ENGRAM_SCOPE = opts.scope.trim();
    }
    const store = openStore();

    if (opts.http === true) {
      const { startHttpServer } = await import('../mcp/http.js');
      const explicit = (opts.token as string | undefined) ?? process.env.ENGRAM_HTTP_TOKEN;
      const token = explicit ?? loadOrCreateHttpToken(store.home);
      const host = opts.host as string;
      const { url } = await startHttpServer(store, {
        token,
        port: Number(opts.port) || 5424,
        host,
      });
      console.error(`engram ${VERSION} mcp server (http) ready at ${url} (data: ${store.home})`);
      console.error(
        explicit
          ? 'clients must send: Authorization: Bearer <your token>'
          : `clients must send: Authorization: Bearer <token in ${join(store.home, 'http-token')}>`,
      );
      if (host !== '127.0.0.1' && host !== 'localhost' && host !== '::1') {
        console.error(yellow('warning: bound beyond localhost — anyone with the token can read and write your memories'));
      }
      return;
    }

    const { StdioServerTransport } = await import('@modelcontextprotocol/sdk/server/stdio.js');
    const { createEngramServer } = await import('../mcp/server.js');
    const server = createEngramServer(store);
    await server.connect(new StdioServerTransport());
    // stdout belongs to the MCP protocol; human-facing chatter goes to stderr.
    console.error(`engram ${VERSION} mcp server ready (data: ${store.home})`);
  });

const hookCmd = program
  .command('hook')
  .description('endpoints AI tools call into — wired up by `engram install`');

hookCmd
  .command('session-start')
  .description('print profile + current project facts for injection at session start')
  .action(async () => {
    // A memory hiccup must never break the user's session: on any failure,
    // print nothing and exit 0.
    try {
      const payload = await readStdinWithTimeout();
      let cwd = process.cwd();
      try {
        const parsed = JSON.parse(payload) as { cwd?: unknown };
        if (typeof parsed.cwd === 'string' && parsed.cwd) cwd = parsed.cwd;
      } catch {
        // No or malformed hook payload (e.g. run by hand) — use the real cwd.
      }
      const { renderSessionContext, scopeForDirectory } = await import('../store/session.js');
      const store = openStore();
      try {
        const context = renderSessionContext(store, scopeForDirectory(cwd));
        if (context) process.stdout.write(`${context}\n`);
      } finally {
        store.close();
      }
    } catch {
      process.exitCode = 0;
    }
  });

/** Hook payloads arrive on stdin; never hang waiting for one that isn't coming. */
function readStdinWithTimeout(timeoutMs = 800): Promise<string> {
  if (process.stdin.isTTY) return Promise.resolve('');
  return new Promise((resolve) => {
    let data = '';
    const finish = (): void => {
      clearTimeout(timer);
      process.stdin.destroy();
      resolve(data);
    };
    const timer = setTimeout(finish, timeoutMs);
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => {
      data += chunk;
    });
    process.stdin.once('end', finish);
    process.stdin.once('error', finish);
  });
}

program
  .command('doctor')
  .description('check that engram is healthy on this machine')
  .action(() => {
    runDoctor(home());
  });

program.parseAsync().catch((err: Error) => fail(err.message));
