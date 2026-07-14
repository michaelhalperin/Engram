import { useState } from 'react';
import { createMemory } from '../api';
import { Modal } from '../components';
import { useApp } from '../lib';
import { MEMORY_TYPES } from '../types';

export function AddMemory({ onClose }: { onClose: () => void }) {
  const { refresh, toast } = useApp();
  const [text, setText] = useState('');
  const [type, setType] = useState('fact');
  const [tags, setTags] = useState('');
  const [scope, setScope] = useState('');
  const [pinned, setPinned] = useState(false);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!text.trim() || busy) return;
    setBusy(true);
    try {
      const { memory, existing, conflicts } = await createMemory({
        text,
        type,
        tags,
        scope: scope.trim() || undefined,
        pinned,
      });
      if (existing) {
        toast(`already known as ${memory.id}`, 'warn');
      } else if (conflicts.length > 0) {
        toast(`saved ${memory.id} — ⚔️ possibly conflicts with ${conflicts[0].id}`, 'warn');
      } else {
        toast(`saved ${memory.id}`);
      }
      await refresh();
      onClose();
    } catch (err) {
      toast((err as Error).message, 'error');
      setBusy(false);
    }
  };

  return (
    <Modal title="Add a memory" onClose={onClose}>
      <label className="v-field">
        <span>One atomic fact, phrased to be useful without context</span>
        <textarea
          className="v-input"
          rows={4}
          autoFocus
          placeholder="e.g. Staging deploys go out Friday mornings"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void save();
          }}
        />
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
          <input className="v-input" type="text" placeholder="comma, separated" value={tags} onChange={(e) => setTags(e.target.value)} />
        </label>
        <label className="v-field">
          <span>Scope</span>
          <input className="v-input" type="text" placeholder="global" value={scope} onChange={(e) => setScope(e.target.value)} />
        </label>
      </div>
      <label className="v-check-label">
        <input type="checkbox" checked={pinned} onChange={(e) => setPinned(e.target.checked)} />
        pin into the profile every AI loads
      </label>
      <div className="v-modal-foot">
        <button className="v-btn v-btn-accent" disabled={!text.trim() || busy} onClick={() => void save()}>
          Save memory
        </button>
        <span className="v-muted">⌘⏎</span>
      </div>
    </Modal>
  );
}
