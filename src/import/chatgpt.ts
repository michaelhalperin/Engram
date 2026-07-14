import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { Extraction, ImportedFact } from './core.js';
import { parseFactLines } from './text.js';
import { unzipEntry } from './zip.js';

/**
 * ChatGPT does not export its memory as a tidy list, but every write to it is
 * on the record: when the model saves a memory it sends a message to its `bio`
 * tool, and those messages are all in the data export's conversations.json.
 * We collect exactly those. Duplicate saves collapse via the store's body
 * dedupe; contradictory ones surface as conflicts in review.
 *
 * A pasted "Settings → Personalization → Manage memories" list works too —
 * pass it as a .txt/.md file, one memory per line.
 */
export function extractChatgptFacts(path: string): Extraction {
  if (!existsSync(path)) throw new Error(`no such file or directory: ${path}`);
  if (statSync(path).isDirectory()) {
    const conversations = join(path, 'conversations.json');
    if (!existsSync(conversations)) {
      throw new Error(`no conversations.json in ${path} — point at the unzipped ChatGPT data export`);
    }
    return parseConversations(readFileSync(conversations, 'utf8'));
  }
  if (path.endsWith('.zip')) {
    const entry = unzipEntry(readFileSync(path), (name) => name.endsWith('conversations.json'));
    if (!entry) throw new Error('no conversations.json in the zip — is this a ChatGPT data export?');
    return parseConversations(entry.data.toString('utf8'));
  }
  if (path.endsWith('.json')) return parseConversations(readFileSync(path, 'utf8'));
  return {
    facts: parseFactLines(readFileSync(path, 'utf8')).map((text) => ({ text })),
    errors: [],
  };
}

interface BioMessage {
  author?: { role?: string };
  recipient?: string;
  content?: { parts?: unknown[] };
  create_time?: number;
}

function parseConversations(raw: string): Extraction {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error('conversations.json is not valid JSON');
  }
  if (!Array.isArray(data)) {
    throw new Error('conversations.json has an unexpected shape (expected an array of conversations)');
  }
  const extraction: Extraction = { facts: [], errors: [] };
  for (const conversation of data) {
    const mapping = (conversation as { mapping?: unknown })?.mapping;
    if (!mapping || typeof mapping !== 'object') continue;
    for (const node of Object.values(mapping)) {
      const fact = bioWrite((node as { message?: BioMessage })?.message);
      if (fact) extraction.facts.push(fact);
    }
  }
  extraction.facts.sort((a, b) => (a.created ?? '').localeCompare(b.created ?? ''));
  if (extraction.facts.length === 0) {
    extraction.errors.push(
      'export: no memory writes found (ChatGPT records them as messages to its `bio` tool; this export has none)',
    );
  }
  return extraction;
}

function bioWrite(message: BioMessage | undefined): ImportedFact | undefined {
  if (!message || message.recipient !== 'bio' || message.author?.role !== 'assistant') return undefined;
  const parts = message.content?.parts;
  if (!Array.isArray(parts)) return undefined;
  const text = parts
    .filter((part): part is string => typeof part === 'string')
    .join('\n')
    .trim();
  if (!text) return undefined;
  const seconds = message.create_time;
  return {
    text,
    created:
      typeof seconds === 'number' && seconds > 0 ? new Date(seconds * 1000).toISOString() : undefined,
  };
}
