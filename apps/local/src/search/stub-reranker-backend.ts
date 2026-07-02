// ══════════════════════════════════════════════════════════════════════════════
// StubRerankerBackend — throw-on-call `RerankerBackend` for MVP local search.
// ══════════════════════════════════════════════════════════════════════════════
//
// Same rationale as `StubLlmAdapter`: `ConfidenceGate` requires a `Reranker`
// (which requires a `RerankerBackend`) in its constructor. MVP ships with
// `rerankerEnabled: false` so the cross-encoder is never called. If an
// operator flips `SEARCH_RERANKER_ENABLED=true` without wiring a real
// backend, this throws immediately with a pointer to the right knob.
//
// Real reranker wiring (LiteLLM-shape or a self-hosted cross-encoder) is
// a follow-up alongside the mothership LiteLLM proxy contract. When it
// lands, this file gets replaced by `LiteLLMRerankBackend` construction
// in `services.ts`.
//
// ══════════════════════════════════════════════════════════════════════════════

import type { RerankerBackend } from '@skillsregistry/domain/intelligence';

export class StubRerankerBackend implements RerankerBackend {
  readonly identity = 'stub-reranker:disabled';

  async score(_query: string, _texts: string[]): Promise<number[]> {
    throw new Error(
      '[search] Reranker was invoked but no reranker backend is configured. ' +
        'The local node ships with SEARCH_RERANKER_ENABLED=false by default. ' +
        'Either set SEARCH_RERANKER_ENABLED=false (default) or wire a real ' +
        'RerankerBackend in services.ts.',
    );
  }
}
