// ══════════════════════════════════════════════════════════════════════════════
// Providers barrel — SearchProvider port + PgVectorProvider adapter
// ══════════════════════════════════════════════════════════════════════════════
//
// The intelligence layer sits ABOVE `SearchProvider`. The concrete
// `PgVectorProvider` is the pgvector implementation that ships with the
// domain package; alternate providers (Meilisearch, etc.) can plug in
// against the same port without recompiling the intelligence code.
//
// ══════════════════════════════════════════════════════════════════════════════

export type { SearchProvider } from './search-provider.js';
export {
  PgVectorProvider,
  type PgVectorProviderOptions,
  type EmbeddingStamps,
} from './pgvector-provider.js';
