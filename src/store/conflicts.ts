import type { Memory } from './types.js';

/**
 * Contradiction detection is a heuristic, not NLP: two short facts that share
 * most of their informative words probably describe the same thing, and if the
 * bodies differ (exact duplicates are caught earlier by hash) one of them may
 * be wrong. We surface "possibly conflicts with" and let the agent or the
 * human reviewer judge — a false positive costs one glance, a silent
 * contradiction costs a wrong answer months later.
 */

/** English glue words that carry no topic signal. */
const STOPWORDS = new Set([
  'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'to', 'of', 'in', 'on', 'at', 'for', 'with', 'and', 'or', 'but', 'not', 'no',
  'it', 'its', 'this', 'that', 'these', 'those', 'there',
  'i', 'he', 'she', 'they', 'we', 'you', 'my', 'his', 'her', 'their', 'our', 'your',
  'as', 'by', 'from', 'has', 'have', 'had', 'do', 'does', 'did',
  'will', 'would', 'should', 'shall', 'can', 'could', 'may', 'might', 'must',
  'about', 'into', 'over', 'under', 'up', 'down', 'out', 'so', 'if', 'then', 'than',
]);

const MAX_TOKENS = 40;

/** Informative-word fingerprint of a fact. */
export function tokenSet(body: string): Set<string> {
  const tokens = body.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  const set = new Set<string>();
  for (const token of tokens) {
    if (token.length < 2 || STOPWORDS.has(token)) continue;
    set.add(token);
    if (set.size >= MAX_TOKENS) break;
  }
  return set;
}

/** Overlap coefficient: |A ∩ B| / min(|A|, |B|). 1 means one fact's words are a subset of the other's. */
export function overlapScore(a: Set<string>, b: Set<string>): number {
  const smaller = a.size <= b.size ? a : b;
  const larger = a.size <= b.size ? b : a;
  if (smaller.size === 0) return 0;
  let shared = 0;
  for (const token of smaller) if (larger.has(token)) shared++;
  return shared / smaller.size;
}

/** Past this overlap, two different bodies are close enough to smell like a contradiction. */
const CONFLICT_THRESHOLD = 0.5;

export function isPotentialConflict(a: Set<string>, b: Set<string>): boolean {
  if (a.size < 2 || b.size < 2) return false; // one-word facts match everything
  return overlapScore(a, b) >= CONFLICT_THRESHOLD;
}

/**
 * A scoped fact can conflict with a global one or a same-scope one; two facts
 * scoped to different projects legitimately coexist ("standup is at 10" can be
 * true in one repo and false in another).
 */
export function scopesCanConflict(a: Memory['scope'], b: Memory['scope']): boolean {
  return a === undefined || b === undefined || a === b;
}
