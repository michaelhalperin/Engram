import type { Embedder } from '../src/index.js';

/**
 * Deterministic stand-in for the real model: texts map to fixed unit vectors,
 * so tests control exactly how "similar" any two texts are. Unknown text gets
 * an orthogonal-to-everything zero vector.
 */
export function fakeEmbedder(table: Record<string, number[]>): Embedder {
  const normalized = new Map<string, Float32Array>();
  for (const [text, values] of Object.entries(table)) {
    const norm = Math.hypot(...values) || 1;
    normalized.set(text.toLowerCase().trim(), new Float32Array(values.map((v) => v / norm)));
  }
  const dims = Object.values(table)[0]?.length ?? 3;
  return {
    model: 'fake-embedder',
    async embed(texts: string[]): Promise<Float32Array[]> {
      return texts.map((t) => normalized.get(t.toLowerCase().trim()) ?? new Float32Array(dims));
    },
  };
}
