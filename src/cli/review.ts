import { spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import type { Store } from '../store/store.js';
import { bold, dim, green, memoryCard, printMemories, red, yellow } from './format.js';

/**
 * The audit ritual: everything an AI wrote lands here until a human rules on it.
 */
export async function runReview(store: Store): Promise<void> {
  const queue = store.list({ status: 'unreviewed', limit: 500 });
  if (queue.length === 0) {
    console.log(green('review inbox is empty — nothing your AIs wrote awaits approval'));
    return;
  }

  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    console.log(`${queue.length} unreviewed memor${queue.length === 1 ? 'y' : 'ies'}:\n`);
    printMemories(queue);
    console.log(dim('\nrun `engram review` in a terminal for interactive approval'));
    return;
  }

  console.log(
    `${bold(String(queue.length))} unreviewed memor${queue.length === 1 ? 'y' : 'ies'} — ` +
      `what your AIs want you to keep\n`,
  );

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  let approved = 0;
  let rejected = 0;
  let skipped = 0;

  try {
    for (const memory of queue) {
      console.log(`\n${memoryCard(memory)}`);
      const answer = (
        await rl.question(
          `${green('[a]')}pprove  ${yellow('[e]')}dit  ${red('[r]')}eject  [s]kip  [q]uit > `,
        )
      )
        .trim()
        .toLowerCase();

      if (answer === 'a') {
        store.approve(memory.id);
        approved++;
        console.log(green('approved'));
      } else if (answer === 'e') {
        const editor = process.env.EDITOR ?? process.env.VISUAL;
        if (!editor) {
          console.log(yellow(`$EDITOR is not set — edit directly: ${store.pathFor(memory.id)}`));
          skipped++;
          continue;
        }
        const result = spawnSync(editor, [store.pathFor(memory.id)], { stdio: 'inherit' });
        if (result.status === 0) {
          store.sync();
          store.approve(memory.id);
          approved++;
          console.log(green('edited and approved'));
        } else {
          skipped++;
          console.log(yellow('editor exited non-zero — skipped'));
        }
      } else if (answer === 'r') {
        const { restored } = store.reject(memory.id);
        rejected++;
        console.log(
          red(
            restored
              ? `rejected (archived — file kept) — restored ${restored.id}`
              : 'rejected (archived — file kept)',
          ),
        );
      } else if (answer === 'q') {
        skipped += queue.length - approved - rejected - skipped;
        break;
      } else {
        skipped++;
      }
    }
  } finally {
    rl.close();
  }

  console.log(
    `\n${green(`${approved} approved`)} · ${red(`${rejected} rejected`)} · ${dim(`${skipped} left for later`)}`,
  );
}
