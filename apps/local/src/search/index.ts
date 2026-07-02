// ══════════════════════════════════════════════════════════════════════════════
// Search module barrel — T-2.11c public `GET /v1/search` wiring.
// ══════════════════════════════════════════════════════════════════════════════

export { NoopSearchLogger } from './noop-search-logger.js';
export {
  cacheKey,
  PgSearchCache,
  type PgSearchCacheOptions,
} from './pg-search-cache.js';
export {
  projectResponse,
  SearchService,
  type ScoredSkill,
  type SearchMeta,
  type SearchOptions,
  type SearchResponse,
  type SearchServiceOptions,
} from './search-service.js';
export { StubLlmAdapter } from './stub-llm.js';
export { StubRerankerBackend } from './stub-reranker-backend.js';
