import type { IndexDb } from './db.js';
import { trustMultiplier } from './db.js';
import { bytesToVector, dot, vectorToBytes, type Embedder } from './embedder.js';
import type { Memory, MemoryStatus } from './types.js';

const EMBED_BATCH = 16;

/** Below this cosine similarity a recall match is noise, not meaning. */
export const MIN_RECALL_SIMILARITY = 0.3;

export interface SemanticHit {
  memory: Memory;
  /** Raw cosine similarity in [-1, 1]; ordering additionally weighs trust and freshness. */
  similarity: number;
}

/**
 * The semantic layer over the vault: one vector per non-archived memory,
 * stored in the same derived SQLite index and diffed by body hash, so
 * hand-edits and imports get (re-)embedded on the next pass. Search is
 * brute-force cosine — exact, dependency-free, and instant at personal-vault
 * scale (a thousand facts is ~400k multiplications).
 */
export class Semantics {
  constructor(
    private readonly db: IndexDb,
    readonly embedder: Embedder,
  ) {}

  /** Bring vectors in line with the current files. Cheap when nothing changed. */
  async ensureFresh(): Promise<{ embedded: number; pruned: number }> {
    const pruned = this.db.pruneEmbeddings(this.embedder.model);
    const pending = this.db.pendingEmbeddings(this.embedder.model);
    let embedded = 0;
    for (let i = 0; i < pending.length; i += EMBED_BATCH) {
      const batch = pending.slice(i, i + EMBED_BATCH);
      const vectors = await this.embedder.embed(batch.map((p) => p.body));
      batch.forEach((entry, j) => {
        this.db.upsertEmbedding(entry.id, this.embedder.model, entry.hash, vectorToBytes(vectors[j]));
      });
      embedded += batch.length;
    }
    return { embedded, pruned };
  }

  async search(
    query: string,
    opts: { limit?: number; status?: MemoryStatus; scope?: string; minSimilarity?: number } = {},
  ): Promise<SemanticHit[]> {
    const [queryVector] = await this.embedder.embed([query]);
    const min = opts.minSimilarity ?? MIN_RECALL_SIMILARITY;
    const now = Date.now();
    return this.db
      .embeddingRows(this.embedder.model, { status: opts.status, scope: opts.scope })
      .map(({ memory, vector }) => ({ memory, similarity: dot(queryVector, bytesToVector(vector)) }))
      .filter((hit) => hit.similarity >= min)
      .sort(
        (a, b) =>
          b.similarity * trustMultiplier(b.memory, now, opts.scope) -
          a.similarity * trustMultiplier(a.memory, now, opts.scope),
      )
      .slice(0, opts.limit ?? 8);
  }

  /** Nearest non-archived neighbors of an already-embedded memory, by raw similarity. */
  neighbors(memory: Memory, limit = 8): SemanticHit[] {
    const bytes = this.db.getEmbedding(memory.id, this.embedder.model);
    if (!bytes) return [];
    const vector = bytesToVector(bytes);
    return this.db
      .embeddingRows(this.embedder.model)
      .filter((row) => row.memory.id !== memory.id)
      .map(({ memory: candidate, vector: v }) => ({
        memory: candidate,
        similarity: dot(vector, bytesToVector(v)),
      }))
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, limit);
  }

  /** Cosine similarity between two already-embedded memories; undefined if either lacks a vector. */
  similarityBetween(a: Memory, b: Memory): number | undefined {
    const va = this.db.getEmbedding(a.id, this.embedder.model);
    const vb = this.db.getEmbedding(b.id, this.embedder.model);
    if (!va || !vb) return undefined;
    return dot(bytesToVector(va), bytesToVector(vb));
  }
}
