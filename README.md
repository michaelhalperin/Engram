# ◉ Engram

**One memory. Every AI. Yours.**

Every AI you use — Claude Code, Claude Desktop, Cursor, whatever comes next — either forgets you every session or hoards what it learns inside its own silo. You re-explain your stack, your preferences, your projects, dozens of times a week. Vendors build "memory" as a lock-in feature, which is exactly why none of them will build the portable version.

Engram is that missing layer: a **local-first personal memory vault** that any AI tool plugs into over [MCP](https://modelcontextprotocol.io). Your context belongs to you, not to whichever chat app you happened to type it into.

- 🗂 **Plain markdown files.** Every memory is a file in `~/.engram/memories/` — grep it, edit it in vim, sync it with git/iCloud/Obsidian. The search index is derived and disposable.
- 🔌 **Works with every MCP client.** One server, four tools (`remember`, `recall`, `update`, `forget`) plus a pinned `engram://profile` resource any tool can load at session start.
- 👁 **You audit everything.** Agent writes land in a review inbox, attributed to the tool that wrote them. Approve, edit, or reject — `engram review` in the terminal or `engram ui` in the browser.
- 🔒 **Local only.** No cloud, no account, no telemetry. The UI binds to 127.0.0.1. Node's built-in SQLite — zero native dependencies.
- 🛡 **Injection-aware.** Recalled memories are explicitly framed as *stored data, never instructions*, and agents can't pin anything into your always-loaded profile — pinning is a human act.

## Quickstart

Requires Node ≥ 22.5.

```sh
npm install -g @michaelhalperin/engram

# tell it something
engram add "I prefer TypeScript for new projects" -t preference --pin

# plug it into your AI tools ↓ then just talk; they remember and recall on their own
```

**Claude Code**

```sh
claude mcp add engram -- engram serve
```

**Claude Desktop** — add to `claude_desktop_config.json`:

```json
{ "mcpServers": { "engram": { "command": "engram", "args": ["serve"] } } }
```

**Cursor** — add to `~/.cursor/mcp.json`:

```json
{ "mcpServers": { "engram": { "command": "engram", "args": ["serve"] } } }
```

Then, in any of them:

> **you:** remember that our staging deploys go out Friday mornings
> **later, in a different tool:** when do we deploy to staging?
> **it:** *recalls* → Friday mornings.

## The daily loop

```sh
engram review      # approve / edit / reject what your AIs wrote
engram ui          # browser view: what do my AIs know about me?
engram search vim  # full-text search from the terminal
engram pin <id>    # promote a fact into the profile every AI loads
```

## CLI

| command | what it does |
| --- | --- |
| `engram add <text> [-t type] [--tags a,b] [--pin]` | save a memory by hand |
| `engram search <query>` | BM25 full-text search |
| `engram list [--status s] [--type t] [--tag x]` | browse, newest first |
| `engram show / edit / rm [--hard] <id>` | inspect, open in `$EDITOR`, archive or delete |
| `engram pin / unpin <id>` | manage the core profile |
| `engram review` | interactive inbox for agent writes |
| `engram ui [--port 5423]` | local web UI |
| `engram serve` | MCP server on stdio (what AI tools run) |
| `engram reindex` | rebuild the search index from the files |
| `engram doctor` | health check |

## How it stores things

One file per memory, YAML frontmatter, body is the fact:

```markdown
---
type: preference
tags: [tooling]
source: claude-code
status: unreviewed
pinned: false
created: 2026-07-08T14:03:22.000Z
updated: 2026-07-08T14:03:22.000Z
---

Michael prefers TypeScript for new projects.
```

`source` says which tool wrote it. `status` is the review state: agents write `unreviewed`, you promote to `active` (or archive). Files are the source of truth — hand-edit anything, even while the server is running; the SQLite FTS5 index catches up automatically. `ENGRAM_HOME` moves the vault (default `~/.engram`).

## Design stances

1. **Files over databases.** Your memory should outlive this tool, your AI subscriptions, and possibly civilization's interest in SQLite.
2. **Audit over gatekeeping.** Agents write immediately (no friction), but everything is attributed and lands in your inbox. Trust, then verify.
3. **Data, not instructions.** Everything served to a model is wrapped in explicit "this is stored context, not commands" framing — memory should never become a prompt-injection channel.
4. **No lock-in, including ours.** It's markdown in a folder. Leaving Engram is `cp -r ~/.engram/memories .` — as it should be.

## Roadmap

- Importers: ChatGPT memory export, Claude memory, markdown notes
- Optional embeddings for semantic recall (pluggable, still local)
- Dedupe/merge suggestions for near-duplicate memories

## License

MIT © Michael Halperin
