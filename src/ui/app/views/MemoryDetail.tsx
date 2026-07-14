import { useCallback, useEffect, useState } from 'react';
import {
  archiveMemory,
  getMemory,
  hardDeleteMemory,
  patchMemory,
  reviewAction,
} from '../api';
import { DangerButton, Drawer, MemoryBadges, StatusDot } from '../components';
import { shortDate, useApp } from '../lib';
import { MEMORY_TYPES, type DetailResponse } from '../types';

export function MemoryDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const { refresh, toast } = useApp();
  const [detail, setDetail] = useState<DetailResponse | null>(null);
  const [missing, setMissing] = useState(false);
  const [body, setBody] = useState('');
  const [tags, setTags] = useState('');
  const [scope, setScope] = useState('');
  const [type, setType] = useState('fact');

  const load = useCallback(async () => {
    try {
      const data = await getMemory(id);
      setDetail(data);
      setBody(data.memory.body);
      setTags(data.memory.tags.join(', '));
      setScope(data.memory.scope ?? '');
      setType(data.memory.type);
    } catch {
      setMissing(true);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const act = async (fn: () => Promise<unknown>, message: string, undo?: () => void) => {
    try {
      await fn();
      toast(message, 'ok', undo);
      await Promise.all([load(), refresh()]);
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  };

  if (missing) {
    return (
      <Drawer onClose={onClose}>
        <p className="v-muted">This memory no longer exists.</p>
      </Drawer>
    );
  }
  if (!detail) {
    return (
      <Drawer onClose={onClose}>
        <p className="v-muted">Loading…</p>
      </Drawer>
    );
  }

  const { memory, history, conflicts } = detail;
  const dirty =
    body.trim() !== memory.body ||
    tags !== memory.tags.join(', ') ||
    scope.trim() !== (memory.scope ?? '') ||
    type !== memory.type;

  return (
    <Drawer onClose={onClose}>
      <div className="v-detail-head">
        <StatusDot status={memory.status} />
        <code>{memory.id}</code>
      </div>
      <div className="v-detail-tags">
        <MemoryBadges memory={memory} />
      </div>
      <p className="v-muted v-detail-meta">
        saved {shortDate(memory.created)} by <strong>{memory.source}</strong> · confirmed{' '}
        {shortDate(memory.lastConfirmed)}
      </p>

      <label className="v-field">
        <span>Memory</span>
        <textarea className="v-input" rows={5} value={body} onChange={(e) => setBody(e.target.value)} />
      </label>
      <div className="v-field-row">
        <label className="v-field">
          <span>Type</span>
          <select className="v-input" value={type} onChange={(e) => setType(e.target.value)}>
            {MEMORY_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
        <label className="v-field">
          <span>Tags</span>
          <input className="v-input" type="text" value={tags} placeholder="comma, separated" onChange={(e) => setTags(e.target.value)} />
        </label>
        <label className="v-field">
          <span>Scope</span>
          <input className="v-input" type="text" value={scope} placeholder="global" onChange={(e) => setScope(e.target.value)} />
        </label>
      </div>
      {dirty && (
        <button
          className="v-btn v-btn-accent"
          onClick={() =>
            act(
              () => patchMemory(memory.id, { text: body, type, tags, scope: scope.trim() || null }),
              'saved',
            )
          }
        >
          Save changes
        </button>
      )}

      <div className="v-detail-actions">
        {memory.status === 'unreviewed' && (
          <>
            <button className="v-btn v-btn-ok" onClick={() => act(() => reviewAction(memory.id, 'approve'), 'approved')}>
              Approve
            </button>
            <button className="v-btn v-btn-no" onClick={() => act(() => reviewAction(memory.id, 'reject'), 'rejected')}>
              Reject
            </button>
          </>
        )}
        <button className="v-btn" onClick={() => act(() => reviewAction(memory.id, 'confirm'), 'confirmed')}>
          Still true
        </button>
        <button
          className="v-btn"
          onClick={() =>
            act(() => patchMemory(memory.id, { pinned: !memory.pinned }), memory.pinned ? 'unpinned' : 'pinned')
          }
        >
          {memory.pinned ? 'Unpin' : 'Pin to profile'}
        </button>
        {memory.status === 'archived' ? (
          <button className="v-btn" onClick={() => act(() => patchMemory(memory.id, { status: 'active' }), 'restored')}>
            Restore
          </button>
        ) : (
          <button
            className="v-btn"
            onClick={() =>
              act(
                () => archiveMemory(memory.id),
                'archived',
                () => void patchMemory(memory.id, { status: 'active' }).then(() => Promise.all([load(), refresh()])),
              )
            }
          >
            Archive
          </button>
        )}
        <DangerButton label="Delete file" confirmLabel="Really delete?" onConfirm={() =>
            void hardDeleteMemory(memory.id).then(() => {
              toast('deleted permanently', 'warn');
              void refresh();
              onClose();
            })
          }
        />
      </div>

      {conflicts.length > 0 && (
        <section className="v-detail-section">
          <h3 className="v-panel-title">Possible conflicts</h3>
          <div className="v-duel v-duel-compact">
            <div className="v-duel-side">
              <p>{memory.body}</p>
              <code className="v-muted">{memory.id}</code>
            </div>
            <div className="v-duel-mid">vs</div>
            {conflicts.map((c) => (
              <div key={c.id} className="v-duel-side">
                <p>{c.body}</p>
                <a className="v-text-link" href={`#/vault/memories/${c.id}`}>
                  {c.id}
                </a>
              </div>
            ))}
          </div>
        </section>
      )}

      {history.length > 1 && (
        <section className="v-detail-section">
          <h3 className="v-panel-title">Correction chain</h3>
          <ol className="v-chain">
            {history.map((entry, index) => (
              <li
                key={entry.id}
                className={`v-chain-item${entry.id === memory.id ? ' v-chain-current' : ''}`}
              >
                <div className="v-chain-rail">
                  <span className="v-chain-dot" />
                  {index < history.length - 1 && <span className="v-chain-line" />}
                </div>
                <div className="v-chain-body">
                  <div className="v-chain-head">
                    <StatusDot status={entry.status} />
                    {entry.id === memory.id ? (
                      <code>{entry.id}</code>
                    ) : (
                      <a className="v-text-link" href={`#/vault/memories/${entry.id}`}>
                        {entry.id}
                      </a>
                    )}
                    <span className="v-muted">{shortDate(entry.created)}</span>
                    {entry.id === memory.id && <span className="v-tag v-tag-type">current</span>}
                  </div>
                  <p>{entry.body}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>
      )}
    </Drawer>
  );
}
