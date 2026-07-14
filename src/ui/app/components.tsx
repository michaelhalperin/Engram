import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react';
import { shortDate, staleMonths, useApp } from './lib';
import type { Memory, UiMemory } from './types';

export type SelectOption = { value: string; label: string };

export function Select({
  value,
  options,
  onChange,
  'aria-label': ariaLabel,
  placeholder,
  className,
}: {
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  'aria-label': string;
  placeholder?: string;
  className?: string;
}) {
  const listId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(() =>
    Math.max(0, options.findIndex((o) => o.value === value)),
  );

  const selected = options.find((o) => o.value === value);
  const label = selected?.label ?? placeholder ?? 'Select…';
  const isEmpty = value === '';

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const idx = Math.max(0, options.findIndex((o) => o.value === value));
    setHighlight(idx);
    // Scroll the active option into view after paint.
    requestAnimationFrame(() => {
      const el = listRef.current?.querySelector<HTMLElement>('[data-active="true"]');
      el?.scrollIntoView({ block: 'nearest' });
    });
  }, [open, options, value]);

  const choose = (next: string) => {
    onChange(next);
    setOpen(false);
  };

  const move = (delta: number) => {
    setHighlight((h) => {
      const len = options.length;
      if (len === 0) return 0;
      return (h + delta + len) % len;
    });
  };

  const onTriggerKeyDown = (e: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!open) setOpen(true);
      else move(e.key === 'ArrowDown' ? 1 : -1);
      return;
    }
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (open) choose(options[highlight]?.value ?? value);
      else setOpen(true);
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
      return;
    }
    if (e.key === 'Home') {
      e.preventDefault();
      setHighlight(0);
      return;
    }
    if (e.key === 'End') {
      e.preventDefault();
      setHighlight(Math.max(0, options.length - 1));
    }
  };

  return (
    <div
      ref={rootRef}
      className={`v-select${open ? ' v-select-open' : ''}${className ? ` ${className}` : ''}`}
    >
      <button
        type="button"
        className={`v-select-trigger${isEmpty ? ' v-select-placeholder' : ''}`}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={onTriggerKeyDown}
      >
        <span className="v-select-value">{label}</span>
        <svg className="v-select-chevron" viewBox="0 0 12 12" aria-hidden="true">
          <path d="M2.5 4.25 L6 7.75 L9.5 4.25" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        <ul
          ref={listRef}
          id={listId}
          className="v-select-menu"
          role="listbox"
          aria-label={ariaLabel}
          tabIndex={-1}
        >
          {options.map((opt, i) => {
            const isSelected = opt.value === value;
            const isActive = i === highlight;
            return (
              <li
                key={`${opt.value}:${opt.label}`}
                role="option"
                aria-selected={isSelected}
                data-active={isActive || undefined}
                className={`v-select-option${isSelected ? ' v-select-option-selected' : ''}${
                  isActive ? ' v-select-option-active' : ''
                }`}
                onMouseEnter={() => setHighlight(i)}
                onMouseDown={(e) => {
                  e.preventDefault();
                  choose(opt.value);
                }}
              >
                <span>{opt.label}</span>
                {isSelected && (
                  <svg className="v-select-check" viewBox="0 0 12 12" aria-hidden="true">
                    <path d="M2 6.2 L4.8 9 L10 3.2" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export function Checkbox({
  checked,
  onChange,
  children,
  'aria-label': ariaLabel,
  className,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  children: ReactNode;
  'aria-label'?: string;
  className?: string;
}) {
  return (
    <label
      className={`v-check-control${checked ? ' v-check-control-on' : ''}${className ? ` ${className}` : ''}`}
    >
      <input
        type="checkbox"
        className="v-check-input"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        aria-label={ariaLabel}
      />
      <span className="v-check-box" aria-hidden="true">
        <svg viewBox="0 0 12 12">
          <path
            d="M2 6.2 L4.8 9 L10 3.2"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
      <span className="v-check-text">{children}</span>
    </label>
  );
}

export function StatusDot({ status }: { status: Memory['status'] }) {
  return <span className={`v-status v-status-${status}`} title={status} aria-hidden="true" />;
}

export function MemoryBadges({ memory }: { memory: Memory }) {
  const stale = staleMonths(memory);
  return (
    <>
      <span className="v-tag v-tag-type">{memory.type}</span>
      {memory.scope && <span className="v-tag v-tag-scope">@{memory.scope}</span>}
      {memory.tags.map((tag) => (
        <span key={tag} className="v-tag v-tag-muted">
          #{tag}
        </span>
      ))}
      {memory.pinned && <span className="v-tag v-tag-pin">pinned</span>}
      {memory.status === 'unreviewed' && <span className="v-tag v-tag-warn">unreviewed</span>}
      {memory.status === 'archived' && <span className="v-tag v-tag-muted">archived</span>}
      {memory.supersedes && <span className="v-tag v-tag-muted">correction</span>}
      {stale !== null && <span className="v-tag v-tag-warn">stale {stale}mo</span>}
    </>
  );
}

export function MemoryCard({
  memory,
  onOpen,
  selected,
  onToggleSelect,
  actions,
  hideConflicts,
}: {
  memory: UiMemory;
  onOpen?: (id: string) => void;
  selected?: boolean;
  onToggleSelect?: (id: string) => void;
  actions?: ReactNode;
  hideConflicts?: boolean;
}) {
  return (
    <article
      className={`v-memory v-memory-${memory.status}${selected ? ' v-memory-selected' : ''}`}
    >
      <div className="v-memory-rail">
        {onToggleSelect && (
          <input
            type="checkbox"
            className="v-check"
            checked={selected ?? false}
            onChange={() => onToggleSelect(memory.id)}
            aria-label={`Select ${memory.id}`}
          />
        )}
        <StatusDot status={memory.status} />
      </div>

      <div className="v-memory-main">
        <div className="v-memory-top">
          <button className="v-memory-id" onClick={() => onOpen?.(memory.id)} title="Open details">
            {memory.id}
          </button>
          <MemoryBadges memory={memory} />
          <span className="v-memory-meta">
            {memory.source}
            <span className="v-sep" />
            {shortDate(memory.updated)}
          </span>
        </div>
        <p className="v-memory-body" onClick={() => onOpen?.(memory.id)}>
          {memory.body}
        </p>
        {memory.conflicts && !hideConflicts && memory.conflicts.length > 0 && (
          <div className="v-conflict-box">
            {memory.conflicts.map((conflict) => (
              <div key={conflict.id} className="v-conflict-line">
                Conflicts with{' '}
                <button className="v-text-link" onClick={() => onOpen?.(conflict.id)}>
                  {conflict.id}
                </button>
                : <em>{conflict.body}</em>
              </div>
            ))}
          </div>
        )}
        {actions && <div className="v-memory-actions">{actions}</div>}
      </div>
    </article>
  );
}

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
    <div className="v-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="v-modal" role="dialog" aria-label={title}>
        <div className="v-modal-head">
          <div>
            <div className="v-modal-kicker">Vault</div>
            <h2>{title}</h2>
          </div>
          <button className="v-btn v-btn-ghost v-btn-sm" onClick={onClose} aria-label="Close">
            Close
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
    <div className="v-overlay v-overlay-drawer" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="v-drawer" role="dialog">
        <button className="v-btn v-btn-ghost v-btn-sm v-drawer-close" onClick={onClose} aria-label="Close">
          Close
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
      className={`v-btn v-btn-danger${armed ? ' v-btn-danger-armed' : ''}`}
      onClick={() => (armed ? onConfirm() : setArmed(true))}
    >
      {armed ? confirmLabel : label}
    </button>
  );
}

export function Toasts() {
  const { toasts, dismissToast } = useApp();
  if (toasts.length === 0) return null;
  return (
    <div className="v-toasts">
      {toasts.map((t) => (
        <div key={t.id} className={`v-toast v-toast-${t.kind}`}>
          <span>{t.message}</span>
          {t.undo && (
            <button
              className="v-text-link"
              onClick={() => {
                t.undo?.();
                dismissToast(t.id);
              }}
            >
              undo
            </button>
          )}
          <button className="v-btn v-btn-ghost v-btn-sm" onClick={() => dismissToast(t.id)} aria-label="Dismiss">
            ×
          </button>
        </div>
      ))}
    </div>
  );
}

export function EmptyState({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children?: ReactNode;
}) {
  return (
    <div className="v-empty">
      <div className="v-empty-mark" aria-hidden="true" />
      <div className="v-empty-title">{title}</div>
      {hint && <div className="v-empty-hint">{hint}</div>}
      {children}
    </div>
  );
}

export function CopyButton({
  text,
  label = 'Copy',
  variant = 'vault',
}: {
  text: string;
  label?: string;
  variant?: 'landing' | 'vault';
}) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard may be unavailable in tests */
    }
  };
  const cls = variant === 'landing' ? 'lp-btn lp-btn-ghost lp-btn-sm' : 'v-btn v-btn-ghost v-btn-sm';
  return (
    <button className={cls} onClick={() => void copy()} aria-label={label}>
      {copied ? 'Copied!' : label}
    </button>
  );
}

export function FilterChips({
  filters,
  onRemove,
}: {
  filters: Array<{ key: string; label: string }>;
  onRemove: (key: string) => void;
}) {
  if (filters.length === 0) return null;
  return (
    <div className="v-chips" role="list" aria-label="Active filters">
      {filters.map((chip) => (
        <span key={chip.key} className="v-chip" role="listitem">
          {chip.label}
          <button
            className="v-chip-x"
            onClick={() => onRemove(chip.key)}
            aria-label={`Remove ${chip.label} filter`}
          >
            ×
          </button>
        </span>
      ))}
    </div>
  );
}

export function ShortcutLegend() {
  const shortcuts = [
    { keys: ['j', 'k'], label: 'move' },
    { keys: ['a'], label: 'approve' },
    { keys: ['r'], label: 'reject' },
    { keys: ['e'], label: 'edit' },
    { keys: ['x'], label: 'select' },
  ];
  return (
    <div className="v-kbd-bar" aria-label="Keyboard shortcuts">
      <span className="v-kbd-title">Shortcuts</span>
      {shortcuts.map((s) => (
        <span key={s.label} className="v-kbd-item">
          {s.keys.map((k) => (
            <kbd key={k}>{k}</kbd>
          ))}
          <span>{s.label}</span>
        </span>
      ))}
    </div>
  );
}

export function PageHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <header className="v-page-head">
      <div className="v-page-kicker">Vault console</div>
      <h1>{title}</h1>
      {subtitle && <p>{subtitle}</p>}
    </header>
  );
}
