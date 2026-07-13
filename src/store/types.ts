export const MEMORY_TYPES = ['fact', 'preference', 'project', 'person', 'reference'] as const;
export type MemoryType = (typeof MEMORY_TYPES)[number];

export const MEMORY_STATUSES = ['active', 'unreviewed', 'archived'] as const;
export type MemoryStatus = (typeof MEMORY_STATUSES)[number];

export interface Memory {
  /** Filename without `.md` — the file on disk is the source of truth. */
  id: string;
  type: MemoryType;
  tags: string[];
  /** Which tool wrote this memory (cli, ui, claude-code, cursor, …). */
  source: string;
  status: MemoryStatus;
  /** Pinned memories form the always-loadable core profile. Pinning is a human act. */
  pinned: boolean;
  /** Project/workspace this fact belongs to. Absent = globally true about the user. */
  scope?: string;
  created: string;
  updated: string;
  /** Last time the fact was re-affirmed as true (created, restated, confirmed, or approved). */
  lastConfirmed: string;
  /** Id of the memory this one corrects. Corrections chain; old versions are archived, never overwritten. */
  supersedes?: string;
  body: string;
}

export interface SearchHit extends Memory {
  snippet: string;
}

export interface CreateInput {
  text: string;
  type?: MemoryType;
  tags?: string[];
  source: string;
  status?: MemoryStatus;
  pinned?: boolean;
  scope?: string;
}

export interface UpdatePatch {
  text?: string;
  type?: MemoryType;
  tags?: string[];
  status?: MemoryStatus;
  pinned?: boolean;
  /** New scope; `null` clears it (makes the memory global). */
  scope?: string | null;
}

export interface ListFilter {
  status?: MemoryStatus;
  type?: MemoryType;
  tag?: string;
  pinned?: boolean;
  /** Exact scope match. */
  scope?: string;
  limit?: number;
}

/** One atomic fact per memory; agents that try to dump essays get told no. */
export const MAX_BODY_BYTES = 10_000;

/** Ids double as filenames — this guard is what keeps traversal out of the vault. */
export const VALID_ID = /^[a-z0-9][a-z0-9-]*$/;
