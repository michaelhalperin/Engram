import { useEffect, useMemo, useState } from 'react';
import { getSemanticMap } from '../api';
import { EmptyState, PageHeader, StatusDot } from '../components';
import type { MapPoint, SemanticMapResponse } from '../types';

/**
 * The vault, seen by meaning: every memory's embedding projected onto its two
 * principal axes, so facts that talk about the same thing sit near each other.
 * Faint lines join each memory to its strongest semantic neighbor.
 */

const W = 1000;
const H = 620;
const PAD = 42;

type ColorBy = 'type' | 'scope' | 'status';

/** Categorical palette that reads on both themes. */
const PALETTE = [
  '#0e7490', '#b45309', '#15803d', '#7c3aed', '#b91c1c',
  '#0369a1', '#a16207', '#be185d', '#4d7c0f', '#6b7280',
];

function categoryOf(point: MapPoint, colorBy: ColorBy): string {
  if (colorBy === 'type') return point.type;
  if (colorBy === 'status') return point.status;
  return point.scope ?? 'global';
}

export function SemanticMap({ onOpen }: { onOpen: (id: string) => void }) {
  const [data, setData] = useState<SemanticMapResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [colorBy, setColorBy] = useState<ColorBy>('type');
  const [hovered, setHovered] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [mutedCats, setMutedCats] = useState<Set<string>>(new Set());

  useEffect(() => {
    getSemanticMap().then(setData, (err: Error) => setError(err.message));
  }, []);

  const points = data?.available ? data.points : [];
  const byId = useMemo(() => new Map(points.map((p) => [p.id, p])), [points]);

  const categories = useMemo(() => {
    const counts = new Map<string, number>();
    for (const p of points) {
      const cat = categoryOf(p, colorBy);
      counts.set(cat, (counts.get(cat) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [points, colorBy]);

  const colorFor = useMemo(() => {
    const assigned = new Map(categories.map(([cat], i) => [cat, PALETTE[i % PALETTE.length]]));
    return (p: MapPoint) => assigned.get(categoryOf(p, colorBy)) ?? PALETTE[9];
  }, [categories, colorBy]);

  if (error) return <div className="v-alert">Semantic map failed to load: {error}</div>;
  if (!data) return <p className="v-muted">projecting the vault…</p>;

  if (!data.available) {
    return (
      <div className="v-view">
        <PageHeader title="Semantic map" subtitle="Your vault, arranged by meaning." />
        <EmptyState
          title="The semantic index isn't built yet"
          hint={data.reason}
        >
          <p className="v-empty-hint">
            <code>engram embed</code>
            <span className="v-sep" />
            one-time ~25 MB model download, fully local afterwards
          </p>
        </EmptyState>
      </div>
    );
  }

  if (points.length < 3) {
    return (
      <div className="v-view">
        <PageHeader title="Semantic map" subtitle="Your vault, arranged by meaning." />
        <EmptyState title="Not enough memories to map" hint="Three or more embedded memories make a map." />
      </div>
    );
  }

  const px = (p: MapPoint) => PAD + p.x * (W - PAD * 2);
  const py = (p: MapPoint) => PAD + (1 - p.y) * (H - PAD * 2);
  const isMuted = (p: MapPoint) => mutedCats.has(categoryOf(p, colorBy));
  const active = selected ?? hovered;
  const activePoint = active ? byId.get(active) : undefined;
  const neighborIds = new Set(
    active
      ? data.edges.flatMap((e) => (e.a === active ? [e.b] : e.b === active ? [e.a] : []))
      : [],
  );

  const toggleCategory = (cat: string) =>
    setMutedCats((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });

  return (
    <div className="v-view">
      <PageHeader
        title="Semantic map"
        subtitle="Every memory, placed by meaning — neighbors talk about the same thing. Lines join strongest semantic ties."
      />

      <div className="v-map-toolbar">
        <div className="v-map-colorby" role="group" aria-label="Color by">
          {(['type', 'scope', 'status'] as const).map((mode) => (
            <button
              key={mode}
              className={`v-btn v-btn-sm${colorBy === mode ? ' v-btn-accent' : ' v-btn-ghost'}`}
              onClick={() => {
                setColorBy(mode);
                setMutedCats(new Set());
              }}
            >
              {mode}
            </button>
          ))}
        </div>
        <span className="v-muted v-map-model">
          {points.length} memories · {data.model}
        </span>
      </div>

      <div className="v-map-layout">
        <section className="v-panel v-map-panel">
          <svg
            className="v-map-svg"
            viewBox={`0 0 ${W} ${H}`}
            role="img"
            aria-label="Scatter plot of memories arranged by semantic similarity"
            onClick={() => setSelected(null)}
          >
            {data.edges.map((edge) => {
              const a = byId.get(edge.a);
              const b = byId.get(edge.b);
              if (!a || !b) return null;
              const emphasized = active !== null && (edge.a === active || edge.b === active);
              return (
                <line
                  key={`${edge.a}|${edge.b}`}
                  x1={px(a)}
                  y1={py(a)}
                  x2={px(b)}
                  y2={py(b)}
                  className={`v-map-edge${emphasized ? ' v-map-edge-hot' : ''}`}
                  style={{ opacity: emphasized ? 0.9 : 0.12 + (edge.similarity - 0.6) * 0.5 }}
                />
              );
            })}
            {points.map((p) => {
              const dim = isMuted(p) || (active !== null && p.id !== active && !neighborIds.has(p.id));
              return (
                <circle
                  key={p.id}
                  cx={px(p)}
                  cy={py(p)}
                  r={p.pinned ? 8 : 5.5}
                  fill={colorFor(p)}
                  className={`v-map-dot${p.status === 'unreviewed' ? ' v-map-dot-unreviewed' : ''}${
                    p.id === active ? ' v-map-dot-active' : ''
                  }`}
                  style={{ opacity: dim ? 0.18 : 0.92 }}
                  onMouseEnter={() => setHovered(p.id)}
                  onMouseLeave={() => setHovered(null)}
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelected((prev) => (prev === p.id ? null : p.id));
                  }}
                >
                  <title>{p.body}</title>
                </circle>
              );
            })}
          </svg>

          <div className="v-map-legend">
            {categories.map(([cat, count], i) => (
              <button
                key={cat}
                className={`v-map-legend-item${mutedCats.has(cat) ? ' v-map-legend-muted' : ''}`}
                onClick={() => toggleCategory(cat)}
                title={mutedCats.has(cat) ? 'show' : 'hide'}
              >
                <span className="v-map-legend-dot" style={{ background: PALETTE[i % PALETTE.length] }} />
                {cat} <span className="v-muted">{count}</span>
              </button>
            ))}
          </div>
        </section>

        <aside className="v-panel v-map-side">
          {activePoint ? (
            <>
              <div className="v-map-side-head">
                <StatusDot status={activePoint.status} />
                <code className="v-muted">{activePoint.id}</code>
              </div>
              <p className="v-map-side-body">{activePoint.body}</p>
              <p className="v-muted v-map-side-meta">
                {activePoint.type}
                {activePoint.scope ? ` · @${activePoint.scope}` : ''} · {activePoint.source}
              </p>
              {neighborIds.size > 0 && (
                <div className="v-map-side-neighbors">
                  <h4 className="v-panel-title">Closest in meaning</h4>
                  {[...neighborIds].map((id) => {
                    const n = byId.get(id);
                    return n ? (
                      <button key={id} className="v-text-link v-map-neighbor" onClick={() => setSelected(id)}>
                        {n.body}
                      </button>
                    ) : null;
                  })}
                </div>
              )}
              <button className="v-btn v-btn-accent v-btn-sm" onClick={() => onOpen(activePoint.id)}>
                Open memory →
              </button>
            </>
          ) : (
            <p className="v-muted">
              Hover a dot to read it; click to pin the selection. Clusters are topics — the model has
              never seen your labels, only your sentences. Click a legend entry to hide its category.
            </p>
          )}
        </aside>
      </div>
    </div>
  );
}
