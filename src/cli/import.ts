import type { Store } from '../store/store.js';
import { importFacts, type Extraction, type ImportOptions } from '../import/core.js';
import { dim, green, yellow } from './format.js';

const PREVIEW_LIMIT = 15;

/** Run an extraction through the store and narrate the outcome. */
export function runImport(store: Store, extraction: Extraction, opts: ImportOptions): void {
  for (const error of extraction.errors) console.log(yellow(`skipped ${error}`));
  if (extraction.facts.length === 0) {
    console.log(dim('nothing to import'));
    return;
  }

  const report = importFacts(store, extraction.facts, opts);

  if (opts.dryRun) {
    for (const fact of report.planned.slice(0, PREVIEW_LIMIT)) {
      console.log(`  ${oneLine(fact.text)}`);
    }
    if (report.planned.length > PREVIEW_LIMIT) {
      console.log(dim(`  … and ${report.planned.length - PREVIEW_LIMIT} more`));
    }
    console.log(
      `${yellow('dry run:')} would import ${report.planned.length} ${plural(report.planned.length, 'fact')}` +
        skippedSuffix(report.duplicates),
    );
    return;
  }

  for (const { text, error } of report.errors) console.log(yellow(`refused "${text}": ${error}`));
  for (const { added, existing } of report.conflicts.slice(0, PREVIEW_LIMIT)) {
    console.log(yellow(`⚠ ${added.id} possibly conflicts with ${existing.id}: ${oneLine(existing.body)}`));
  }
  if (report.conflicts.length > PREVIEW_LIMIT) {
    console.log(yellow(`⚠ … and ${report.conflicts.length - PREVIEW_LIMIT} more possible conflicts`));
  }
  console.log(
    `${green('imported')} ${report.added.length} ${plural(report.added.length, 'fact')} as unreviewed` +
      skippedSuffix(report.duplicates) +
      (report.errors.length > 0 ? dim(` · ${report.errors.length} refused`) : ''),
  );
  if (report.added.length > 0) {
    console.log(dim('triage them with `engram review` (or the inbox in `engram ui`)'));
  }
}

function skippedSuffix(duplicates: number): string {
  return duplicates > 0 ? dim(` · ${duplicates} already known`) : '';
}

function plural(n: number, word: string): string {
  return n === 1 ? word : `${word}s`;
}

function oneLine(text: string, max = 80): string {
  const flat = text.replace(/\s+/g, ' ');
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}
