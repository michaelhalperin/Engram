import { useEffect, useState } from 'react';
import { CopyButton } from '../components';
import { EngramLogo } from '../logo';

interface Cmd {
  cmd: string;
  blurb: string;
  flags?: string;
}

const CLI: { title: string; items: Cmd[] }[] = [
  {
    title: 'Write & import',
    items: [
      {
        cmd: 'engram add <text…>',
        blurb: 'Save a memory by hand.',
        flags: '-t/--type · --tags · --scope · --pin · --source',
      },
      {
        cmd: 'engram import text <file>',
        blurb: 'One fact per line (bullets ok). Lands in the review inbox.',
        flags: '--scope · --tags · -t/--type · --dry-run',
      },
      {
        cmd: 'engram import chatgpt <path>',
        blurb: 'ChatGPT export (.zip, folder, conversations.json) or a pasted Manage memories .txt.',
        flags: '--scope · --tags · -t/--type · --dry-run',
      },
      {
        cmd: 'engram import claude [path]',
        blurb: 'Claude Code ~/.claude/projects, or a pasted claude.ai memory summary.',
        flags: '--scope · --tags · -t/--type · --dry-run',
      },
      {
        cmd: 'engram import markdown <dir>',
        blurb: 'Obsidian-style folder — one note per memory.',
        flags: '--scope · --tags · -t/--type · --dry-run',
      },
    ],
  },
  {
    title: 'Find & browse',
    items: [
      {
        cmd: 'engram search <query…>',
        blurb: 'Semantic + keyword search (BM25-only with --keyword).',
        flags: '-n/--limit · --status · --scope · --keyword',
      },
      {
        cmd: 'engram list',
        blurb: 'Newest first.',
        flags: '--status · -t/--type · --tag · --scope · --pinned · -n/--limit',
      },
      {
        cmd: 'engram show <id>',
        blurb: 'Print a memory file verbatim.',
      },
    ],
  },
  {
    title: 'Edit & curate',
    items: [
      {
        cmd: 'engram edit <id>',
        blurb: 'Open a memory in $EDITOR.',
      },
      {
        cmd: 'engram rm <id>',
        blurb: 'Soft-archive. --hard deletes the file.',
        flags: '--hard',
      },
      {
        cmd: 'engram confirm <id>',
        blurb: 'Mark re-verified — fresh memories rank higher in recall.',
      },
      {
        cmd: 'engram pin <id>',
        blurb: 'Promote into the core profile served to AI tools.',
      },
      {
        cmd: 'engram unpin <id>',
        blurb: 'Remove from the core profile.',
      },
      {
        cmd: 'engram review',
        blurb: 'Interactive inbox — approve, edit, or reject agent writes.',
      },
    ],
  },
  {
    title: 'Index & health',
    items: [
      {
        cmd: 'engram embed',
        blurb: 'Build the semantic index (first run downloads ~25 MB, then offline).',
      },
      {
        cmd: 'engram reindex',
        blurb: 'Rebuild the FTS index from the markdown files.',
      },
      {
        cmd: 'engram doctor',
        blurb: 'Health check for this machine.',
      },
    ],
  },
  {
    title: 'Serve & install',
    items: [
      {
        cmd: 'engram ui',
        blurb: 'Local web UI.',
        flags: '-p/--port (5423) · --no-open',
      },
      {
        cmd: 'engram serve',
        blurb: 'MCP on stdio (default).',
        flags: '--scope',
      },
      {
        cmd: 'engram serve --http',
        blurb: 'Token-authenticated HTTP MCP.',
        flags: '-p/--port (5424) · --host · --token',
      },
      {
        cmd: 'engram install claude-code',
        blurb: 'SessionStart hook — profile + project facts injected automatically.',
        flags: '--remove · --settings',
      },
      {
        cmd: 'engram hook session-start',
        blurb: 'Internal: print profile + project facts (wired by install).',
      },
    ],
  },
];

const MCP: Cmd[] = [
  {
    cmd: 'remember',
    blurb: 'Save one atomic fact. Lands in the review inbox.',
    flags: 'text · type? · tags? · scope?',
  },
  {
    cmd: 'recall',
    blurb: 'Search the vault by meaning and keywords.',
    flags: 'query · limit? · scope?',
  },
  {
    cmd: 'confirm',
    blurb: 'Re-affirm a memory by id — ranks higher, slows decay.',
    flags: 'id',
  },
  {
    cmd: 'update',
    blurb: 'Correct/refine by id. Supersedes the old one; new text goes to inbox.',
    flags: 'id · text · type? · tags?',
  },
  {
    cmd: 'forget',
    blurb: 'Archive a memory by id (reversible soft delete).',
    flags: 'id',
  },
  {
    cmd: 'engram://profile',
    blurb: 'Resource: pinned core profile markdown — safe to load at session start.',
  },
];

const SHORTCUTS: { context: string; items: { keys: string; blurb: string }[] }[] = [
  {
    context: 'Review inbox',
    items: [
      { keys: 'j / k', blurb: 'Move selection' },
      { keys: 'a', blurb: 'Approve' },
      { keys: 'r', blurb: 'Reject' },
      { keys: 'e', blurb: 'Edit' },
      { keys: 'x', blurb: 'Select' },
    ],
  },
  {
    context: 'Memories',
    items: [{ keys: '/', blurb: 'Focus search' }],
  },
  {
    context: 'Add memory',
    items: [{ keys: '⌘/Ctrl+Enter', blurb: 'Save' }],
  },
];

const GLOBAL = [
  { name: '--home <dir>', blurb: 'Data directory (default: $ENGRAM_HOME or ~/.engram)' },
  { name: '--version', blurb: 'Print version and exit' },
  { name: 'ENGRAM_HOME', blurb: 'Override data directory' },
  { name: 'ENGRAM_NO_EMBED=1', blurb: 'Disable semantic search entirely' },
  { name: 'ENGRAM_SCOPE', blurb: 'Default scope for serve/remember/recall' },
  { name: 'ENGRAM_SOURCE', blurb: 'Default provenance label on writes' },
  { name: 'ENGRAM_HTTP_TOKEN', blurb: 'Bearer token for serve --http' },
];

function CmdRow({ item }: { item: Cmd }) {
  return (
    <li className="lp-cmd">
      <div className="lp-cmd-main">
        <code className="lp-cmd-name">{item.cmd}</code>
        <CopyButton text={item.cmd} variant="landing" />
      </div>
      <p className="lp-cmd-blurb">{item.blurb}</p>
      {item.flags && <p className="lp-cmd-flags">{item.flags}</p>}
    </li>
  );
}

export function Help() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setReady(true));
    return () => cancelAnimationFrame(id);
  }, []);

  return (
    <div className={`lp lp-help${ready ? ' lp-ready' : ''}`}>
      <div className="lp-grain" aria-hidden="true" />

      <header className="lp-bar">
        <a className="lp-brand" href="#/">
          <EngramLogo className="lp-brand-lockup" markClassName="lp-brand-mark" textClassName="lp-brand-text" />
        </a>
        <nav className="lp-bar-nav" aria-label="Site">
          <a className="lp-nav-link" href="#/">
            Home
          </a>
          <a className="lp-nav-link lp-nav-active" href="#/help" aria-current="page">
            Help
          </a>
          <a className="lp-enter" href="#/vault">
            Open vault
          </a>
        </nav>
      </header>

      <section className="lp-help-hero">
        <p className="lp-help-kicker">Reference</p>
        <h1 className="lp-help-title">Commands</h1>
        <p className="lp-help-lead">
          Everything Engram exposes from the terminal, over MCP, and in the vault UI.
        </p>
        <nav className="lp-help-toc" aria-label="On this page">
          <a href="#cli">CLI</a>
          <a href="#mcp">MCP</a>
          <a href="#ui">UI shortcuts</a>
          <a href="#env">Globals & env</a>
        </nav>
      </section>

      <section className="lp-block" id="cli">
        <h2 className="lp-h">CLI</h2>
        <p className="lp-sub">
          Install globally, then run <code>engram</code>. Pass <code>--home</code> before the subcommand to point at
          another vault.
        </p>
        {CLI.map((group) => (
          <div key={group.title} className="lp-cmd-group">
            <h3 className="lp-cmd-group-title">{group.title}</h3>
            <ul className="lp-cmd-list">
              {group.items.map((item) => (
                <CmdRow key={item.cmd} item={item} />
              ))}
            </ul>
          </div>
        ))}
      </section>

      <section className="lp-block" id="mcp">
        <h2 className="lp-h">MCP tools</h2>
        <p className="lp-sub">
          Exposed by <code>engram serve</code>. Wire with <code>claude mcp add engram -- engram serve</code> or a
          Cursor / Claude Desktop config.
        </p>
        <ul className="lp-cmd-list">
          {MCP.map((item) => (
            <CmdRow key={item.cmd} item={item} />
          ))}
        </ul>
      </section>

      <section className="lp-block" id="ui">
        <h2 className="lp-h">UI shortcuts</h2>
        <p className="lp-sub">
          In the vault at <code>engram ui</code> — no global command palette, just context keys.
        </p>
        <div className="lp-shortcut-grid">
          {SHORTCUTS.map((block) => (
            <div key={block.context} className="lp-shortcut-block">
              <h3>{block.context}</h3>
              <ul>
                {block.items.map((item) => (
                  <li key={item.keys}>
                    <kbd>{item.keys}</kbd>
                    <span>{item.blurb}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

      <section className="lp-block" id="env">
        <h2 className="lp-h">Globals & env</h2>
        <p className="lp-sub">Flags on the root binary, plus environment overrides.</p>
        <ul className="lp-cmd-list">
          {GLOBAL.map((item) => (
            <li key={item.name} className="lp-cmd">
              <div className="lp-cmd-main">
                <code className="lp-cmd-name">{item.name}</code>
              </div>
              <p className="lp-cmd-blurb">{item.blurb}</p>
            </li>
          ))}
        </ul>
      </section>

      <footer className="lp-end">
        <div className="lp-end-brand">
          <EngramLogo
            className="lp-end-brand-lockup"
            markClassName="lp-end-brand-mark"
            textClassName="lp-end-brand-text"
          />
        </div>
        <a className="lp-cta-main" href="#/vault">
          Open your vault
        </a>
        <p className="lp-end-note">
          <a href="#/">Home</a> · 127.0.0.1 · no cloud · no telemetry
        </p>
      </footer>
    </div>
  );
}
