// ══════════════════════════════════════════════════════════════════════════════
// AppServices — composition root for the local node.
// ══════════════════════════════════════════════════════════════════════════════
//
// One factory that wires every adapter + the upstream client from an
// `AppConfig` + `pg.Pool`. Route modules receive the bundle and reach for
// what they need — no other module constructs adapters directly.
//
// Boot order (mirrors `main()`):
//
//   1. `createPool(config.postgres)` — done by caller.
//   2. `bootSchema(pool)` — done by caller.
//   3. `buildAppServices(config, pool)` — this factory.
//      3a. `ensureKvStoreTable(pool)` — provisions the local kv_store table.
//      3b. `PgKv` — KvAdapter over the pool.
//      3c. `MemoryQueue<EmbedQueueMessage>` — in-process embed queue.
//      3d. `MemoryQueue<CogniumScanQueueMessage>` — in-process scan queue.
//      3e. `FsArtifact` — filesystem artifact store.
//      3f. `NodeAfterResponse` — setImmediate-based deferred work.
//      3g. `createOllamaEmbedder(...)` — async probe → `EmbedderAdapter`.
//          `EmbedderConfig kind: 'upstream'` throws — no `/v1/embed`
//          contract exists yet (see T-1.7 coordination note in tasks.md).
//      3h. `UpstreamClient` — always instantiated; air-gap mode when
//          `config.upstream === null`.
//   4. `createApp(config, pool, services)` — mounts routes.
//
// Higher-level services (ConfidenceGate, McpAdapters, CompositionAdapters)
// are wired inside the route modules that use them (T-2.11 / T-2.12 /
// T-2.13); this factory only ships the adapter primitives.
//
// `closeAppServices(services)` is the graceful-shutdown counterpart. It
// currently only closes the queues (which is a no-op today but keeps the
// contract stable when a Postgres LISTEN/NOTIFY variant lands). The pool
// is closed by the caller.
//
// ══════════════════════════════════════════════════════════════════════════════

import type { Pool } from 'pg';
import type {
  CogniumScanQueueMessage,
  EmbedQueueMessage,
} from '@skillsregistry/domain/composition';
import {
  FsArtifact,
  MemoryQueue,
  NodeAfterResponse,
  PgKv,
  createOllamaEmbedder,
  ensureKvStoreTable,
} from './adapters/index.js';
import type { EmbedderAdapter } from '@skillsregistry/domain/adapters';
import { BudgetMeter } from './budget/index.js';
import type { AppConfig } from './config.js';
import { PublishToMothershipClient } from './migration/index.js';
import { TrustClient } from './trust-client.js';
import { UpstreamClient } from './upstream-client/index.js';

export interface AppServices {
  /** KvAdapter over Postgres `kv_store` — search cache, budget cache, misc. */
  kv: PgKv;
  /** In-process embed queue. */
  embedQueue: MemoryQueue<EmbedQueueMessage>;
  /** In-process cognium scan queue (submits to mothership post-fanout). */
  scanQueue: MemoryQueue<CogniumScanQueueMessage>;
  /** Filesystem artifact store rooted at `config.artifact.baseDir`. */
  artifact: FsArtifact;
  /** Embedder — Ollama in MVP; `upstream` mode throws (contract pending). */
  embedder: EmbedderAdapter;
  /** `setImmediate`-based post-response work (never on the request path). */
  afterResponse: NodeAfterResponse;
  /**
   * Sole doorway to `api.skillsregistry.net`. Air-gap when
   * `config.upstream === null` — every method throws
   * `UpstreamError('upstream_not_configured')`.
   */
  upstream: UpstreamClient;
  /**
   * Budget-aware wrapper around `upstream.trustScore(...)` — reads cached
   * budget from KV, short-circuits on exhaustion, persists returned score
   * onto the local `skills` row, and decrements the cached budget.
   * T-2.11's `POST /v1/trust/score` handler calls into this.
   */
  trustClient: TrustClient;
  /**
   * Nightly poller of `GET /v1/tenant/budget` → cached in `kv_store` under
   * the `trust:budget:v1:<tenantId>` key T-2.8 shares. T-2.12's
   * `GET /v1/admin/budget` reads via `getCached()` and
   * `POST /v1/admin/budget/refresh` calls `refresh()`. Started + stopped
   * by `main()`.
   */
  budgetMeter: BudgetMeter;
  /**
   * Migration door — reads a local `skills` row, promotes it to the
   * mothership via `upstream.publish(...)`, writes the returned mothership
   * identity + status back onto the same row. T-2.10's
   * `POST /v1/migrate/publish` handler calls into this. In air-gap mode
   * every call throws `UpstreamError('upstream_not_configured')` via the
   * underlying `UpstreamClient`.
   */
  migrationClient: PublishToMothershipClient;
}

/**
 * Build the wired services graph. Async because `createOllamaEmbedder`
 * probes the model's output dim.
 */
export async function buildAppServices(
  config: AppConfig,
  pool: Pool,
): Promise<AppServices> {
  // 3a — local kv_store DDL. Idempotent.
  await ensureKvStoreTable(pool);

  // 3b–3d — pool-bound + in-process adapters.
  const kv = new PgKv(pool);
  const embedQueue = new MemoryQueue<EmbedQueueMessage>();
  const scanQueue = new MemoryQueue<CogniumScanQueueMessage>();

  // 3e — filesystem artifact store. `FsArtifact` enforces absolute baseDir at
  //      construction; config parser already enforced it.
  const artifact = new FsArtifact(config.artifact.baseDir);

  // 3f — post-response work scheduler.
  const afterResponse = new NodeAfterResponse();

  // 3g — embedder. Upstream branch is intentionally unsupported until the
  //      mothership adds `/v1/embed` to `@skillsregistry/contracts/upstream`.
  //      Config parser accepts `EMBEDDER=upstream` for forward-compat; the
  //      factory rejects it here so misconfiguration surfaces at boot, not
  //      at the first search call.
  let embedder: EmbedderAdapter;
  if (config.embedder.kind === 'ollama') {
    embedder = await createOllamaEmbedder({
      url: config.embedder.url,
      model: config.embedder.model,
    });
  } else {
    throw new Error(
      "[services] EMBEDDER=upstream is not yet supported — the mothership /v1/embed contract is pending (see T-1.7). Set EMBEDDER=ollama.",
    );
  }

  // 3h — upstream client. Always constructed; `config.upstream === null`
  //      puts it in air-gap mode.
  const upstream = new UpstreamClient({ config: config.upstream });

  // 3i — trust client. Budget-aware wrapper. In air-gap mode the
  //      `tenantId` is null and score() just re-throws whatever the
  //      upstream call throws (`upstream_not_configured`); the client is
  //      still constructable so route wiring is uniform across modes.
  const trustClient = new TrustClient({
    upstream,
    kv,
    pool,
    tenantId: config.upstream?.tenantId ?? null,
  });

  // 3j — budget meter. Cron + KV cache of `GET /v1/tenant/budget`. In
  //      air-gap mode `tenantId` is null and start()/refresh() no-op.
  //      main() calls start() after createApp() and stop() during shutdown.
  const budgetMeter = new BudgetMeter({
    upstream,
    kv,
    config: config.budget,
    tenantId: config.upstream?.tenantId ?? null,
  });

  // 3k — migration client. Reads local rows + delegates to `upstream.publish`.
  //      Air-gap posture is inherited from `upstream`; no separate branch.
  const migrationClient = new PublishToMothershipClient({
    upstream,
    pool,
  });

  return {
    kv,
    embedQueue,
    scanQueue,
    artifact,
    embedder,
    afterResponse,
    upstream,
    trustClient,
    budgetMeter,
    migrationClient,
  };
}

/**
 * Graceful-shutdown counterpart. Callable multiple times — every step is
 * idempotent. The caller (`main()`) closes the pg pool separately since it
 * owns the pool's lifecycle.
 */
export async function closeAppServices(services: AppServices): Promise<void> {
  // Cron teardown — idempotent, safe to call even if start() was skipped
  // (air-gap) or never invoked (short-lived process).
  services.budgetMeter.stop();
  // No other durable state to flush today. Kept as a seam so a Postgres
  // LISTEN/NOTIFY queue variant can drain in-flight messages without
  // changing callers.
}
