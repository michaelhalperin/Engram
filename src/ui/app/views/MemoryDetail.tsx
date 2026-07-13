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
        <p className="muted">This memory no longer exists.</p>
      </Drawer>
    );
  }
  if (!detail) {
    return (
      <Drawer onClose={onClose}>
        <p className="muted">loading…</p>
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
      <div className="detail-head">
        <StatusDot status={memory.status} />
        <code className="detail-id">{memory.id}</code>
      </div>
      <div className="detail-badges">
        <MemoryBadges memory={memory} />
      </div>
      <p className="muted small">
        saved {shortDate(memory.created)} by <strong>{memory.source}</strong> · last confirmed{' '}
        {shortDate(memory.lastConfirmed)}
      </p>

      <label className="field">
        <span>Memory</span>
        <textarea rows={5} value={body} onChange={(e) => setBody(e.target.value)} />
      </label>
      <div className="field-row">
        <label className="field">
          <span>Type</span>
          <select value={type} onChange={(e) => setType(e.target.value)}>
            {MEMORY_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Tags</span>
          <input type="text" value={tags} placeholder="comma, separated" onChange={(e) => setTags(e.target.value)} />
        </label>
        <label className="field">
          <span>Scope</span>
          <input type="text" value={scope} placeholder="global" onChange={(e) => setScope(e.target.value)} />
        </label>
      </div>
      {dirty && (
        <button
          className="primary"
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

      <div className="detail-actions">
        {memory.status === 'unreviewed' && (
          <>
            <button className="approve" onClick={() => act(() => reviewAction(memory.id, 'approve'), 'approved')}>
              ✓ approve
            </button>
            <button className="reject" onClick={() => act(() => reviewAction(memory.id, 'reject'), 'rejected')}>
              ✗ reject
            </button>
          </>
        )}
        <button onClick={() => act(() => reviewAction(memory.id, 'confirm'), 'confirmed as still true')}>
          still true
        </button>
        <button
          onClick={() =>
            act(() => patchMemory(memory.id, { pinned: !memory.pinned }), memory.pinned ? 'unpinned' : 'pinned to profile')
          }
        >
          {memory.pinned ? '☆ unpin' : '★ pin'}
        </button>
        {memory.status === 'archived' ? (
          <button onClick={() => act(() => patchMemory(memory.id, { status: 'active' }), 'restored')}>
            restore
          </button>
        ) : (
          <button
            onClick={() =>
              act(
                () => archiveMemory(memory.id),
                'archived — file kept',
                () => void patchMemory(memory.id, { status: 'active' }).then(() => Promise.all([load(), refresh()])),
              )
            }
          >
            archive
          </button>
        )}
        <DangerButton
          label="delete file"
          confirmLabel="really delete?"
          onConfirm={() =>
            void hardDeleteMemory(memory.id).then(() => {
              toast('deleted permanently', 'warn');
              void refresh();
              onClose();
            })
          }
        />
      </div>

      {conflicts.length > 0 && (
        <section className="detail-section">
          <h3>⚔️ Possible conflicts</h3>
          {conflicts.map((conflict) => (
            <div key={conflict.id} className="conflict-row">
              <a className="link" href={`#/memories/${conflict.id}`}>
                {conflict.id}
              </a>
              : <em>{conflict.body}</em>
            </div>
          ))}
        </section>
      )}

      {history.length > 1 && (
        <section className="detail-section">
          <h3>History — correction chain</h3>
          <ol className="history">
            {history.map((entry) => (
              <li key={entry.id} className={entry.id === memory.id ? 'history-current' : ''}>
                <StatusDot status={entry.status} />
                {entry.id === memory.id ? (
                  <code>{entry.id}</code>
                ) : (
                  <a className="link" href={`#/memories/${entry.id}`}>
                    {entry.id}
                  </a>
                )}
                <span className="muted small"> {shortDate(entry.created)}</span>
                <div className="history-body">{entry.body}</div>
              </li>
            ))}
          </ol>
        </section>
      )}
    </Drawer>
  );
}
