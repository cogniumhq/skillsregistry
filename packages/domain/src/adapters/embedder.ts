// ══════════════════════════════════════════════════════════════════════════════
// EmbedderAdapter — text-embedding abstraction
// ══════════════════════════════════════════════════════════════════════════════
//
// Search, ingestion, and index-time fan-out all pull embeddings from an
// EmbedderAdapter. The mothership binds this to `llm.c0g.io` (qwen3-embedding-
// 0.6B at MRL-512 per skillsregistry §10). The local node binds it to a
// local Ollama server by default, or budget-metered upstream when the
// operator opts in.
//
// Design constraints:
//
//   - The adapter picks its own model. The domain layer never names a model
//     directly. Model identity is surfaced via `id` for schema-driven
//     invalidation.
//   - Vectors are `Float32Array`. Length is fixed per adapter (typically 512
//     for MRL, 384 for legacy bge). The domain layer refuses to mix
//     dimensions across a single index.
//   - Batch is a first-class op. Backends that lack native batching loop
//     internally.
//   - Errors are exceptions. No silent zeros, no null-fill.
//
// ══════════════════════════════════════════════════════════════════════════════

export interface EmbedderIdentity {
  /**
   * Stable identity string, e.g. `qwen3-embedding-0.6B@mrl-512` or
   * `bge-small-en-v1.5@384`. Stored per-row in the DB so cross-model
   * writes fail loudly.
   */
  id: string;
  /** Output dimension. */
  dim: number;
}

export interface EmbedderAdapter {
  /**
   * Identity of the model producing vectors. Consumers persist this
   * alongside the vector to guarantee schema consistency.
   */
  readonly identity: EmbedderIdentity;

  /**
   * Embed a single text. Returns a vector of length `identity.dim`.
   */
  embed(text: string): Promise<Float32Array>;

  /**
   * Embed a batch of texts. Result order matches input order.
   * `result[i].length === identity.dim` for all `i`.
   */
  embedBatch(texts: readonly string[]): Promise<Float32Array[]>;
}
