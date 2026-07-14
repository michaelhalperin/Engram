import { useEffect, useState, type ReactNode } from 'react';
import { reviewAction, reviewBulk } from '../api';
import { EmptyState, MemoryCard, PageHeader, ShortcutLegend } from '../components';
import { plural, useApp } from '../lib';
import type { UiMemory } from '../types';

function ConflictPair({
  memory,
  onOpen,
  selected,
  onToggleSelect,
  actions,
  highlighted,
}: {
  memory: UiMemory;
  onOpen: (id: string) => void;
  selected: boolean;
  onToggleSelect: (id: string) => void;
  actions: ReactNode;
  highlighted: boolean;
}) {
  const conflict = memory.conflicts?.[0];
  if (!conflict) {
    return (
      <div className={highlighted ? 'v-cursor' : undefined}>
        <MemoryCard
          memory={memory}
          onOpen={onOpen}
          selected={selected}
          onToggleSelect={onToggleSelect}
          actions={actions}
        />
      </div>
    );
  }

  return (
    <div className={`v-duel${highlighted ? ' v-duel-active' : ''}`}>
      <MemoryCard
        memory={memory}
        onOpen={onOpen}
        selected={selected}
        onToggleSelect={onToggleSelect}
        actions={actions}
        hideConflicts
      />
      <div className="v-duel-mid" aria-hidden="true">
        <span>vs</span>
      </div>
      <MemoryCard memory={conflict} onOpen={onOpen} />
    </div>
  );
}

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

  const cardActions = (id: string) => (
    <>
      <button className="v-btn v-btn-ok" onClick={() => act(id, 'approve')}>
        Approve
      </button>
      <button className="v-btn" onClick={() => onOpen(id)}>
        Edit
      </button>
      <button className="v-btn v-btn-no" onClick={() => act(id, 'reject')}>
        Reject
      </button>
    </>
  );

  return (
    <div className="v-view">
      <PageHeader
        title="Review inbox"
        subtitle="Agent writes land here first. Nothing is trusted until you approve or reject it."
      />

      <ShortcutLegend />

      {inbox.length > 0 && (
        <div className="v-bulk">
          <span className="v-muted">
            {selected.size > 0 ? `${selected.size} selected` : `${plural(inbox.length, 'memory')} pending`}
          </span>
          <button className="v-btn v-btn-ok" onClick={() => bulk('approve')}>
            Approve {selected.size > 0 ? 'selected' : 'all'}
          </button>
          <button className="v-btn v-btn-no" onClick={() => bulk('reject')}>
            Reject {selected.size > 0 ? 'selected' : 'all'}
          </button>
        </div>
      )}

      <div className="v-ledger">
        {inbox.length === 0 ? (
          <EmptyState title="Inbox zero" hint="Nothing your AIs wrote awaits approval." />
        ) : (
          inbox.map((memory, index) => (
            <ConflictPair
              key={memory.id}
              memory={memory}
              onOpen={onOpen}
              selected={selected.has(memory.id)}
              onToggleSelect={toggle}
              actions={cardActions(memory.id)}
              highlighted={index === cursor}
            />
          ))
        )}
      </div>
    </div>
  );
}
