import { useCallback, useEffect, useState } from 'react';
import { getProfile, patchMemory } from '../api';
import { EmptyState, MemoryCard } from '../components';
import { useApp } from '../lib';
import type { Memory } from '../types';

/** The always-loaded core: pinned facts, plus the exact markdown agents receive. */
export function Profile({ onOpen }: { onOpen: (id: string) => void }) {
  const { refresh, toast } = useApp();
  const [markdown, setMarkdown] = useState('');
  const [pinned, setPinned] = useState<Memory[]>([]);

  const load = useCallback(async () => {
    const data = await getProfile();
    setMarkdown(data.markdown);
    setPinned(data.pinned);
  }, []);

  useEffect(() => {
    void load().catch(() => toast('failed to load profile', 'error'));
  }, [load, toast]);

  const unpin = async (id: string) => {
    await patchMemory(id, { pinned: false });
    toast(`unpinned ${id}`, 'ok', () => void patchMemory(id, { pinned: true }).then(() => Promise.all([load(), refresh()])));
    await Promise.all([load(), refresh()]);
  };

  return (
    <div>
      <div className="view-head">
        <h1>Profile</h1>
        <p className="muted">
          Pinned facts every AI tool loads at session start (the <code>engram://profile</code> resource).
          Pinning is a human act — agents can never do it.
        </p>
      </div>

      {pinned.length === 0 ? (
        <EmptyState
          icon="★"
          title="Nothing pinned yet"
          hint="Open a memory and hit ★ pin to put it in front of every AI you use."
        />
      ) : (
        pinned.map((memory) => (
          <MemoryCard
            key={memory.id}
            memory={memory}
            onOpen={onOpen}
            actions={
              <button onClick={() => void unpin(memory.id)}>☆ unpin</button>
            }
          />
        ))
      )}

      <section className="panel">
        <h3>Exactly what agents see</h3>
        <pre className="profile-preview">{markdown}</pre>
      </section>
    </div>
  );
}
