import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

/** What the SessionStart hook runs. Matched by substring so absolute-path variants count too. */
export const SESSION_START_COMMAND = 'engram hook session-start';

export type InstallResult = 'installed' | 'already-installed' | 'removed' | 'not-installed';

interface HookEntry {
  type?: string;
  command?: string;
  [key: string]: unknown;
}

interface HookGroup {
  matcher?: string;
  hooks?: HookEntry[];
  [key: string]: unknown;
}

type Settings = Record<string, unknown> & {
  hooks?: Record<string, HookGroup[]>;
};

/**
 * Add the SessionStart hook to a Claude Code settings.json, touching nothing
 * else in the file. Idempotent: an existing engram hook (even one pointing at
 * an absolute engram path) means there is nothing to do.
 */
export function installClaudeCodeHook(settingsPath: string): InstallResult {
  const settings = readSettings(settingsPath);
  if (findOurs(settings).length > 0) return 'already-installed';
  const hooks = (settings.hooks ??= {});
  const groups = (hooks.SessionStart ??= []);
  groups.push({ hooks: [{ type: 'command', command: SESSION_START_COMMAND }] });
  writeSettings(settingsPath, settings);
  return 'installed';
}

/** Remove the hook and any containers left empty by its departure. */
export function removeClaudeCodeHook(settingsPath: string): InstallResult {
  const settings = readSettings(settingsPath);
  if (findOurs(settings).length === 0) return 'not-installed';
  const groups = settings.hooks?.SessionStart ?? [];
  for (const group of groups) {
    if (Array.isArray(group.hooks)) group.hooks = group.hooks.filter((h) => !isOurs(h));
  }
  const remaining = groups.filter((g) => (g.hooks?.length ?? 0) > 0);
  if (settings.hooks) {
    if (remaining.length > 0) settings.hooks.SessionStart = remaining;
    else delete settings.hooks.SessionStart;
    if (Object.keys(settings.hooks).length === 0) delete settings.hooks;
  }
  writeSettings(settingsPath, settings);
  return 'removed';
}

function isOurs(hook: HookEntry): boolean {
  return typeof hook.command === 'string' && hook.command.includes(SESSION_START_COMMAND);
}

function findOurs(settings: Settings): HookEntry[] {
  return (settings.hooks?.SessionStart ?? [])
    .flatMap((group) => group.hooks ?? [])
    .filter(isOurs);
}

function readSettings(path: string): Settings {
  if (!existsSync(path)) return {};
  const raw = readFileSync(path, 'utf8');
  if (!raw.trim()) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`${path} is not valid JSON — fix or move it, then re-run`);
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${path} does not hold a JSON object — fix or move it, then re-run`);
  }
  return parsed as Settings;
}

function writeSettings(path: string, settings: Settings): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(settings, null, 2)}\n`, 'utf8');
}
