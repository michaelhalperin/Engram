import { EmptyState, MemoryCard, PageHeader } from '../components';
import { shortDate, totalMemories, useApp } from '../lib';

function FacetBars({
  title,
  entries,
  hrefFor,
}: {
  title: string;
  entries: Record<string, number>;
  hrefFor?: (label: string) => string;
}) {
  const sorted = Object.entries(entries).sort((a, b) => b[1] - a[1]).slice(0, 8);
  const max = sorted[0]?.[1] ?? 1;
  return (
    <section className="v-panel">
      <h3 className="v-panel-title">{title}</h3>
      {sorted.length === 0 ? (
        <p className="v-muted">nothing yet</p>
      ) : (
        <div className="v-bar-list">
          {sorted.map(([label, count]) => {
            const inner = (
              <>
                <span className="v-bar-label">{label}</span>
                <span className="v-bar-track">
                  <span className="v-bar-fill" style={{ width: `${(count / max) * 100}%` }} />
                </span>
                <span className="v-bar-val">{count}</span>
              </>
            );
            return hrefFor ? (
              <a key={label} className="v-bar-row v-bar-link" href={hrefFor(label)}>
                {inner}
              </a>
            ) : (
              <div key={label} className="v-bar-row">
                {inner}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

export function Dashboard({ onOpen }: { onOpen: (id: string) => void }) {
  const { state } = useApp();
  if (!state) return null;
  const { counts, stale, facets, memories, inbox } = state;
  const scopes = Object.entries(facets.scopes).sort((a, b) => b[1] - a[1]);
  const total = totalMemories(counts);
  const recent = [...memories].sort((a, b) => Date.parse(b.updated) - Date.parse(a.updated)).slice(0, 8);

  return (
    <div className="v-view">
      <PageHeader title="Overview" subtitle="What your AIs know about you, at a glance." />

      <div className="v-stats">
        <a className="v-stat" href="#/vault/memories?status=active">
          <span className="v-stat-label">active memories</span>
          <span className="v-stat-num">{counts.active}</span>
        </a>
        <a className={`v-stat${inbox.length > 0 ? ' v-stat-warn' : ''}`} href="#/vault/inbox">
          <span className="v-stat-label">awaiting review</span>
          <span className="v-stat-num">{counts.unreviewed}</span>
        </a>
        <a className="v-stat" href="#/vault/memories?pinned=1">
          <span className="v-stat-label">pinned to profile</span>
          <span className="v-stat-num">{counts.pinned}</span>
        </a>
        <a className={`v-stat${stale > 0 ? ' v-stat-warn' : ''}`} href="#/vault/memories?status=active">
          <span className="v-stat-label">going stale</span>
          <span className="v-stat-num">{stale}</span>
        </a>
      </div>

      <div className="v-two-col">
        <FacetBars
          title="By type"
          entries={facets.types}
          hrefFor={(type) => `#/vault/memories?type=${encodeURIComponent(type)}`}
        />
        <FacetBars title="By source" entries={facets.sources} />
      </div>

      {scopes.length > 0 && (
        <section className="v-panel">
          <h3 className="v-panel-title">Project scopes</h3>
          <div className="v-scope-list">
            {scopes.map(([scope, count]) => (
              <a key={scope} className="v-scope-row" href={`#/vault/memories?scope=${encodeURIComponent(scope)}`}>
                <code>@{scope}</code>
                <span className="v-scope-count">{count}</span>
              </a>
            ))}
          </div>
        </section>
      )}

      <section className="v-panel">
        <h3 className="v-panel-title">Recent activity</h3>
        {recent.length === 0 ? (
          <EmptyState title="Your vault is empty" hint="Connect an AI tool or import memories from another app.">
            <div className="v-empty-actions">
              <a className="v-btn v-btn-accent" href="#/">
                See how Engram works
              </a>
              <p className="v-empty-hint">
                <code>engram import claude</code>
                <span className="v-sep" />
                <code>engram import chatgpt &lt;export.zip&gt;</code>
              </p>
            </div>
          </EmptyState>
        ) : (
          <ul className="v-feed">
            {recent.map((memory) => (
              <li key={memory.id} className="v-feed-row">
                <button className="v-feed-src" onClick={() => onOpen(memory.id)}>
                  {memory.source}
                </button>
                <button className="v-text-link v-feed-body" onClick={() => onOpen(memory.id)}>
                  {memory.body}
                </button>
                <span className="v-muted v-feed-date">{shortDate(memory.updated)}</span>
              </li>
            ))}
          </ul>
        )}
        {total > 5 && (
          <a className="v-text-link v-panel-foot" href="#/vault/memories">
            browse all {total} memories →
          </a>
        )}
      </section>
    </div>
  );
}
