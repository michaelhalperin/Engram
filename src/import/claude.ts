import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import matter from 'gray-matter';
import { normalizeScope } from '../store/files.js';
import type { Extraction, ImportedFact } from './core.js';
import type { MemoryType } from '../store/types.js';
import { parseFactLines } from './text.js';

/**
 * Claude Code keeps per-project memory as one markdown file per fact under
 * `~/.claude/projects/<slug>/memory/`, with a MEMORY.md index. We import the
 * fact files and skip the index. The slug is the project path flattened to
 * dashes — it can't be decoded back to a real path, so it becomes the scope
 * as-is; re-scope in review if you want something prettier.
 *
 * A pasted claude.ai memory summary works too — pass it as a .txt file,
 * one fact per line.
 */
export function extractClaudeFacts(path?: string): Extraction {
  const target = path ?? join(homedir(), '.claude', 'projects');
  if (!existsSync(target)) {
    throw new Error(
      path ? `no such file or directory: ${path}` : `no Claude Code memory found at ${target}`,
    );
  }
  if (statSync(target).isFile()) {
    if (target.endsWith('.md')) {
      const extraction: Extraction = { facts: [], errors: [] };
      collectFact(target, undefined, extraction);
      return extraction;
    }
    return {
      facts: parseFactLines(readFileSync(target, 'utf8')).map((text) => ({ text })),
      errors: [],
    };
  }

  // A directory: a single memory dir, a project dir containing one, or the
  // projects root holding many projects.
  const extraction: Extraction = { facts: [], errors: [] };
  if (hasMemoryFiles(target)) {
    collectMemoryDir(target, undefined, extraction);
    return extraction;
  }
  const projectsRoot =
    basename(target) === '.claude' && existsSync(join(target, 'projects'))
      ? join(target, 'projects')
      : target;
  if (hasMemoryFiles(join(projectsRoot, 'memory'))) {
    collectMemoryDir(join(projectsRoot, 'memory'), scopeFromSlug(basename(projectsRoot)), extraction);
    return extraction;
  }
  for (const entry of readdirSync(projectsRoot, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    const memoryDir = join(projectsRoot, entry.name, 'memory');
    if (hasMemoryFiles(memoryDir)) {
      collectMemoryDir(memoryDir, scopeFromSlug(entry.name), extraction);
    }
  }
  if (extraction.facts.length === 0 && extraction.errors.length === 0) {
    extraction.errors.push(`${target}: no Claude Code memory files found`);
  }
  return extraction;
}

function hasMemoryFiles(dir: string): boolean {
  try {
    return readdirSync(dir).some((name) => name.endsWith('.md') && name !== 'MEMORY.md');
  } catch {
    return false;
  }
}

function collectMemoryDir(dir: string, scope: string | undefined, extraction: Extraction): void {
  for (const name of readdirSync(dir).sort()) {
    // MEMORY.md is the index over the facts, not a fact.
    if (!name.endsWith('.md') || name === 'MEMORY.md' || name.startsWith('.')) continue;
    collectFact(join(dir, name), scope, extraction);
  }
}

/** Claude Code memory types → ours. Unknown or missing types degrade to `fact`. */
const TYPE_MAP: Record<string, MemoryType> = {
  user: 'fact',
  feedback: 'preference',
  project: 'project',
  reference: 'reference',
};

function collectFact(path: string, scope: string | undefined, extraction: Extraction): void {
  let raw: string;
  let mtime: string;
  try {
    raw = readFileSync(path, 'utf8');
    mtime = new Date(statSync(path).mtimeMs).toISOString();
  } catch (err) {
    extraction.errors.push(`${path}: ${(err as Error).message}`);
    return;
  }
  let data: Record<string, unknown> = {};
  let body = raw;
  try {
    const parsed = matter(raw);
    data = parsed.data as Record<string, unknown>;
    body = parsed.content;
  } catch {
    // Broken frontmatter: the whole file is the fact.
  }
  const text = body.trim();
  if (!text) return;
  const metadata = data.metadata as Record<string, unknown> | undefined;
  const claudeType = typeof metadata?.type === 'string' ? metadata.type : undefined;
  const fact: ImportedFact = {
    text,
    type: claudeType ? TYPE_MAP[claudeType] : undefined,
    scope,
    created: mtime,
  };
  extraction.facts.push(fact);
}

function scopeFromSlug(slug: string): string | undefined {
  return normalizeScope(slug.replace(/^-+/, ''));
}
