// ══════════════════════════════════════════════════════════════════════════════
// OllamaEmbedder — EmbedderAdapter over a local Ollama server.
// ══════════════════════════════════════════════════════════════════════════════
//
// Uses Ollama's `POST /api/embed` (batch) endpoint. Response shape:
//   { embeddings: number[][] }
//
// The model's output dimension is discovered at construction time via a
// single probe embed of ".". This is why the adapter has an async factory
// (`createOllamaEmbedder`) — `EmbedderIdentity.dim` must be known before
// the domain layer touches the adapter.
//
// The adapter is stateless per call — no request coalescing, no caching.
// Caching lives one layer up (search-cache, query-embedding-cache).
//
// ══════════════════════════════════════════════════════════════════════════════

import type {
  EmbedderAdapter,
  EmbedderIdentity,
} from '@skillsregistry/domain/adapters';

export interface OllamaEmbedderOptions {
  /** Ollama base URL, e.g. `http://localhost:11434`. */
  url: string;
  /** Model name, e.g. `nomic-embed-text`, `mxbai-embed-large`. */
  model: string;
  /**
   * Optional override for the identity string. Defaults to
   * `<model>@ollama-<dim>`. Consumers pass a custom identity when they need
   * cross-model write safety with a different naming convention.
   */
  identityOverride?: string;
  /** Optional fetch override for tests / interception. */
  fetchImpl?: typeof fetch;
}

interface EmbedResponse {
  embeddings?: number[][];
  embedding?: number[]; // legacy /api/embeddings shape
}

/**
 * Probe the Ollama server for the model's output dimension, then return a
 * ready-to-use `EmbedderAdapter`.
 */
export async function createOllamaEmbedder(
  options: OllamaEmbedderOptions,
): Promise<EmbedderAdapter> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const probe = await embedRaw(fetchImpl, options.url, options.model, ['.']);
  if (probe.length === 0 || probe[0]!.length === 0) {
    throw new Error(
      `[ollama-embedder] probe returned empty vector for model=${options.model}`,
    );
  }
  const dim = probe[0]!.length;
  const identity: EmbedderIdentity = {
    id: options.identityOverride ?? `${options.model}@ollama-${dim}`,
    dim,
  };
  return new OllamaEmbedder(options.url, options.model, identity, fetchImpl);
}

class OllamaEmbedder implements EmbedderAdapter {
  readonly identity: EmbedderIdentity;

  constructor(
    private readonly url: string,
    private readonly model: string,
    identity: EmbedderIdentity,
    private readonly fetchImpl: typeof fetch,
  ) {
    this.identity = identity;
  }

  async embed(text: string): Promise<Float32Array> {
    const rows = await embedRaw(this.fetchImpl, this.url, this.model, [text]);
    return this.toFloat32(rows[0]!, 0);
  }

  async embedBatch(texts: readonly string[]): Promise<Float32Array[]> {
    if (texts.length === 0) return [];
    const rows = await embedRaw(
      this.fetchImpl,
      this.url,
      this.model,
      Array.from(texts),
    );
    return rows.map((row, i) => this.toFloat32(row, i));
  }

  private toFloat32(row: number[], index: number): Float32Array {
    if (row.length !== this.identity.dim) {
      throw new Error(
        `[ollama-embedder] dim mismatch at index ${index}: expected ${this.identity.dim}, got ${row.length}`,
      );
    }
    return Float32Array.from(row);
  }
}

async function embedRaw(
  fetchImpl: typeof fetch,
  url: string,
  model: string,
  input: string[],
): Promise<number[][]> {
  const endpoint = `${stripTrailingSlash(url)}/api/embed`;
  const response = await fetchImpl(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, input }),
  });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(
      `[ollama-embedder] ${endpoint} responded ${response.status}: ${body || response.statusText}`,
    );
  }
  const data = (await response.json()) as EmbedResponse;
  if (Array.isArray(data.embeddings) && data.embeddings.length > 0) {
    return data.embeddings;
  }
  if (Array.isArray(data.embedding) && data.embedding.length > 0) {
    // legacy /api/embeddings response — wrap for uniform return shape
    return [data.embedding];
  }
  throw new Error(
    `[ollama-embedder] ${endpoint} returned no embeddings for ${input.length} input(s)`,
  );
}

function stripTrailingSlash(url: string): string {
  return url.endsWith('/') ? url.slice(0, -1) : url;
}
