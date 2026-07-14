import { describe, expect, it } from 'vitest';
import { projectTo2d } from '../src/store/projection.js';

const v = (...values: number[]) => new Float32Array(values);

function dist(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

describe('projectTo2d', () => {
  it('keeps semantic clusters together and apart', () => {
    // Two tight clusters in 4d: food-ish and deploy-ish.
    const points = projectTo2d([
      v(1, 0.1, 0, 0),
      v(0.95, 0.2, 0.05, 0),
      v(0.9, 0.15, 0, 0.1),
      v(0, 0.1, 1, 0.2),
      v(0.05, 0, 0.95, 0.25),
    ]);
    const within = Math.max(dist(points[0], points[1]), dist(points[0], points[2]), dist(points[3], points[4]));
    const across = dist(points[0], points[3]);
    expect(across).toBeGreaterThan(within * 2);
  });

  it('normalizes into [0,1] and survives degenerate input', () => {
    const spread = projectTo2d([v(1, 0), v(0, 1), v(0.5, 0.5), v(0.9, 0.1)]);
    for (const p of spread) {
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThanOrEqual(1);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeLessThanOrEqual(1);
    }
    expect(projectTo2d([])).toEqual([]);
    expect(projectTo2d([v(1, 2)])).toEqual([{ x: 0.5, y: 0.5 }]);
    // All-identical vectors: zero variance on both axes → everything centers.
    const flat = projectTo2d([v(1, 1), v(1, 1), v(1, 1)]);
    for (const p of flat) expect(p).toEqual({ x: 0.5, y: 0.5 });
  });

  it('is deterministic', () => {
    const input = [v(1, 0, 0), v(0, 1, 0), v(0, 0, 1), v(0.7, 0.7, 0)];
    expect(projectTo2d(input)).toEqual(projectTo2d(input));
  });
});
