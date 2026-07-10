/** Canonical pgvector storage width after the §10 A10 halfvec cutover. */
export const STORED_EMBEDDING_DIMS = 512;

/**
 * Truncate higher-dimensional embedder output to the stored column width.
 * Local Ollama models (e.g. nomic-embed-text @ 768-d) need this MRL-style
 * slice so query vectors match `skill_embeddings.embedding halfvec(512)`.
 */
export function truncateEmbedding(
  vec: number[],
  dims: number = STORED_EMBEDDING_DIMS,
): number[] {
  if (vec.length === dims) return vec;
  if (vec.length > dims) return vec.slice(0, dims);
  throw new Error(
    `embedding length ${vec.length} is shorter than required ${dims}`,
  );
}
