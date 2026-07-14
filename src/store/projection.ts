/**
 * Project high-dimensional embedding vectors onto their two principal
 * components, for the semantic map. Plain power iteration with deflation —
 * exact enough for a scatter plot, no math dependency, and fast at
 * personal-vault scale (n × dims per iteration).
 */

const ITERATIONS = 60;

export function projectTo2d(vectors: Float32Array[]): Array<{ x: number; y: number }> {
  const n = vectors.length;
  if (n === 0) return [];
  if (n === 1) return [{ x: 0.5, y: 0.5 }];
  const dims = vectors[0].length;

  const mean = new Float64Array(dims);
  for (const v of vectors) for (let d = 0; d < dims; d++) mean[d] += v[d] / n;
  const centered = vectors.map((v) => {
    const c = new Float64Array(dims);
    for (let d = 0; d < dims; d++) c[d] = v[d] - mean[d];
    return c;
  });

  const first = principalComponent(centered);
  const projections = centered.map((row) => dotF64(row, first));
  deflate(centered, first); // mutates: rows now live in the residual space
  const second = principalComponent(centered);

  return normalize01(
    centered.map((row, i) => ({ x: projections[i], y: dotF64(row, second) })),
  );
}

/** Dominant eigenvector of the covariance via power iteration on X'X. */
function principalComponent(centered: Float64Array[]): Float64Array {
  const dims = centered[0].length;
  let v = new Float64Array(dims);
  // Deterministic start: a fixed pseudo-random direction, so maps are stable run to run.
  for (let d = 0; d < dims; d++) v[d] = Math.sin(d * 12.9898 + 78.233);
  normalizeVec(v);
  for (let iter = 0; iter < ITERATIONS; iter++) {
    const next = new Float64Array(dims);
    for (const row of centered) {
      const scale = dotF64(row, v);
      for (let d = 0; d < dims; d++) next[d] += scale * row[d];
    }
    if (!normalizeVec(next)) break; // zero variance: keep previous direction
    v = next;
  }
  return v;
}

/** Remove the component's contribution so the next power iteration finds the runner-up. */
function deflate(centered: Float64Array[], component: Float64Array): void {
  for (const row of centered) {
    const scale = dotF64(row, component);
    for (let d = 0; d < row.length; d++) row[d] -= scale * component[d];
  }
}

function dotF64(a: Float64Array | Float32Array, b: Float64Array): number {
  let sum = 0;
  for (let i = 0; i < b.length; i++) sum += a[i] * b[i];
  return sum;
}

function normalizeVec(v: Float64Array): boolean {
  let norm = 0;
  for (const x of v) norm += x * x;
  norm = Math.sqrt(norm);
  if (norm < 1e-12) return false;
  for (let i = 0; i < v.length; i++) v[i] /= norm;
  return true;
}

/**
 * Fit into [0, 1] with one shared scale for both axes, so distances stay
 * truthful: a tight cluster is not stretched to fill the canvas just because
 * the second component carries little variance. The used extent is centered.
 */
function normalize01(points: Array<{ x: number; y: number }>): Array<{ x: number; y: number }> {
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const [minX, maxX] = [Math.min(...xs), Math.max(...xs)];
  const [minY, maxY] = [Math.min(...ys), Math.max(...ys)];
  const scale = Math.max(maxX - minX, maxY - minY);
  if (scale < 1e-9) return points.map(() => ({ x: 0.5, y: 0.5 }));
  const offsetX = (1 - (maxX - minX) / scale) / 2;
  const offsetY = (1 - (maxY - minY) / scale) / 2;
  return points.map((p) => ({
    x: offsetX + (p.x - minX) / scale,
    y: offsetY + (p.y - minY) / scale,
  }));
}
