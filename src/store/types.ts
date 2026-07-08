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
  created: string;
  updated: string;
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
}

export interface UpdatePatch {
  text?: string;
  type?: MemoryType;
  tags?: string[];
  status?: MemoryStatus;
  pinned?: boolean;
}

export interface ListFilter {
  status?: MemoryStatus;
  type?: MemoryType;
  tag?: string;
  pinned?: boolean;
  limit?: number;
}

/** One atomic fact per memory; agents that try to dump essays get told no. */
export const MAX_BODY_BYTES = 10_000;

/** Ids double as filenames — this guard is what keeps traversal out of the vault. */
export const VALID_ID = /^[a-z0-9][a-z0-9-]*$/;
