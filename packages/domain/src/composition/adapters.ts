// ══════════════════════════════════════════════════════════════════════════════
// Composition — adapters wiring
// ══════════════════════════════════════════════════════════════════════════════
//
// Every composition function (`forkSkill`, `copySkill`, `createComposition`,
// `extendComposition`) writes a new skill row and needs to enqueue two
// follow-up jobs:
//
//   1. Embedding — regenerate the vector index for the new skill.
//   2. Cognium scan — Circle-IR trust analysis.
//
// The mothership binds these to CF Queues (`env.EMBED_QUEUE`,
// `env.COGNIUM_QUEUE`). Local runtimes plug in Postgres LISTEN/NOTIFY,
// in-memory, or any other backend that satisfies `QueueAdapter<T>`.
//
// ══════════════════════════════════════════════════════════════════════════════

import type { QueueAdapter, SqlPool } from '../adapters/index.js';

/** Message shape produced by composition when a skill needs embedding. */
export interface EmbedQueueMessage {
  skillId: string;
  action: 'embed';
}

/**
 * Message shape produced by composition when a skill needs a Cognium
 * (Circle-IR) trust scan. Mirrors mothership `CogniumSubmitMessage`.
 */
export interface CogniumScanQueueMessage {
  skillId: string;
  priority: 'normal' | 'high';
  timestamp: number;
}

/**
 * Runtime plumbing every composition function needs. Bundled once at boot
 * by the consumer so each function call stays a plain, straightforward
 * business operation rather than a wiring exercise.
 */
export interface CompositionAdapters {
  pool: SqlPool;
  embedQueue: QueueAdapter<EmbedQueueMessage>;
  scanQueue: QueueAdapter<CogniumScanQueueMessage>;
}
