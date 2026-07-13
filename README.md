# ◉ Engram

**One memory. Every AI. Yours.**

Every AI you use — Claude Code, Claude Desktop, Cursor, whatever comes next — either forgets you every session or hoards what it learns inside its own silo. You re-explain your stack, your preferences, your projects, dozens of times a week. Vendors build "memory" as a lock-in feature, which is exactly why none of them will build the portable version.

Engram is that missing layer: a **local-first personal memory vault** that any AI tool plugs into over [MCP](https://modelcontextprotocol.io). Your context belongs to you, not to whichever chat app you happened to type it into.

- 🗂 **Plain markdown files.** Every memory is a file in `~/.engram/memories/` — grep it, edit it in vim, sync it with git/iCloud/Obsidian. The search index is derived and disposable.
- 🔌 **Works with every MCP client.** One server, five tools (`remember`, `recall`, `confirm`, `update`, `forget`) plus a pinned `engram://profile` resource any tool can load at session start. Stdio for local tools; token-authenticated HTTP for everything that can't spawn a process.
- 🎯 **Project scopes.** A fact can belong to a project (`scope: acme-api`). Scoped recall returns that project's facts plus your global ones — never another project's — so "when do we deploy?" means *this* repo.
- ⚔️ **Contradiction alarms.** When an AI remembers something that overlaps an existing fact ("standup is at 9:30" vs "standup is at 10am"), Engram flags the pair — to the agent at write time, and to you in the review inbox — instead of letting both quietly coexist.
- 👁 **You audit everything.** Agent writes land in a review inbox, attributed to the tool that wrote them. Approve, edit, or reject — `engram review` in the terminal or `engram ui` in the browser.
- 🔒 **Local first.** No cloud, no account, no telemetry. The UI and the HTTP server bind to 127.0.0.1 unless you say otherwise. Node's built-in SQLite — zero native dependencies.
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

**Remote / can't-spawn-a-process clients** — serve over streamable HTTP with a bearer token:

```sh
engram serve --http               # http://127.0.0.1:5424/mcp
# token is generated on first run → ~/.engram/http-token (chmod 600)

claude mcp add --transport http engram http://127.0.0.1:5424/mcp \
  --header "Authorization: Bearer $(cat ~/.engram/http-token)"
```

Every request must carry the token; there is no unauthenticated mode. It binds to loopback unless you pass `--host` (say, a tailnet address) — and then anyone with the token can read and write your memories, so treat it like a password.

## Project scopes

Global facts are about *you*; scoped facts are about *a project*. Agents pass `scope` on `remember`/`recall` (the tool descriptions tell them to use the repo name), or you set a default for a per-project server:

```sh
claude mcp add engram -- engram serve --scope acme-api   # in acme-api's .mcp.json
engram add "deploys go out Friday mornings" --scope acme-api
engram search deploys --scope acme-api   # acme-api's facts + global ones, nothing else
```

Scoped recall ranks the project's own facts slightly above global ones; unscoped recall still searches everything. Facts scoped to *different* projects never shadow each other — "standup is at 10" can be true in one repo and false in another.

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
| `engram add <text> [-t type] [--tags a,b] [--scope s] [--pin]` | save a memory by hand (warns on likely contradictions) |
| `engram search <query> [--scope s]` | BM25 full-text search |
| `engram list [--status s] [--type t] [--tag x] [--scope s]` | browse, newest first |
| `engram show / edit / rm [--hard] <id>` | inspect, open in `$EDITOR`, archive or delete |
| `engram pin / unpin <id>` | manage the core profile |
| `engram confirm <id>` | mark a fact as re-verified — fresh facts rank higher |
| `engram review` | interactive inbox for agent writes |
| `engram ui [--port 5423]` | local web UI |
| `engram serve [--scope s]` | MCP server on stdio (what AI tools run) |
| `engram serve --http [--port 5424] [--host h] [--token t]` | MCP server over token-authenticated HTTP |
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
scope: acme-api
created: 2026-07-08T14:03:22.000Z
updated: 2026-07-08T14:03:22.000Z
last_confirmed: 2026-07-08T14:03:22.000Z
---

Michael prefers TypeScript for new projects.
```

`source` says which tool wrote it. `scope` (optional) says which project it belongs to; no scope means globally true. `status` is the review state: agents write `unreviewed`, you promote to `active` (or archive). `last_confirmed` tracks freshness: it bumps when a human approves, an agent calls `confirm`, or the fact is restated — recall ranks fresh, reviewed facts above stale, unreviewed ones, and flags anything unconfirmed for 6+ months so models hedge instead of asserting. When an agent corrects a fact, the new version is a new file with a `supersedes: <old-id>` link and the old one is archived, never overwritten — and rejecting a correction in review restores the original. Files are the source of truth — hand-edit anything, even while the server is running; the SQLite FTS5 index catches up automatically. `ENGRAM_HOME` moves the vault (default `~/.engram`).

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
