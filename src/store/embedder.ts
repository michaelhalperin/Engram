import { join } from 'node:path';

/**
 * Semantic memory needs an embedding model, and Engram's rules for one are
 * strict: it must run locally (memories never leave the machine) and it must
 * be optional (the zero-dependency install keeps working without it). The
 * default is a small quantized sentence-transformer via @huggingface/transformers
 * — an optionalDependency — downloaded once into the vault's `models/` dir and
 * fully offline after that.
 *
 * The download only ever happens inside `engram embed`, never as a surprise
 * side effect of recall: until the user runs it once, every semantic feature
 * quietly falls back to keyword search.
 */

export interface Embedder {
  /** Identifies the model, so vectors from different models never mix. */
  readonly model: string;
  /** One L2-normalized vector per input text (cosine similarity = dot product). */
  embed(texts: string[]): Promise<Float32Array[]>;
}

export const DEFAULT_EMBED_MODEL = 'Xenova/all-MiniLM-L6-v2';

export interface EmbedderStatus {
  embedder?: Embedder;
  /** Why there is no embedder, phrased for humans (doctor, `engram embed`). */
  reason?: string;
}

export async function loadEmbedder(
  home: string,
  opts: { download?: boolean } = {},
): Promise<EmbedderStatus> {
  if (process.env.ENGRAM_NO_EMBED === '1') {
    return { reason: 'semantic search is disabled (ENGRAM_NO_EMBED=1)' };
  }
  let transformers: TransformersModule;
  try {
    // Non-literal specifier: the optional dependency must not be needed to
    // typecheck or build this package, only to run semantic features.
    const specifier = '@huggingface/transformers';
    transformers = (await import(specifier)) as TransformersModule;
  } catch {
    return {
      reason:
        'the optional dependency @huggingface/transformers is not installed — reinstall engram or `npm install @huggingface/transformers`',
    };
  }
  const model = process.env.ENGRAM_EMBED_MODEL ?? DEFAULT_EMBED_MODEL;
  transformers.env.cacheDir = join(home, 'models');
  // Only `engram embed` may download; everything else uses the cache or nothing.
  transformers.env.allowRemoteModels = opts.download === true;
  try {
    const pipe = await transformers.pipeline('feature-extraction', model, { dtype: 'q8' });
    return { embedder: wrapPipeline(model, pipe) };
  } catch (err) {
    return {
      reason: opts.download
        ? `could not load ${model}: ${(err as Error).message}`
        : `model ${model} is not downloaded yet — run \`engram embed\` once (~25 MB, then fully offline)`,
    };
  }
}

/** The slice of @huggingface/transformers we touch, typed structurally. */
interface TransformersModule {
  env: { cacheDir: string; allowRemoteModels: boolean };
  pipeline(task: 'feature-extraction', model: string, opts: { dtype: string }): Promise<unknown>;
}

type FeatureExtraction = (
  texts: string[],
  opts: { pooling: 'mean'; normalize: boolean },
) => Promise<{ dims: number[]; data: Float32Array; dispose?: () => void }>;

function wrapPipeline(model: string, pipe: unknown): Embedder {
  return {
    model,
    async embed(texts: string[]): Promise<Float32Array[]> {
      const tensor = await (pipe as FeatureExtraction)(texts, { pooling: 'mean', normalize: true });
      const [count, dims] = tensor.dims;
      const vectors: Float32Array[] = [];
      for (let i = 0; i < count; i++) {
        vectors.push(new Float32Array(tensor.data.slice(i * dims, (i + 1) * dims)));
      }
      tensor.dispose?.();
      return vectors;
    },
  };
}

export function vectorToBytes(vector: Float32Array): Uint8Array {
  return new Uint8Array(vector.buffer, vector.byteOffset, vector.byteLength);
}

export function bytesToVector(bytes: Uint8Array): Float32Array {
  return new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);
}

export function dot(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) return 0;
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += a[i] * b[i];
  return sum;
}
