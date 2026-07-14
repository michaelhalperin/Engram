import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  SESSION_START_COMMAND,
  installClaudeCodeHook,
  removeClaudeCodeHook,
} from '../src/cli/install.js';

let scratch: string;
let settingsPath: string;

beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), 'engram-install-'));
  settingsPath = join(scratch, '.claude', 'settings.json');
  mkdirSync(join(scratch, '.claude'));
});

afterEach(() => {
  rmSync(scratch, { recursive: true, force: true });
});

function settings(): Record<string, unknown> {
  return JSON.parse(readFileSync(settingsPath, 'utf8'));
}

describe('installClaudeCodeHook', () => {
  it('creates the settings file and hook from nothing', () => {
    expect(installClaudeCodeHook(settingsPath)).toBe('installed');
    expect(settings()).toEqual({
      hooks: {
        SessionStart: [{ hooks: [{ type: 'command', command: SESSION_START_COMMAND }] }],
      },
    });
  });

  it('is idempotent, even against an absolute-path variant of the command', () => {
    expect(installClaudeCodeHook(settingsPath)).toBe('installed');
    expect(installClaudeCodeHook(settingsPath)).toBe('already-installed');
    writeFileSync(
      settingsPath,
      JSON.stringify({
        hooks: {
          SessionStart: [
            { hooks: [{ type: 'command', command: '/opt/homebrew/bin/engram hook session-start' }] },
          ],
        },
      }),
    );
    expect(installClaudeCodeHook(settingsPath)).toBe('already-installed');
  });

  it('preserves everything else in the file', () => {
    writeFileSync(
      settingsPath,
      JSON.stringify({
        model: 'opus',
        permissions: { allow: ['Bash(npm test)'] },
        hooks: {
          PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'echo hi' }] }],
          SessionStart: [{ hooks: [{ type: 'command', command: 'other-tool --context' }] }],
        },
      }),
    );
    expect(installClaudeCodeHook(settingsPath)).toBe('installed');
    const result = settings() as {
      model: string;
      permissions: unknown;
      hooks: { PreToolUse: unknown[]; SessionStart: Array<{ hooks: Array<{ command: string }> }> };
    };
    expect(result.model).toBe('opus');
    expect(result.permissions).toEqual({ allow: ['Bash(npm test)'] });
    expect(result.hooks.PreToolUse).toHaveLength(1);
    expect(result.hooks.SessionStart).toHaveLength(2);
    expect(result.hooks.SessionStart[0].hooks[0].command).toBe('other-tool --context');
  });

  it('refuses to touch a file it cannot parse', () => {
    writeFileSync(settingsPath, '');
    expect(installClaudeCodeHook(settingsPath)).toBe('installed'); // empty file is fine
    writeFileSync(settingsPath, '{broken');
    expect(() => installClaudeCodeHook(settingsPath)).toThrow(/not valid JSON/);
    expect(readFileSync(settingsPath, 'utf8')).toBe('{broken'); // untouched
    writeFileSync(settingsPath, '[]');
    expect(() => installClaudeCodeHook(settingsPath)).toThrow(/JSON object/);
  });
});

describe('removeClaudeCodeHook', () => {
  it('removes the hook and any containers it leaves empty', () => {
    installClaudeCodeHook(settingsPath);
    expect(removeClaudeCodeHook(settingsPath)).toBe('removed');
    expect(settings()).toEqual({});
    expect(removeClaudeCodeHook(settingsPath)).toBe('not-installed');
  });

  it('leaves other hooks alone', () => {
    writeFileSync(
      settingsPath,
      JSON.stringify({
        hooks: {
          SessionStart: [
            {
              hooks: [
                { type: 'command', command: 'other-tool --context' },
                { type: 'command', command: SESSION_START_COMMAND },
              ],
            },
          ],
        },
      }),
    );
    expect(removeClaudeCodeHook(settingsPath)).toBe('removed');
    const result = settings() as { hooks: { SessionStart: Array<{ hooks: Array<{ command: string }> }> } };
    expect(result.hooks.SessionStart[0].hooks).toEqual([
      { type: 'command', command: 'other-tool --context' },
    ]);
  });
});
