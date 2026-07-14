import { useEffect, useMemo, useRef, useState } from 'react';
import { getState } from '../api';
import { EmptyState, FilterChips, MemoryCard, PageHeader } from '../components';
import { useApp } from '../lib';
import { MEMORY_STATUSES, MEMORY_TYPES, type StateQuery, type UiMemory } from '../types';

function initialFilters(): StateQuery {
  const query = window.location.hash.split('?')[1];
  if (!query) return {};
  const params = new URLSearchParams(query);
  return {
    scope: params.get('scope') ?? undefined,
    tag: params.get('tag') ?? undefined,
    type: params.get('type') ?? undefined,
    status: params.get('status') ?? undefined,
    pinned: params.get('pinned') === '1' ? true : undefined,
  };
}

function filterChips(filters: StateQuery): Array<{ key: string; label: string }> {
  const chips: Array<{ key: string; label: string }> = [];
  if (filters.query) chips.push({ key: 'query', label: `search: ${filters.query}` });
  if (filters.status) chips.push({ key: 'status', label: filters.status });
  if (filters.type) chips.push({ key: 'type', label: filters.type });
  if (filters.scope) chips.push({ key: 'scope', label: `@${filters.scope}` });
  if (filters.tag) chips.push({ key: 'tag', label: `#${filters.tag}` });
  if (filters.pinned) chips.push({ key: 'pinned', label: 'pinned' });
  return chips;
}

export function Memories({ onOpen }: { onOpen: (id: string) => void }) {
  const { state } = useApp();
  const [filters, setFilters] = useState<StateQuery>(initialFilters);
  const [results, setResults] = useState<UiMemory[] | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const requestSeq = useRef(0);

  // Re-fetch when filters change *or* when shared vault state refreshes after
  // create/archive/delete elsewhere — otherwise local `results` stay stale.
  useEffect(() => {
    const seq = ++requestSeq.current;
    const timer = window.setTimeout(
      async () => {
        try {
          const data = await getState(filters);
          if (seq === requestSeq.current) setResults(data.memories);
        } catch {
          if (seq === requestSeq.current) setResults([]);
        }
      },
      filters.query ? 150 : 0,
    );
    return () => window.clearTimeout(timer);
  }, [filters, state]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === '/' && !(e.target instanceof HTMLInputElement) && !(e.target instanceof HTMLTextAreaElement)) {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const set = (patch: Partial<StateQuery>) => setFilters((f) => ({ ...f, ...patch }));
  const removeFilter = (key: string) => set({ [key]: undefined } as Partial<StateQuery>);
  const facets = state?.facets;
  const memories = results ?? state?.memories ?? [];
  const chips = useMemo(() => filterChips(filters), [filters]);

  return (
    <div className="v-view">
      <PageHeader title="Memories" subtitle="Search and filter everything your AIs — and you — have saved." />

      <div className="v-filter-bar">
        <input
          ref={searchRef}
          className="v-input v-input-search"
          type="search"
          placeholder="Search memories…  ( / )"
          value={filters.query ?? ''}
          onChange={(e) => set({ query: e.target.value || undefined })}
          aria-label="Search memories"
        />
        <div className="v-filter-grid">
          <select
            className="v-input"
            value={filters.status ?? ''}
            onChange={(e) => set({ status: e.target.value || undefined })}
            aria-label="Filter by status"
          >
            <option value="">any status</option>
            {MEMORY_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <select
            className="v-input"
            value={filters.type ?? ''}
            onChange={(e) => set({ type: e.target.value || undefined })}
            aria-label="Filter by type"
          >
            <option value="">any type</option>
            {MEMORY_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          <select
            className="v-input"
            value={filters.scope ?? ''}
            onChange={(e) => set({ scope: e.target.value || undefined })}
            aria-label="Filter by scope"
          >
            <option value="">any scope</option>
            {Object.keys(facets?.scopes ?? {}).sort().map((s) => (
              <option key={s} value={s}>
                @{s}
              </option>
            ))}
          </select>
          <select
            className="v-input"
            value={filters.tag ?? ''}
            onChange={(e) => set({ tag: e.target.value || undefined })}
            aria-label="Filter by tag"
          >
            <option value="">any tag</option>
            {Object.keys(facets?.tags ?? {}).sort().map((t) => (
              <option key={t} value={t}>
                #{t}
              </option>
            ))}
          </select>
          <label className="v-check-label">
            <input
              type="checkbox"
              checked={filters.pinned ?? false}
              onChange={(e) => set({ pinned: e.target.checked || undefined })}
            />
            pinned only
          </label>
        </div>
      </div>

      <FilterChips filters={chips} onRemove={removeFilter} />

      <div className="v-result-meta">
        <span className="v-muted">{memories.length} records</span>
      </div>

      {memories.length === 0 ? (
        <EmptyState
          title="Nothing matches"
          hint={chips.length > 0 ? 'Try broader words or remove a filter.' : 'Add a memory or connect an AI tool.'}
        />
      ) : (
        <div className="v-memory-list">
          {memories.map((memory) => (
            <MemoryCard key={memory.id} memory={memory} onOpen={onOpen} />
          ))}
        </div>
      )}
    </div>
  );
}
