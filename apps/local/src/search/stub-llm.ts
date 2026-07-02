// ══════════════════════════════════════════════════════════════════════════════
// StubLlmAdapter — throw-on-call `LlmAdapter` for MVP local search.
// ══════════════════════════════════════════════════════════════════════════════
//
// `ConfidenceGate` requires an `LlmAdapter` in its constructor because deep
// search + composition detection call into one. The MVP local node ships
// with `deepSearchEnabled: false` (see SearchConfig) so those code paths
// are never reached, but the wiring still needs *some* concrete adapter.
//
// This stub satisfies the type contract and — if an operator ever flips
// `SEARCH_DEEP_ENABLED=true` without also wiring a real LLM binding —
// throws a clear, actionable error at the first request that tries to
// invoke it. That is preferable to silently returning empty completions
// (which would poison the rerank/composition path with garbage).
//
// Real LLM wiring for local deployments is deferred pending the mothership
// LiteLLM proxy contract (see T-1.7 coordination note in
// `.specifica/mvp/tasks.md`). When it lands, this file gets replaced by
// a `LiteLLMLlmAdapter` in the same directory.
//
// ══════════════════════════════════════════════════════════════════════════════

import type { LlmAdapter, LlmCompleteInput } from '@skillsregistry/domain/adapters';

export class StubLlmAdapter implements LlmAdapter {
  readonly identity = 'stub-llm:disabled';

  async complete(_input: LlmCompleteInput): Promise<string> {
    throw new Error(
      '[search] Deep search LLM was invoked but no LLM adapter is configured. ' +
        'The local node ships with SEARCH_DEEP_ENABLED=false by default. Either ' +
        'set SEARCH_DEEP_ENABLED=false (default) or wire a real LlmAdapter in ' +
        'services.ts.',
    );
  }
}
