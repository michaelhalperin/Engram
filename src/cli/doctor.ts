import { accessSync, constants } from 'node:fs';
import { Store } from '../store/store.js';
import { bold, dim, green, red, yellow } from './format.js';

const ok = (msg: string) => console.log(`${green('✓')} ${msg}`);
const warn = (msg: string) => console.log(`${yellow('!')} ${msg}`);
const bad = (msg: string) => console.log(`${red('✗')} ${msg}`);

export function runDoctor(home: string): void {
  let failures = 0;

  const [major, minor] = process.versions.node.split('.').map(Number);
  if (major > 22 || (major === 22 && minor >= 5)) {
    ok(`node ${process.versions.node} (>= 22.5 with built-in SQLite)`);
  } else {
    bad(`node ${process.versions.node} — engram needs >= 22.5 for node:sqlite`);
    failures++;
  }

  let store: Store;
  try {
    store = new Store(home);
    ok(`data dir ${store.home}`);
  } catch (err) {
    bad(`cannot open data dir ${home}: ${(err as Error).message}`);
    process.exit(1);
  }

  try {
    accessSync(store.memoriesDir, constants.W_OK);
    ok('memories dir is writable');
  } catch {
    bad(`memories dir is not writable: ${store.memoriesDir}`);
    failures++;
  }

  const integrity = store.integrityCheck();
  if (integrity === 'ok') {
    ok('index database integrity ok');
  } else {
    warn(`index database reports: ${integrity} — run \`engram reindex\` to rebuild`);
  }

  const syncResult = store.sync();
  if (syncResult.errors.length === 0) {
    ok('all memory files parse cleanly');
  } else {
    for (const error of syncResult.errors) warn(`unparseable memory file: ${error}`);
  }

  const counts = store.counts();
  ok(
    `${counts.active} active, ${counts.unreviewed} unreviewed, ${counts.archived} archived, ${counts.pinned} pinned`,
  );
  if (counts.unreviewed > 0) {
    warn(`${counts.unreviewed} memories await review — run ${bold('engram review')}`);
  }

  const probe = store.search('engram-doctor-self-test', { limit: 1 });
  if (Array.isArray(probe)) ok('full-text search (FTS5) works');

  store.close();
  console.log();
  if (failures === 0) {
    console.log(green(bold('engram is healthy')));
  } else {
    console.log(red(bold(`${failures} problem(s) found`)));
    process.exitCode = 1;
  }
  console.log(dim(`data lives in ${store.home} — plain markdown, yours to grep, edit, and sync`));
}
