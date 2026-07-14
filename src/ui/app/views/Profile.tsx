import { useCallback, useEffect, useState } from 'react';
import { getProfile, patchMemory } from '../api';
import { EmptyState, MemoryBadges, PageHeader } from '../components';
import { shortDate, useApp } from '../lib';
import type { Memory } from '../types';

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
    <div className="v-view">
      <PageHeader
        title="Profile"
        subtitle="Pinned facts every AI loads at session start. Pinning is a human act — agents can never do it."
      />

      <section className="v-panel v-panel-accent">
        <div className="v-panel-head">
          <h2 className="v-profile-heading">This is what your AIs see</h2>
          <code className="v-uri">engram://profile</code>
        </div>
        <p className="v-muted v-profile-sub">
          The exact profile markdown — framed as stored data, never instructions.
        </p>
        <pre className="v-code-block">{markdown || 'Nothing pinned yet.'}</pre>
      </section>

      <section className="v-profile-grid-wrap">
        <h3 className="v-panel-title">Pinned facts ({pinned.length})</h3>
        {pinned.length === 0 ? (
          <EmptyState title="Nothing pinned yet" hint="Open a memory and pin it to put it in front of every AI." />
        ) : (
          <div className="v-profile-grid">
            {pinned.map((memory) => (
              <article key={memory.id} className="v-profile-card">
                <p>{memory.body}</p>
                <MemoryBadges memory={memory} />
                <div className="v-profile-card-foot">
                  <button className="v-text-link" onClick={() => onOpen(memory.id)}>
                    open
                  </button>
                  <button className="v-btn v-btn-sm" onClick={() => void unpin(memory.id)}>
                    unpin
                  </button>
                  <span className="v-muted">
                    {memory.source}
                    <span className="v-sep" />
                    {shortDate(memory.updated)}
                  </span>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
