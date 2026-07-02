// ══════════════════════════════════════════════════════════════════════════════
// SearchLoggerPort — one-row-per-search analytics writer
// ══════════════════════════════════════════════════════════════════════════════
//
// Every findSkill call emits one `SearchLogEntry` after the response is
// built. The gate fires `log()` through the `AfterResponse` adapter so
// that persistence latency never bites the client.
//
// `buildLogEntry` is a pure transform kept on the port so callers can
// standardize the shape across runtimes (mothership packs a large struct;
// a local dev app might no-op). `estimateEmbeddingCost` is model-specific
// pricing math — kept here so the gate stays runtime-agnostic.
//
// ══════════════════════════════════════════════════════════════════════════════

import type { SearchLogEntry } from '../types.js';

/**
 * Untagged input to `buildLogEntry`. Wide open on purpose so implementations
 * can add their own fields (region, worker id, etc.) without churning the
 * port. Concrete loggers narrow this to their internal shape.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- open-ended log input
export type SearchLoggerInput = Record<string, any>;

export interface SearchLoggerPort {
  /**
   * Compose a `SearchLogEntry` from raw fields. The gate populates every
   * documented field; implementations may add extras. Kept as a pure
   * transform on the port so the shape is stable across runtimes.
   */
  buildLogEntry(input: SearchLoggerInput): SearchLogEntry;

  /**
   * Persist a log entry. Called via `AfterResponse` — implementations own
   * durability. Errors MUST be caught internally; a failed log must never
   * bubble into the request path.
   */
  log(entry: SearchLogEntry): Promise<void>;

  /**
   * Model-specific USD estimate for embedding one query of `queryLength`
   * characters. Used only for cost fields on the log entry; the gate does
   * no math on it.
   */
  estimateEmbeddingCost(queryLength: number): number;
}
