import type { Store } from '../store/store.js';
import type { Memory, MemoryType } from '../store/types.js';

/** A fact extracted from an external source, ready to become a memory. */
export interface ImportedFact {
  text: string;
  type?: MemoryType;
  tags?: string[];
  scope?: string;
  /** When the source tool recorded the fact, if known. */
  created?: string;
}

/** What an extractor pulled out of an export, before anything is written. */
export interface Extraction {
  facts: ImportedFact[];
  /** Inputs that could not be parsed (file, entry, …) with why. */
  errors: string[];
}

export interface ImportOptions {
  /** Provenance label, e.g. `import:chatgpt`. Shows up in review and on every card. */
  source: string;
  /** Scope every fact into this project (overrides per-fact scopes). */
  scope?: string;
  /** Extra tags added to every fact. */
  tags?: string[];
  /** Type override for every fact. */
  type?: MemoryType;
  /** Report what would happen; write nothing. */
  dryRun?: boolean;
}

export interface ImportReport {
  /** Newly created memories, in import order. Empty on a dry run. */
  added: Memory[];
  /** Facts that would be added — only populated on a dry run. */
  planned: ImportedFact[];
  /** Facts already in the vault (matched by normalized body) and skipped. */
  duplicates: number;
  /** Facts the store refused, with why. */
  errors: Array<{ text: string; error: string }>;
  /** New memories that plausibly contradict an existing one. */
  conflicts: Array<{ added: Memory; existing: Memory }>;
}

/**
 * Bulk-write extracted facts into the vault. Everything lands `unreviewed` and
 * attributed to the importer — the review inbox triages an import exactly like
 * it triages agent writes. Re-running an import is safe: facts are matched by
 * normalized body, so anything already known is skipped, not duplicated.
 */
export function importFacts(store: Store, facts: ImportedFact[], opts: ImportOptions): ImportReport {
  const report: ImportReport = { added: [], planned: [], duplicates: 0, errors: [], conflicts: [] };
  const plannedBodies = new Set<string>();
  for (const fact of facts) {
    const text = fact.text.trim();
    if (!text) continue;
    const input = {
      text,
      type: opts.type ?? fact.type,
      tags: [...(fact.tags ?? []), ...(opts.tags ?? [])],
      scope: opts.scope ?? fact.scope,
      source: opts.source,
      status: 'unreviewed' as const,
      created: fact.created,
    };
    if (opts.dryRun) {
      const normalized = text.toLowerCase().replace(/\s+/g, ' ');
      if (store.findDuplicate(text) || plannedBodies.has(normalized)) {
        report.duplicates++;
      } else {
        plannedBodies.add(normalized);
        report.planned.push({ ...fact, text });
      }
      continue;
    }
    try {
      const { memory, existing } = store.create(input);
      if (existing) {
        report.duplicates++;
        continue;
      }
      report.added.push(memory);
      const conflict = store.findConflicts(memory, 1)[0];
      if (conflict) report.conflicts.push({ added: memory, existing: conflict });
    } catch (err) {
      report.errors.push({ text: truncate(text), error: (err as Error).message });
    }
  }
  return report;
}

function truncate(text: string, max = 80): string {
  const oneLine = text.replace(/\s+/g, ' ');
  return oneLine.length > max ? `${oneLine.slice(0, max - 1)}…` : oneLine;
}
