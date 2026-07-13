import { useEffect, useRef, useState } from 'react';
import { getState } from '../api';
import { EmptyState, MemoryCard } from '../components';
import { useApp } from '../lib';
import { MEMORY_STATUSES, MEMORY_TYPES, type StateQuery, type UiMemory } from '../types';

/** Filters arrive from the hash too (#/memories?scope=acme), so scope chips can deep-link. */
function initialFilters(): StateQuery {
  const query = window.location.hash.split('?')[1];
  if (!query) return {};
  const params = new URLSearchParams(query);
  return {
    scope: params.get('scope') ?? undefined,
    tag: params.get('tag') ?? undefined,
    type: params.get('type') ?? undefined,
    status: params.get('status') ?? undefined,
  };
}

export function Memories({ onOpen }: { onOpen: (id: string) => void }) {
  const { state } = useApp();
  const [filters, setFilters] = useState<StateQuery>(initialFilters);
  const [results, setResults] = useState<UiMemory[] | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const requestSeq = useRef(0);

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
  }, [filters]);

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
  const facets = state?.facets;
  const memories = results ?? state?.memories ?? [];

  return (
    <div>
      <div className="view-head">
        <h1>Memories</h1>
        <p className="muted">Search and filter everything your AIs — and you — have saved.</p>
      </div>

      <div className="filter-bar">
        <input
          ref={searchRef}
          type="search"
          placeholder="Search memories…  ( / )"
          value={filters.query ?? ''}
          onChange={(e) => set({ query: e.target.value || undefined })}
        />
        <select value={filters.status ?? ''} onChange={(e) => set({ status: e.target.value || undefined })}>
          <option value="">any status</option>
          {MEMORY_STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <select value={filters.type ?? ''} onChange={(e) => set({ type: e.target.value || undefined })}>
          <option value="">any type</option>
          {MEMORY_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <select value={filters.scope ?? ''} onChange={(e) => set({ scope: e.target.value || undefined })}>
          <option value="">any scope</option>
          {Object.keys(facets?.scopes ?? {}).sort().map((s) => (
            <option key={s} value={s}>
              @{s}
            </option>
          ))}
        </select>
        <select value={filters.tag ?? ''} onChange={(e) => set({ tag: e.target.value || undefined })}>
          <option value="">any tag</option>
          {Object.keys(facets?.tags ?? {}).sort().map((t) => (
            <option key={t} value={t}>
              #{t}
            </option>
          ))}
        </select>
        <label className="check">
          <input
            type="checkbox"
            checked={filters.pinned ?? false}
            onChange={(e) => set({ pinned: e.target.checked || undefined })}
          />
          ★ pinned
        </label>
      </div>

      {memories.length === 0 ? (
        <EmptyState icon="🔍" title="Nothing matches" hint="Try broader words or clear a filter." />
      ) : (
        memories.map((memory) => <MemoryCard key={memory.id} memory={memory} onOpen={onOpen} />)
      )}
    </div>
  );
}
