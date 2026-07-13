import { useEffect, useState, type ReactNode } from 'react';
import { shortDate, staleMonths, useApp } from './lib';
import type { Memory, UiMemory } from './types';

// ---------- badges ----------

export function StatusDot({ status }: { status: Memory['status'] }) {
  return <span className={`dot dot-${status}`} title={status} />;
}

export function MemoryBadges({ memory }: { memory: Memory }) {
  const stale = staleMonths(memory);
  return (
    <>
      <span className="badge badge-type">{memory.type}</span>
      {memory.scope && <span className="badge badge-scope">@{memory.scope}</span>}
      {memory.tags.map((tag) => (
        <span key={tag} className="badge badge-tag">
          #{tag}
        </span>
      ))}
      {memory.pinned && (
        <span className="badge badge-pin" title="Pinned into the profile every AI loads">
          ★ pinned
        </span>
      )}
      {memory.status === 'unreviewed' && <span className="badge badge-unreviewed">unreviewed</span>}
      {memory.status === 'archived' && <span className="badge badge-archived">archived</span>}
      {memory.supersedes && (
        <span className="badge badge-supersedes" title={`Corrects ${memory.supersedes}`}>
          ⇒ correction
        </span>
      )}
      {stale !== null && (
        <span className="badge badge-stale" title={`Not confirmed in ${stale} months`}>
          ⚠ stale {stale}mo
        </span>
      )}
    </>
  );
}

// ---------- memory card ----------

export function MemoryCard({
  memory,
  onOpen,
  selected,
  onToggleSelect,
  actions,
}: {
  memory: UiMemory;
  onOpen?: (id: string) => void;
  selected?: boolean;
  onToggleSelect?: (id: string) => void;
  actions?: ReactNode;
}) {
  return (
    <article className={`card${selected ? ' card-selected' : ''}`}>
      <div className="card-head">
        {onToggleSelect && (
          <input
            type="checkbox"
            checked={selected ?? false}
            onChange={() => onToggleSelect(memory.id)}
            aria-label={`Select ${memory.id}`}
          />
        )}
        <StatusDot status={memory.status} />
        <button className="card-id" onClick={() => onOpen?.(memory.id)} title="Open details">
          {memory.id}
        </button>
        <MemoryBadges memory={memory} />
        <span className="card-meta">
          {memory.source} · {shortDate(memory.updated)}
        </span>
      </div>
      <p className="card-body" onClick={() => onOpen?.(memory.id)}>
        {memory.body}
      </p>
      {memory.conflicts && memory.conflicts.length > 0 && (
        <div className="conflicts">
          {memory.conflicts.map((conflict) => (
            <div key={conflict.id} className="conflict-row">
              ⚔️ possibly conflicts with{' '}
              <button className="link" onClick={() => onOpen?.(conflict.id)}>
                {conflict.id}
              </button>
              : <em>{conflict.body}</em>
            </div>
          ))}
        </div>
      )}
      {actions && <div className="card-actions">{actions}</div>}
    </article>
  );
}

// ---------- modal + drawer ----------

export function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  useEscape(onClose);
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-label={title}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="ghost" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Drawer({ onClose, children }: { onClose: () => void; children: ReactNode }) {
  useEscape(onClose);
  return (
    <div className="overlay overlay-right" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="drawer" role="dialog">
        <button className="ghost drawer-close" onClick={onClose} aria-label="Close">
          ✕
        </button>
        {children}
      </div>
    </div>
  );
}

function useEscape(onClose: () => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
}

/** Destructive button that asks for a second click instead of a dialog. */
export function DangerButton({
  label,
  confirmLabel,
  onConfirm,
}: {
  label: string;
  confirmLabel: string;
  onConfirm: () => void;
}) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const timer = window.setTimeout(() => setArmed(false), 3000);
    return () => window.clearTimeout(timer);
  }, [armed]);
  return (
    <button
      className={`danger${armed ? ' danger-armed' : ''}`}
      onClick={() => (armed ? onConfirm() : setArmed(true))}
    >
      {armed ? confirmLabel : label}
    </button>
  );
}

// ---------- toasts ----------

export function Toasts() {
  const { toasts, dismissToast } = useApp();
  if (toasts.length === 0) return null;
  return (
    <div className="toasts">
      {toasts.map((t) => (
        <div key={t.id} className={`toast toast-${t.kind}`}>
          <span>{t.message}</span>
          {t.undo && (
            <button
              className="link"
              onClick={() => {
                t.undo?.();
                dismissToast(t.id);
              }}
            >
              undo
            </button>
          )}
          <button className="ghost" onClick={() => dismissToast(t.id)} aria-label="Dismiss">
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}

export function EmptyState({ icon, title, hint }: { icon: string; title: string; hint?: string }) {
  return (
    <div className="empty">
      <div className="empty-icon">{icon}</div>
      <div className="empty-title">{title}</div>
      {hint && <div className="empty-hint">{hint}</div>}
    </div>
  );
}
