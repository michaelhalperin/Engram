import type { Memory, SearchHit } from '../store/types.js';

const useColor = process.stdout.isTTY === true && !process.env.NO_COLOR;

const style =
  (open: number, close: number) =>
  (text: string): string =>
    useColor ? `\u001b[${open}m${text}\u001b[${close}m` : text;

export const bold = style(1, 22);
export const dim = style(2, 22);
export const red = style(31, 39);
export const green = style(32, 39);
export const yellow = style(33, 39);
export const cyan = style(36, 39);

const STATUS_MARK: Record<Memory['status'], string> = {
  active: green('●'),
  unreviewed: yellow('◐'),
  archived: dim('○'),
};

export function memoryHeader(memory: Memory): string {
  const parts = [
    STATUS_MARK[memory.status],
    bold(memory.id),
    cyan(memory.type),
  ];
  if (memory.pinned) parts.push(yellow('★'));
  if (memory.tags.length > 0) parts.push(dim(memory.tags.map((t) => `#${t}`).join(' ')));
  parts.push(dim(`(${memory.source}, ${memory.updated.slice(0, 10)})`));
  return parts.join('  ');
}

export function memoryCard(memory: Memory | SearchHit): string {
  const body = 'snippet' in memory && memory.snippet ? memory.snippet : memory.body;
  const indented = body
    .split('\n')
    .map((line) => `  ${line}`)
    .join('\n');
  return `${memoryHeader(memory)}\n${indented}`;
}

export function printMemories(memories: Array<Memory | SearchHit>): void {
  if (memories.length === 0) {
    console.log(dim('no memories found'));
    return;
  }
  console.log(memories.map(memoryCard).join('\n\n'));
}

export function fail(message: string): never {
  console.error(red(`error: ${message}`));
  process.exit(1);
}
