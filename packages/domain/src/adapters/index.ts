// ══════════════════════════════════════════════════════════════════════════════
// Adapter interfaces — the ports side of the hexagonal boundary.
// ══════════════════════════════════════════════════════════════════════════════
//
// The domain layer depends on these interfaces, never on concrete runtimes.
// Consumers (mothership Worker, local Node app) implement each interface
// against their host and inject the concrete objects at boot.
//
// Adding a new adapter is a MAJOR version bump — consumers must implement
// the new interface. Adding an optional method to an existing adapter is
// a MINOR bump. Method rename / removal is MAJOR.
//
// ══════════════════════════════════════════════════════════════════════════════

export type { KvAdapter } from './kv.js';
export type { QueueAdapter } from './queue.js';
export type { ArtifactAdapter, ArtifactWriteOptions } from './artifact.js';
export type {
  EmbedderAdapter,
  EmbedderIdentity,
} from './embedder.js';
export type { AfterResponse } from './after-response.js';
export type {
  SqlClient,
  SqlConnection,
  SqlPool,
  SqlQueryResult,
} from './sql.js';
export type { LlmAdapter, LlmCompleteInput } from './llm.js';
export type { SearchCachePort } from './search-cache.js';
export type {
  SearchLoggerPort,
  SearchLoggerInput,
} from './search-logger.js';
