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
import { truncateEmbedding } from './embedding/truncate.js';
import type { EmbedderAdapter } from '@skillsregistry/domain/adapters';
import {
  CompositionDetector,
  ConfidenceGate,
  DeepSearch,
  Reranker,
} from '@skillsregistry/domain/intelligence';
import { PgVectorProvider } from '@skillsregistry/domain/providers';
import { CircuitBreaker } from '@skillsregistry/domain/resilience';
import type { McpAdapters, ResolvedMcpConfig } from '@skillsregistry/mcp';
import { resolveConfig as resolveMcpConfig } from '@skillsregistry/mcp';
import { BudgetMeter } from './budget/index.js';
import type { AppConfig } from './config.js';
import { adaptToPortLogger, type PinoLogger } from './logging/index.js';
import { buildMcpAdapters } from './mcp/index.js';
import { PublishToMothershipClient } from './migration/index.js';
import {
  NoopSearchLogger,
  PgSearchCache,
  SearchService,
  StubLlmAdapter,
  StubRerankerBackend,
} from './search/index.js';
import { SkillsClient } from './skills/index.js';
import { TrustClient } from './trust-client.js';
import { UpstreamClient } from './upstream-client/index.js';

export interface AppServices {
  /**
   * Root pino logger. Every module gets a `child({ module: '…' })` scoped
   * copy adapted to its port-logger shape. Also exposed on Hono contexts
   * per-request via the `requestLogger` middleware.
   */
  logger: PinoLogger;
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
  /**
   * Local-first skill read + single-tenant publish. T-2.11b's
   * `GET /v1/skills/:id` (local DB → upstream write-through cache) and
   * `POST /v1/skills` (INSERT into local `skills`) handlers call into
   * this. Air-gap: local misses surface as 404, not 503.
   */
  skillsClient: SkillsClient;
  /**
   * T-2.11c public `GET /v1/search` handler. Thin wrapper around the
   * domain `ConfidenceGate`, projecting `FindSkillResponse` into the
   * contract-shaped `SearchResponseSchema`. Local-only in MVP: deep
   * search + reranker default to disabled (stub LLM + reranker
   * backends throw if the flags are flipped without wiring real
   * backends). No upstream fallback — the mothership has no
   * `/v1/search` contract in `@skillsregistry/contracts/upstream.ts`.
   */
  searchService: SearchService;
  /**
   * T-2.13 MCP adapter bundle wired against `@skillsregistry/mcp`.
   * `search` delegates to `ConfidenceGate`, `skills` to `SkillsClient`,
   * `leaderboards` to `UpstreamClient` (empty in air-gap), `compositions`
   * always returns `{ found: false }` (no local composition support in
   * MVP). `recorder` writes to `mcp_invocations`; `afterResponse` is the
   * shared `NodeAfterResponse` so the write never blocks the request.
   */
  mcpAdapters: McpAdapters;
  /**
   * T-2.13 resolved MCP config (server identity, tool limits, batch cap).
   * Derived from `config.mcp` via `resolveConfig(...)` at boot.
   */
  mcpConfig: ResolvedMcpConfig;
}

/**
 * Build the wired services graph. Async because `createOllamaEmbedder`
 * probes the model's output dim.
 */
export async function buildAppServices(
  config: AppConfig,
  pool: Pool,
  logger: PinoLogger,
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
    logger: adaptToPortLogger(logger.child({ module: 'trust-client' })),
  });

  // 3j — budget meter. Cron + KV cache of `GET /v1/tenant/budget`. In
  //      air-gap mode `tenantId` is null and start()/refresh() no-op.
  //      main() calls start() after createApp() and stop() during shutdown.
  const budgetMeter = new BudgetMeter({
    upstream,
    kv,
    config: config.budget,
    tenantId: config.upstream?.tenantId ?? null,
    logger: adaptToPortLogger(logger.child({ module: 'budget-meter' })),
  });

  // 3k — migration client. Reads local rows + delegates to `upstream.publish`.
  //      Air-gap posture is inherited from `upstream`; no separate branch.
  const migrationClient = new PublishToMothershipClient({
    upstream,
    pool,
    logger: adaptToPortLogger(logger.child({ module: 'publish-to-mothership' })),
  });

  // 3l — skills client. Local-first read (with upstream write-through
  //      cache) + single-tenant publish. Air-gap-aware: on local miss
  //      mints `not_found` instead of propagating
  //      `upstream_not_configured`.
  const skillsClient = new SkillsClient({
    upstream,
    pool,
    logger: adaptToPortLogger(logger.child({ module: 'skills-client' })),
  });

  // 3m — search service. Wires PgVectorProvider + ConfidenceGate +
  //      PgSearchCache + NoopSearchLogger + stub LLM/reranker backends.
  //      MVP defaults: deepSearchEnabled=false, rerankerEnabled=false.
  //      The stub backends satisfy the ConfidenceGateOptions type contract
  //      but throw at call time — the flags gate the actual invocations.
  //      No upstream fallback in MVP (mothership has no /v1/search
  //      contract yet); local misses return low-confidence responses with
  //      whatever hits exist, or an empty result set.
  const provider = new PgVectorProvider({
    pool,
    fusionMode: config.search.fusionMode,
    tier1Threshold: config.search.tier1Threshold,
    tier2Threshold: config.search.tier2Threshold,
  });
  const searchCache = new PgSearchCache({
    kv,
    ttlTier1: config.search.cacheTtlTier1,
    ttlTier2: config.search.cacheTtlTier2,
    ttlTier3: config.search.cacheTtlTier3,
  });
  const searchLogger = new NoopSearchLogger();
  const embedFn = async (text: string): Promise<number[]> => {
    const vec = await embedder.embed(text);
    return truncateEmbedding(Array.from(vec));
  };
  const stubLlm = new StubLlmAdapter();
  const stubRerankerBackend = new StubRerankerBackend();
  // Circuit breakers are shared by module (gate builds its own for LLM
  // work); DeepSearch + Reranker + CompositionDetector each get their own.
  const deepSearchBreaker = new CircuitBreaker(
    config.search.circuitBreakerThreshold,
    config.search.circuitBreakerCooldownMs,
  );
  const rerankerBreaker = new CircuitBreaker(
    config.search.circuitBreakerThreshold,
    config.search.circuitBreakerCooldownMs,
  );
  const compositionBreaker = new CircuitBreaker(
    config.search.circuitBreakerThreshold,
    config.search.circuitBreakerCooldownMs,
  );
  const deepSearch = new DeepSearch({
    llm: stubLlm,
    provider,
    embedFn,
    circuitBreaker: deepSearchBreaker,
    fusionMode: config.search.fusionMode,
    tier2Threshold: config.search.tier2Threshold,
  });
  const reranker = new Reranker({
    pool,
    circuitBreaker: rerankerBreaker,
    backend: stubRerankerBackend,
  });
  const compositionDetector = new CompositionDetector({
    llm: stubLlm,
    provider,
    embedFn,
    circuitBreaker: compositionBreaker,
  });
  const confidenceGate = new ConfidenceGate({
    provider,
    embedFn,
    cache: searchCache,
    logger: searchLogger,
    pool,
    deepSearch,
    compositionDetector,
    reranker,
    fusionMode: config.search.fusionMode,
    tier1Threshold: config.search.tier1Threshold,
    tier2Threshold: config.search.tier2Threshold,
    deepSearchEnabled: config.search.deepSearchEnabled,
    rerankerEnabled: config.search.rerankerEnabled,
    circuitBreakerThreshold: config.search.circuitBreakerThreshold,
    circuitBreakerCooldownMs: config.search.circuitBreakerCooldownMs,
    defaultAppetite: config.search.defaultAppetite,
    llmIdentity: stubLlm.identity,
  });
  const searchService = new SearchService({
    gate: confidenceGate,
    afterResponse,
  });

  // 3n — MCP adapter bundle + resolved config for `POST /mcp` (T-2.13) and
  //      the discovery descriptor (T-2.14). `mcpAdapters` reuses the same
  //      ConfidenceGate as `searchService` so REST and MCP search agree
  //      byte-for-byte on the same query; `mcpConfig` is `resolveConfig()`
  //      applied to `config.mcp` so `@skillsregistry/mcp` defaults fill any
  //      absent knobs.
  const mcpAdapters = buildMcpAdapters({
    gate: confidenceGate,
    skillsClient,
    upstream,
    afterResponse,
    pool,
    invocationArgsMaxChars: config.mcp.invocationArgsMaxChars,
    writeEnabled: config.mcp.writeEnabled,
  });
  const mcpConfig = resolveMcpConfig({
    serverName: config.mcp.serverName,
    serverVersion: config.mcp.serverVersion,
    canonicalOrigin: config.mcp.canonicalOrigin,
    documentationUrl: config.mcp.documentationUrl,
    openapiUrl: config.mcp.openapiUrl,
    searchDefaultLimit: config.mcp.searchDefaultLimit,
    searchMaxLimit: config.mcp.searchMaxLimit,
    searchQueryMax: config.mcp.searchQueryMax,
    leaderboardDefaultLimit: config.mcp.leaderboardDefaultLimit,
    leaderboardMaxLimit: config.mcp.leaderboardMaxLimit,
    batchMax: config.mcp.batchMax,
    writeEnabled: config.mcp.writeEnabled,
  });

  return {
    logger,
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
    skillsClient,
    searchService,
    mcpAdapters,
    mcpConfig,
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
