import { EmptyState, MemoryCard } from '../components';
import { useApp } from '../lib';

function FacetBars({ title, entries }: { title: string; entries: Record<string, number> }) {
  const sorted = Object.entries(entries).sort((a, b) => b[1] - a[1]).slice(0, 8);
  const max = sorted[0]?.[1] ?? 1;
  return (
    <section className="panel">
      <h3>{title}</h3>
      {sorted.length === 0 ? (
        <p className="muted">nothing yet</p>
      ) : (
        sorted.map(([label, count]) => (
          <div key={label} className="bar-row">
            <span className="bar-label">{label}</span>
            <span className="bar-track">
              <span className="bar-fill" style={{ width: `${(count / max) * 100}%` }} />
            </span>
            <span className="bar-count">{count}</span>
          </div>
        ))
      )}
    </section>
  );
}

export function Dashboard({ onOpen }: { onOpen: (id: string) => void }) {
  const { state } = useApp();
  if (!state) return null;
  const { counts, stale, facets, memories, inbox } = state;
  const scopes = Object.entries(facets.scopes).sort((a, b) => b[1] - a[1]);

  return (
    <div>
      <div className="view-head">
        <h1>Dashboard</h1>
        <p className="muted">What your AIs know about you, at a glance.</p>
      </div>

      <div className="tiles">
        <a className="tile" href="#/memories">
          <span className="tile-number">{counts.active}</span>
          <span className="tile-label">active memories</span>
        </a>
        <a className={`tile${inbox.length > 0 ? ' tile-attention' : ''}`} href="#/inbox">
          <span className="tile-number">{counts.unreviewed}</span>
          <span className="tile-label">awaiting review</span>
        </a>
        <a className="tile" href="#/profile">
          <span className="tile-number">{counts.pinned}</span>
          <span className="tile-label">pinned to profile</span>
        </a>
        <a className={`tile${stale > 0 ? ' tile-stale' : ''}`} href="#/memories">
          <span className="tile-number">{stale}</span>
          <span className="tile-label">going stale</span>
        </a>
      </div>

      <div className="dash-grid">
        <FacetBars title="By type" entries={facets.types} />
        <FacetBars title="By source — which AI wrote what" entries={facets.sources} />
      </div>

      {scopes.length > 0 && (
        <section className="panel">
          <h3>Project scopes</h3>
          <div className="chip-row">
            {scopes.map(([scope, count]) => (
              <a key={scope} className="chip" href={`#/memories?scope=${encodeURIComponent(scope)}`}>
                @{scope} <span className="chip-count">{count}</span>
              </a>
            ))}
          </div>
        </section>
      )}

      <section className="panel">
        <h3>Recent</h3>
        {memories.length === 0 ? (
          <EmptyState
            icon="◉"
            title="No memories yet"
            hint={`Add one below, or connect an AI tool: claude mcp add engram -- engram serve`}
          />
        ) : (
          memories.slice(0, 5).map((memory) => <MemoryCard key={memory.id} memory={memory} onOpen={onOpen} />)
        )}
        {memories.length > 5 && (
          <a className="link" href="#/memories">
            browse all {counts.active + counts.unreviewed} memories →
          </a>
        )}
      </section>
    </div>
  );
}
