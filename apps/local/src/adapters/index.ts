// ══════════════════════════════════════════════════════════════════════════════
// Node adapter surface — concrete implementations of `@skillsregistry/domain`
// adapter ports for the local single-node deployment.
// ══════════════════════════════════════════════════════════════════════════════

export { FsArtifact } from './fs-artifact.js';
export { MemoryQueue } from './memory-queue.js';
export type {
  MemoryQueueOptions,
  QueueHandler,
} from './memory-queue.js';
export { NodeAfterResponse } from './node-after-response.js';
export type { NodeAfterResponseOptions } from './node-after-response.js';
export {
  createOllamaEmbedder,
} from './ollama-embedder.js';
export type { OllamaEmbedderOptions } from './ollama-embedder.js';
export { ensureKvStoreTable, PG_KV_TABLE_DDL, PgKv } from './pg-kv.js';
