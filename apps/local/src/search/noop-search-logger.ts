// ══════════════════════════════════════════════════════════════════════════════
// NoopSearchLogger — `SearchLoggerPort` that drops every entry.
// ══════════════════════════════════════════════════════════════════════════════
//
// The mothership writes one row per search into `search_logs` for offline
// analysis (retrieval quality, cost attribution, deep-search hit rate).
// The local node has no such analytics surface in MVP — operators either
// don't want the row-per-request overhead or have their own logging
// pipeline (structured pino logs, Vector, etc.).
//
// This adapter satisfies the port contract by:
//   - Building a `SearchLogEntry` from the raw fields (`buildLogEntry`) so
//     that if an operator later wires a durable logger, the entry shape is
//     already correct.
//   - No-oping on `log()` — no persistence.
//   - Returning 0 for `estimateEmbeddingCost` — cost fields are surfaced
//     on the entry for consumer preference, but the local Ollama embedder
//     is host-local and has no per-token USD cost to attribute.
//
// A future `PgSearchLogger` (writing into a local `search_logs` mirror
// table) would replace this without touching any other module.
//
// ══════════════════════════════════════════════════════════════════════════════

import type {
  SearchLoggerInput,
  SearchLoggerPort,
} from '@skillsregistry/domain/adapters';
import type { SearchLogEntry } from '@skillsregistry/domain/types';

export class NoopSearchLogger implements SearchLoggerPort {
  buildLogEntry(input: SearchLoggerInput): SearchLogEntry {
    // Passthrough with sane defaults — the domain layer relies on the
    // shape, not on the logger populating every optional field.
    return {
      query: input.query ?? '',
      tenantId: input.tenantId ?? '',
      appetite: input.appetite,
      tier: input.tier ?? 1,
      cacheHit: input.cacheHit ?? false,
      topScore: input.topScore,
      gapToSecond: input.gapToSecond,
      clusterDensity: input.clusterDensity,
      keywordHits: input.keywordHits,
      resultCount: input.resultCount ?? 0,
      matchSource: input.matchSource,
      resultSkillIds: Array.isArray(input.resultSkillIds)
        ? input.resultSkillIds
        : [],
      totalLatencyMs: input.totalLatencyMs ?? 0,
      vectorSearchMs: input.vectorSearchMs,
      fullTextSearchMs: input.fullTextSearchMs,
      fusionStrategy: input.fusionStrategy,
      llmInvoked: input.llmInvoked ?? false,
      llmLatencyMs: input.llmLatencyMs,
      llmModel: input.llmModel,
      llmTokensUsed: input.llmTokensUsed,
      embeddingCost: input.embeddingCost ?? 0,
      llmCost: input.llmCost ?? 0,
      alternateQueriesUsed: input.alternateQueriesUsed,
      compositionDetected: input.compositionDetected ?? false,
      generationHintReturned: input.generationHintReturned ?? false,
    };
  }

  async log(_entry: SearchLogEntry): Promise<void> {
    // Intentional no-op. MVP local node has no `search_logs` mirror.
  }

  estimateEmbeddingCost(_queryLength: number): number {
    // Ollama is host-local — zero attributable per-token USD cost.
    return 0;
  }
}
