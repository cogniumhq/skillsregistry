// ══════════════════════════════════════════════════════════════════════════════
// Intelligence barrel — confidence gate, deep search, reranker, composition
// ══════════════════════════════════════════════════════════════════════════════
//
// The intelligence layer sits ABOVE the `SearchProvider` port. It owns
// tier-1/2/3 routing, cross-encoder reranking, LLM query expansion, and
// multi-skill composition detection. Every runtime binding is behind an
// adapter (`LlmAdapter`, `SearchCachePort`, `SearchLoggerPort`, `SqlPool`,
// `AfterResponse`) — the classes themselves are runtime-agnostic.
//
// ══════════════════════════════════════════════════════════════════════════════

export {
  ConfidenceGate,
  type ConfidenceGateOptions,
  type FindSkillOptions,
} from './confidence-gate.js';
export {
  DeepSearch,
  type DeepSearchOptions,
  type DeepSearchResult,
} from './deep-search.js';
export {
  CompositionDetector,
  type CompositionDetectorOptions,
} from './composition-detector.js';
export { Reranker, type RerankerOptions } from './reranker.js';
export {
  LiteLLMRerankBackend,
  type LiteLLMRerankBackendOptions,
  type RerankerBackend,
} from './reranker-backend.js';
