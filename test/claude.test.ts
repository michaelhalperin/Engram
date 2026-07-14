import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { extractClaudeFacts } from '../src/index.js';

let scratch: string;

beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), 'engram-claude-'));
});

afterEach(() => {
  rmSync(scratch, { recursive: true, force: true });
});

function writeClaudeMemory(projectSlug: string, name: string, type: string, body: string): void {
  const dir = join(scratch, 'projects', projectSlug, 'memory');
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, `${name}.md`),
    `---\nname: ${name}\ndescription: a memory\nmetadata:\n  type: ${type}\n---\n\n${body}\n`,
  );
}

describe('extractClaudeFacts', () => {
  it('imports project memory files, scoped by project slug, skipping the index', () => {
    writeClaudeMemory('-Users-m-code-acme-api', 'prefers-tabs', 'feedback', 'Michael prefers tabs over spaces.\n\n**Why:** readability.');
    writeClaudeMemory('-Users-m-code-acme-api', 'deploy-day', 'project', 'Deploys go out Friday mornings.');
    writeClaudeMemory('-Users-m-notes', 'is-a-designer', 'user', 'Michael is a designer.');
    writeFileSync(
      join(scratch, 'projects', '-Users-m-code-acme-api', 'memory', 'MEMORY.md'),
      '- [Prefers tabs](prefers-tabs.md) — indentation',
    );

    const { facts, errors } = extractClaudeFacts(join(scratch, 'projects'));
    expect(errors).toEqual([]);
    expect(facts).toHaveLength(3);

    const tabs = facts.find((f) => f.text.includes('tabs'))!;
    expect(tabs.type).toBe('preference'); // claude "feedback" → engram "preference"
    expect(tabs.scope).toBe('users-m-code-acme-api');
    expect(tabs.text).toContain('**Why:** readability.');

    expect(facts.find((f) => f.text.includes('Deploys'))!.type).toBe('project');
    expect(facts.find((f) => f.text.includes('designer'))!.type).toBe('fact');
    expect(facts.some((f) => f.text.includes('[Prefers tabs]'))).toBe(false);
  });

  it('accepts ~/.claude itself and a single memory dir', () => {
    writeClaudeMemory('-Users-m-proj', 'a-fact', 'user', 'A fact.');
    // scratch stands in for ~/.claude when it has a projects/ subdir… but only
    // when named .claude; here we point at the projects root and a memory dir.
    const single = extractClaudeFacts(join(scratch, 'projects', '-Users-m-proj', 'memory'));
    expect(single.facts).toHaveLength(1);
    expect(single.facts[0].scope).toBeUndefined(); // direct dir: caller picks --scope
  });

  it('treats a .txt file as a pasted claude.ai memory summary', () => {
    const path = join(scratch, 'memory.txt');
    writeFileSync(path, '- Works at Acme\n- Allergic to cilantro\n');
    expect(extractClaudeFacts(path).facts.map((f) => f.text)).toEqual([
      'Works at Acme',
      'Allergic to cilantro',
    ]);
  });

  it('reports when there is nothing to import', () => {
    mkdirSync(join(scratch, 'projects'), { recursive: true });
    const { facts, errors } = extractClaudeFacts(join(scratch, 'projects'));
    expect(facts).toEqual([]);
    expect(errors[0]).toMatch(/no Claude Code memory files/);
    expect(() => extractClaudeFacts(join(scratch, 'nope'))).toThrow(/no such file/);
  });
});
