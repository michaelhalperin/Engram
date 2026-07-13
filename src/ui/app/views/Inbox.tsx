import { useEffect, useState } from 'react';
import { reviewAction, reviewBulk } from '../api';
import { EmptyState, MemoryCard } from '../components';
import { plural, useApp } from '../lib';

/**
 * The audit ritual, keyboard first: j/k to move, a approve, r reject,
 * e open the editor, x toggle selection for bulk actions.
 */
export function Inbox({ onOpen }: { onOpen: (id: string) => void }) {
  const { state, refresh, toast } = useApp();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [cursor, setCursor] = useState(0);
  const inbox = state?.inbox ?? [];

  const act = async (id: string, action: 'approve' | 'reject') => {
    try {
      const { restored } = await reviewAction(id, action);
      toast(
        action === 'approve' ? `approved ${id}` : `rejected ${id}${restored ? ` — restored ${restored.id}` : ''}`,
        action === 'approve' ? 'ok' : 'warn',
      );
      setSelected((s) => {
        const next = new Set(s);
        next.delete(id);
        return next;
      });
      await refresh();
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  };

  const bulk = async (action: 'approve' | 'reject') => {
    const ids = selected.size > 0 ? [...selected] : inbox.map((m) => m.id);
    try {
      const { results } = await reviewBulk(action, ids);
      const ok = results.filter((r) => r.ok).length;
      toast(`${action === 'approve' ? 'approved' : 'rejected'} ${plural(ok, 'memory')}`, action === 'approve' ? 'ok' : 'warn');
      setSelected(new Set());
      await refresh();
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      const current = inbox[cursor];
      if (e.key === 'j') setCursor((c) => Math.min(c + 1, inbox.length - 1));
      else if (e.key === 'k') setCursor((c) => Math.max(c - 1, 0));
      else if (e.key === 'a' && current) void act(current.id, 'approve');
      else if (e.key === 'r' && current) void act(current.id, 'reject');
      else if (e.key === 'e' && current) onOpen(current.id);
      else if (e.key === 'x' && current) toggle(current.id);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inbox, cursor]);

  useEffect(() => {
    setCursor((c) => Math.min(c, Math.max(0, inbox.length - 1)));
  }, [inbox.length]);

  const toggle = (id: string) =>
    setSelected((s) => {
      const next = new Set(s);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  return (
    <div>
      <div className="view-head">
        <h1>Review inbox</h1>
        <p className="muted">
          What your AIs want you to keep. Nothing here is trusted until you rule on it.{' '}
          <span className="kbd-hint">
            <kbd>j</kbd>/<kbd>k</kbd> move · <kbd>a</kbd> approve · <kbd>r</kbd> reject · <kbd>e</kbd> edit ·{' '}
            <kbd>x</kbd> select
          </span>
        </p>
      </div>

      {inbox.length > 0 && (
        <div className="bulk-bar">
          <span className="muted">
            {selected.size > 0 ? `${selected.size} selected` : `${plural(inbox.length, 'memory')} pending`}
          </span>
          <button className="approve" onClick={() => bulk('approve')}>
            ✓ approve {selected.size > 0 ? 'selected' : 'all'}
          </button>
          <button className="reject" onClick={() => bulk('reject')}>
            ✗ reject {selected.size > 0 ? 'selected' : 'all'}
          </button>
        </div>
      )}

      {inbox.length === 0 ? (
        <EmptyState icon="✅" title="Inbox zero" hint="Nothing your AIs wrote awaits approval." />
      ) : (
        inbox.map((memory, index) => (
          <div key={memory.id} className={index === cursor ? 'cursor-row' : ''}>
            <MemoryCard
              memory={memory}
              onOpen={onOpen}
              selected={selected.has(memory.id)}
              onToggleSelect={toggle}
              actions={
                <>
                  <button className="approve" onClick={() => act(memory.id, 'approve')}>
                    ✓ approve
                  </button>
                  <button onClick={() => onOpen(memory.id)}>✎ edit</button>
                  <button className="reject" onClick={() => act(memory.id, 'reject')}>
                    ✗ reject
                  </button>
                </>
              }
            />
          </div>
        ))
      )}
    </div>
  );
}
