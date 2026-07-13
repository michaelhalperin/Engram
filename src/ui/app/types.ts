// Single source of truth: the UI reuses the store's own type definitions.
import type { Facets, Memory, MemoryStatus, MemoryType } from '../../store/types';

export { MEMORY_STATUSES, MEMORY_TYPES, STALE_AFTER_DAYS } from '../../store/types';
export type { Facets, Memory, MemoryStatus, MemoryType };

/** A memory as the API returns it: search adds a snippet, the inbox adds conflicts. */
export type UiMemory = Memory & { snippet?: string; conflicts?: Memory[] };

export interface Counts {
  active: number;
  unreviewed: number;
  archived: number;
  pinned: number;
}

export interface StateResponse {
  counts: Counts;
  stale: number;
  facets: Facets;
  inbox: UiMemory[];
  memories: UiMemory[];
}

export interface DetailResponse {
  memory: Memory;
  history: Memory[];
  conflicts: Memory[];
}

export interface StateQuery {
  query?: string;
  status?: string;
  type?: string;
  scope?: string;
  tag?: string;
  pinned?: boolean;
}
