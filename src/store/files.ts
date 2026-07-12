import matter from 'gray-matter';
import { createHash } from 'node:crypto';
import {
  MEMORY_STATUSES,
  MEMORY_TYPES,
  type Memory,
  type MemoryStatus,
  type MemoryType,
} from './types.js';

export function slugify(text: string, maxLen = 36): string {
  const words = text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .split('-')
    .filter(Boolean);
  let slug = '';
  for (const word of words.slice(0, 6)) {
    const candidate = slug ? `${slug}-${word}` : word;
    if (candidate.length > maxLen) break;
    slug = candidate;
  }
  return slug || words[0]?.slice(0, maxLen) || 'memory';
}

export function makeId(text: string, createdIso: string, taken: (id: string) => boolean): string {
  const date = createdIso.slice(0, 10).replace(/-/g, '');
  const base = `${date}-${slugify(text)}`;
  if (!taken(base)) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base}-${n}`;
    if (!taken(candidate)) return candidate;
  }
}

/** Duplicate detection ignores case and whitespace differences. */
export function bodyHash(body: string): string {
  const normalized = body.toLowerCase().replace(/\s+/g, ' ').trim();
  return createHash('sha1').update(normalized).digest('hex');
}

function asStringArray(value: unknown): string[] {
  const items = Array.isArray(value)
    ? value.map((v) => String(v))
    : typeof value === 'string'
      ? value.split(',')
      : [];
  return items.map((s) => s.trim().toLowerCase()).filter(Boolean);
}

function asIso(value: unknown, fallback: string): string {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString();
  if (typeof value === 'string') {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) return date.toISOString();
  }
  return fallback;
}

/**
 * Files are written by humans as well as by this tool, so parsing is forgiving:
 * missing or broken frontmatter degrades to sensible defaults, never to a crash.
 * A file a human wrote by hand defaults to `active` — writing it was the review.
 */
export function parseMemoryFile(id: string, raw: string, fallbackIso: string): Memory {
  let data: Record<string, unknown> = {};
  let body = raw;
  try {
    const parsed = matter(raw);
    data = parsed.data as Record<string, unknown>;
    body = parsed.content;
  } catch {
    // Broken YAML: treat the whole file as body.
  }
  const created = asIso(data.created, fallbackIso);
  return {
    id,
    type: MEMORY_TYPES.includes(data.type as MemoryType) ? (data.type as MemoryType) : 'fact',
    tags: asStringArray(data.tags),
    source: typeof data.source === 'string' && data.source.trim() ? data.source.trim() : 'unknown',
    status: MEMORY_STATUSES.includes(data.status as MemoryStatus)
      ? (data.status as MemoryStatus)
      : 'active',
    pinned: data.pinned === true,
    created,
    updated: asIso(data.updated, fallbackIso),
    lastConfirmed: asIso(data.last_confirmed, created),
    body: body.trim(),
  };
}

export function serializeMemory(memory: Memory): string {
  return matter.stringify(`\n${memory.body}\n`, {
    type: memory.type,
    tags: memory.tags,
    source: memory.source,
    status: memory.status,
    pinned: memory.pinned,
    created: memory.created,
    updated: memory.updated,
    last_confirmed: memory.lastConfirmed,
  });
}
