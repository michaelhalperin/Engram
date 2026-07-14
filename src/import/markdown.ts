import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import matter from 'gray-matter';
import type { Extraction, ImportedFact } from './core.js';

const SKIP_DIRS = new Set(['node_modules', '.git', '.obsidian', '.trash']);

/**
 * One note file = one memory. Frontmatter `tags` carry over; `created` (or
 * `date`) becomes the provenance timestamp, else the file's mtime. Notes that
 * are really essays get refused downstream by the store's size limit — that
 * refusal shows up in the report rather than silently truncating.
 */
export function extractMarkdownNotes(dir: string): Extraction {
  const extraction: Extraction = { facts: [], errors: [] };
  walk(dir, dir, extraction);
  extraction.facts.sort((a, b) => (a.created ?? '').localeCompare(b.created ?? ''));
  return extraction;
}

function walk(root: string, dir: string, extraction: Extraction): void {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch (err) {
    extraction.errors.push(`${relative(root, dir) || '.'}: ${(err as Error).message}`);
    return;
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.') || SKIP_DIRS.has(entry.name)) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(root, path, extraction);
      continue;
    }
    if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
    const fact = parseNote(path);
    if (typeof fact === 'string') {
      if (fact) extraction.errors.push(`${relative(root, path)}: ${fact}`);
    } else {
      extraction.facts.push(fact);
    }
  }
}

/** Returns the fact, an error message, or '' for files that are fine to skip silently. */
function parseNote(path: string): ImportedFact | string {
  let raw: string;
  let mtime: string;
  try {
    raw = readFileSync(path, 'utf8');
    mtime = new Date(statSync(path).mtimeMs).toISOString();
  } catch (err) {
    return (err as Error).message;
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
  if (!text) return ''; // empty note, nothing to remember
  const tags = Array.isArray(data.tags)
    ? data.tags.map((t) => String(t))
    : typeof data.tags === 'string'
      ? data.tags.split(',')
      : [];
  const created = data.created ?? data.date;
  return {
    text,
    tags: tags.map((t) => t.trim()).filter(Boolean),
    created:
      created instanceof Date
        ? created.toISOString()
        : typeof created === 'string'
          ? created
          : mtime,
  };
}
