// ══════════════════════════════════════════════════════════════════════════════
// Config module — env-var parsing + boot-time validation.
// ══════════════════════════════════════════════════════════════════════════════
//
// Every runtime knob is a documented env var. `loadConfig()` parses process.env,
// applies defaults, and fails loud with actionable messages if required values
// are missing or malformed. There is no hidden state — the returned AppConfig
// object is the sole source of truth for wiring downstream services.
//
// Design intent:
//
//   - Required vs optional is explicit. Required vars throw at boot.
//   - Every default is documented in the interface comment right next to the
//     field it produces.
//   - Errors accumulate. One `loadConfig()` call reports every missing/invalid
//     var in a single message, not the first one it hits.
//   - The parser is pure: pass in an env object, get back a config or throw.
//     Callers construct once at startup and pass the result down.
//
// ══════════════════════════════════════════════════════════════════════════════

import { isAbsolute, join } from 'node:path';
import cron from 'node-cron';

export type NodeEnv = 'development' | 'production' | 'test';
export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';

export interface HttpConfig {
  /** Bind host. Default `0.0.0.0`. */
  host: string;
  /** Bind port. Default `3000`. */
  port: number;
}

export interface PostgresConfig {
  /** libpq-compatible connection string. Required. */
  connectionString: string;
  /** Max pool connections. Default `10`. */
  poolMax: number;
  /** Statement timeout (ms). Default `30000`. */
  statementTimeoutMs: number;
}

export interface AdminConfig {
  /** Bearer token for admin routes. Required. */
  token: string;
}

export interface ArtifactConfig {
  /**
   * Absolute filesystem path for artifact storage. Default `${cwd}/data/artifacts`.
   * The directory is created on first write; the process must have write access.
   */
  baseDir: string;
}

export interface BudgetConfig {
  /**
   * `node-cron` schedule for the tenant-budget poller. Default `0 3 * * *`
   * (03:00 daily, host-local time). See `node-cron` README for syntax. The
   * meter also runs one refresh at startup so the KV cache is warm before
   * the first cron tick.
   */
  refreshCron: string;
  /**
   * TTL (seconds) applied to the cached snapshot in `kv_store`. Default
   * `93600` (26h) — deliberately longer than the daily cron cadence so a
   * missed refresh does not silently evict the row. Downstream readers
   * treat a missing row as "no cache" and skip the local precheck; the
   * mothership stays authoritative.
   */
  ttlSeconds: number;
}

export type EmbedderConfig =
  | { kind: 'ollama'; url: string; model: string }
  | { kind: 'upstream' };

export interface UpstreamConfig {
  /** Mothership base URL, e.g. `https://api.skillsregistry.net`. */
  baseUrl: string;
  /** API key issued by the mothership. */
  apiKey: string;
  /** Tenant ID scoped to this key. */
  tenantId: string;
  /** When true, `/v1/search` falls back to the mothership on low-confidence local hits. */
  searchFallback: boolean;
}

export interface SearchConfig {
  /**
   * Fusion mode passed to `PgVectorProvider` + `ConfidenceGate`. `linear`
   * blends normalized vector + full-text scores on a ~0..1 scale (mothership
   * default). `rrf` uses reciprocal-rank fusion on a ~0..0.033 scale.
   * Both classifiers must agree on mode.
   */
  fusionMode: 'linear' | 'rrf';
  /**
   * Tier-1 (HIGH confidence) score threshold. Defaults are mode-aware —
   * `linear` = 0.62, `rrf` = 0.03 — matching the mothership calibration
   * against a 91-fixture eval on production data.
   */
  tier1Threshold: number | undefined;
  /**
   * Tier-2 (MEDIUM confidence) threshold. Defaults `linear` = 0.58,
   * `rrf` = 0.018. See §10 A4 in the SkillsRegistry spec.
   */
  tier2Threshold: number | undefined;
  /**
   * When true, `ConfidenceGate` fires `DeepSearch` (LLM query-expansion +
   * composition detection) on tier-3 misses. MVP default `false` — the
   * local node ships without a wired LlmAdapter (see StubLlmAdapter).
   */
  deepSearchEnabled: boolean;
  /**
   * When true, `ConfidenceGate` reranks the top-N with the cross-encoder
   * backend after provider search. MVP default `false` — the local node
   * ships without a wired RerankerBackend (see StubRerankerBackend).
   */
  rerankerEnabled: boolean;
  /**
   * Default risk-appetite when the caller omits `?appetite=` on
   * `GET /v1/search`. Mothership default `balanced` (trust ≥ 0.5).
   */
  defaultAppetite: 'strict' | 'cautious' | 'balanced' | 'adventurous';
  /**
   * Circuit-breaker consecutive-failure threshold applied to LLM +
   * reranker calls. Mothership default 3.
   */
  circuitBreakerThreshold: number;
  /**
   * Circuit-breaker cooldown (ms) between reopen attempts. Mothership
   * default 30_000.
   */
  circuitBreakerCooldownMs: number;
  /**
   * TTL (seconds) applied to tier-1 search cache entries. Long — hot,
   * cheap-to-recompute path. Default 3600.
   */
  cacheTtlTier1: number;
  /** TTL (seconds) applied to tier-2 cache entries. Default 1800. */
  cacheTtlTier2: number;
  /**
   * TTL (seconds) applied to tier-3 cache entries. Short — expensive but
   * most likely to become stale. Default 600.
   */
  cacheTtlTier3: number;
}

export type LogFormat = 'json' | 'pretty';

export interface LogConfig {
  /** Log verbosity. Default `info`. */
  level: LogLevel;
  /**
   * Output format. `json` for production (structured, machine-parseable);
   * `pretty` for local dev (human-readable via `pino-pretty`). Default `json`.
   */
  format: LogFormat;
  /**
   * HTTP header the request-id middleware honors on inbound requests and
   * echoes on responses. Default `X-Request-Id`. Case-insensitive on read;
   * emitted verbatim on write.
   */
  requestIdHeader: string;
}

export interface McpConfig {
  /** Server name emitted in `initialize` + discovery. Default `skillsregistry-local`. */
  serverName: string;
  /** Server version emitted in `initialize` + discovery. Default `0.1.0`. */
  serverVersion: string;
  /**
   * Canonical origin for discovery URLs (`https://mcp.example.com`).
   * Optional — falls back to the request URL. Env: `MCP_CANONICAL_ORIGIN`.
   */
  canonicalOrigin: string | undefined;
  /** Optional documentation URL for discovery. Env: `MCP_DOCUMENTATION_URL`. */
  documentationUrl: string | undefined;
  /** Optional OpenAPI URL for discovery. Env: `MCP_OPENAPI_URL`. */
  openapiUrl: string | undefined;
  /** MCP_SEARCH_DEFAULT_LIMIT. Default 10. */
  searchDefaultLimit: number;
  /** MCP_SEARCH_MAX_LIMIT. Default 50. */
  searchMaxLimit: number;
  /** MCP_SEARCH_QUERY_MAX. Default 500 chars. */
  searchQueryMax: number;
  /** MCP_LEADERBOARD_DEFAULT_LIMIT. Default 20. */
  leaderboardDefaultLimit: number;
  /** MCP_LEADERBOARD_MAX_LIMIT. Default 100. */
  leaderboardMaxLimit: number;
  /** MCP_BATCH_MAX. Default 20. */
  batchMax: number;
  /**
   * MCP_INVOCATION_ARGS_MAX. Max serialized args length (chars) written to
   * `mcp_invocations.args`. Default 4096.
   */
  invocationArgsMaxChars: number;
}

export interface AppConfig {
  nodeEnv: NodeEnv;
  http: HttpConfig;
  postgres: PostgresConfig;
  admin: AdminConfig;
  artifact: ArtifactConfig;
  budget: BudgetConfig;
  embedder: EmbedderConfig;
  /** null when no mothership is configured (air-gap mode). */
  upstream: UpstreamConfig | null;
  search: SearchConfig;
  mcp: McpConfig;
  log: LogConfig;
}

// ─── env-var names ──────────────────────────────────────────────────────────

const ENV = {
  NODE_ENV: 'NODE_ENV',
  HOST: 'HOST',
  PORT: 'PORT',
  DATABASE_URL: 'DATABASE_URL',
  POSTGRES_POOL_MAX: 'POSTGRES_POOL_MAX',
  POSTGRES_STATEMENT_TIMEOUT_MS: 'POSTGRES_STATEMENT_TIMEOUT_MS',
  ADMIN_TOKEN: 'ADMIN_TOKEN',
  ARTIFACT_BASE_DIR: 'ARTIFACT_BASE_DIR',
  BUDGET_REFRESH_CRON: 'BUDGET_REFRESH_CRON',
  BUDGET_TTL_SECONDS: 'BUDGET_TTL_SECONDS',
  EMBEDDER: 'EMBEDDER',
  OLLAMA_URL: 'OLLAMA_URL',
  OLLAMA_EMBEDDING_MODEL: 'OLLAMA_EMBEDDING_MODEL',
  MOTHERSHIP_URL: 'MOTHERSHIP_URL',
  MOTHERSHIP_API_KEY: 'MOTHERSHIP_API_KEY',
  TENANT_ID: 'TENANT_ID',
  UPSTREAM_SEARCH_FALLBACK: 'UPSTREAM_SEARCH_FALLBACK',
  SEARCH_FUSION_MODE: 'SEARCH_FUSION_MODE',
  SEARCH_TIER1_THRESHOLD: 'SEARCH_TIER1_THRESHOLD',
  SEARCH_TIER2_THRESHOLD: 'SEARCH_TIER2_THRESHOLD',
  SEARCH_DEEP_ENABLED: 'SEARCH_DEEP_ENABLED',
  SEARCH_RERANKER_ENABLED: 'SEARCH_RERANKER_ENABLED',
  SEARCH_DEFAULT_APPETITE: 'SEARCH_DEFAULT_APPETITE',
  SEARCH_CIRCUIT_BREAKER_THRESHOLD: 'SEARCH_CIRCUIT_BREAKER_THRESHOLD',
  SEARCH_CIRCUIT_BREAKER_COOLDOWN_MS: 'SEARCH_CIRCUIT_BREAKER_COOLDOWN_MS',
  SEARCH_CACHE_TTL_TIER1: 'SEARCH_CACHE_TTL_TIER1',
  SEARCH_CACHE_TTL_TIER2: 'SEARCH_CACHE_TTL_TIER2',
  SEARCH_CACHE_TTL_TIER3: 'SEARCH_CACHE_TTL_TIER3',
  MCP_SERVER_NAME: 'MCP_SERVER_NAME',
  MCP_SERVER_VERSION: 'MCP_SERVER_VERSION',
  MCP_CANONICAL_ORIGIN: 'MCP_CANONICAL_ORIGIN',
  MCP_DOCUMENTATION_URL: 'MCP_DOCUMENTATION_URL',
  MCP_OPENAPI_URL: 'MCP_OPENAPI_URL',
  MCP_SEARCH_DEFAULT_LIMIT: 'MCP_SEARCH_DEFAULT_LIMIT',
  MCP_SEARCH_MAX_LIMIT: 'MCP_SEARCH_MAX_LIMIT',
  MCP_SEARCH_QUERY_MAX: 'MCP_SEARCH_QUERY_MAX',
  MCP_LEADERBOARD_DEFAULT_LIMIT: 'MCP_LEADERBOARD_DEFAULT_LIMIT',
  MCP_LEADERBOARD_MAX_LIMIT: 'MCP_LEADERBOARD_MAX_LIMIT',
  MCP_BATCH_MAX: 'MCP_BATCH_MAX',
  MCP_INVOCATION_ARGS_MAX: 'MCP_INVOCATION_ARGS_MAX',
  LOG_LEVEL: 'LOG_LEVEL',
  LOG_FORMAT: 'LOG_FORMAT',
  LOG_REQUEST_ID_HEADER: 'LOG_REQUEST_ID_HEADER',
} as const;

// ─── errors ─────────────────────────────────────────────────────────────────

export class ConfigError extends Error {
  readonly issues: readonly string[];
  constructor(issues: readonly string[]) {
    super(
      `Invalid configuration (${issues.length} issue${issues.length === 1 ? '' : 's'}):\n` +
        issues.map((i) => `  - ${i}`).join('\n'),
    );
    this.name = 'ConfigError';
    this.issues = issues;
  }
}

// ─── parser ─────────────────────────────────────────────────────────────────

export type EnvSource = Readonly<Record<string, string | undefined>>;

class Issues {
  private readonly items: string[] = [];
  add(name: string, message: string): void {
    this.items.push(`${name}: ${message}`);
  }
  throwIfAny(): void {
    if (this.items.length > 0) throw new ConfigError(this.items);
  }
}

function required(env: EnvSource, key: string, issues: Issues): string {
  const raw = env[key];
  if (raw === undefined || raw.trim() === '') {
    issues.add(key, 'required');
    return '';
  }
  return raw.trim();
}

function optional(env: EnvSource, key: string, fallback: string): string {
  const raw = env[key];
  return raw === undefined || raw.trim() === '' ? fallback : raw.trim();
}

function parseInt10(name: string, raw: string, issues: Issues, min = 1): number {
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < min) {
    issues.add(name, `must be an integer ≥ ${min} (got "${raw}")`);
    return min;
  }
  return n;
}

function parseBool(name: string, raw: string, issues: Issues): boolean {
  const v = raw.toLowerCase();
  if (v === 'true' || v === '1' || v === 'yes') return true;
  if (v === 'false' || v === '0' || v === 'no') return false;
  issues.add(name, `must be a boolean (true|false|1|0|yes|no) — got "${raw}"`);
  return false;
}

function parseNodeEnv(raw: string, issues: Issues): NodeEnv {
  if (raw === 'development' || raw === 'production' || raw === 'test') return raw;
  issues.add(ENV.NODE_ENV, `must be development|production|test (got "${raw}")`);
  return 'development';
}

function parseLogLevel(raw: string, issues: Issues): LogLevel {
  const allowed: LogLevel[] = ['trace', 'debug', 'info', 'warn', 'error', 'fatal'];
  if ((allowed as string[]).includes(raw)) return raw as LogLevel;
  issues.add(ENV.LOG_LEVEL, `must be one of ${allowed.join('|')} (got "${raw}")`);
  return 'info';
}

function parseLogFormat(raw: string, issues: Issues): LogFormat {
  if (raw === 'json' || raw === 'pretty') return raw;
  issues.add(ENV.LOG_FORMAT, `must be json|pretty (got "${raw}")`);
  return 'json';
}

// RFC 7230 §3.2.6 field-name = 1*tchar; keep the set small + safe.
const HEADER_NAME_RE = /^[A-Za-z][A-Za-z0-9-]{0,63}$/;

function parseRequestIdHeader(raw: string, issues: Issues): string {
  if (HEADER_NAME_RE.test(raw)) return raw;
  issues.add(
    ENV.LOG_REQUEST_ID_HEADER,
    `must be a valid HTTP header name (RFC 7230 tchar, ≤64 chars) — got "${raw}"`,
  );
  return 'X-Request-Id';
}

function parseBudget(env: EnvSource, issues: Issues): BudgetConfig {
  const refreshCron = optional(env, ENV.BUDGET_REFRESH_CRON, '0 3 * * *');
  if (!cron.validate(refreshCron)) {
    issues.add(
      ENV.BUDGET_REFRESH_CRON,
      `must be a valid cron expression (got "${refreshCron}")`,
    );
  }
  const ttlSeconds = parseInt10(
    ENV.BUDGET_TTL_SECONDS,
    optional(env, ENV.BUDGET_TTL_SECONDS, '93600'),
    issues,
    60,
  );
  return { refreshCron, ttlSeconds };
}

function parseArtifact(env: EnvSource, issues: Issues): ArtifactConfig {
  const raw = env[ENV.ARTIFACT_BASE_DIR]?.trim();
  const baseDir =
    raw === undefined || raw === '' ? join(process.cwd(), 'data', 'artifacts') : raw;
  if (!isAbsolute(baseDir)) {
    issues.add(
      ENV.ARTIFACT_BASE_DIR,
      `must be an absolute path (got "${baseDir}")`,
    );
    return { baseDir: join(process.cwd(), 'data', 'artifacts') };
  }
  return { baseDir };
}

function parseEmbedder(env: EnvSource, issues: Issues): EmbedderConfig {
  const kind = optional(env, ENV.EMBEDDER, 'ollama');
  if (kind === 'ollama') {
    return {
      kind: 'ollama',
      url: optional(env, ENV.OLLAMA_URL, 'http://localhost:11434'),
      model: optional(env, ENV.OLLAMA_EMBEDDING_MODEL, 'nomic-embed-text'),
    };
  }
  if (kind === 'upstream') {
    return { kind: 'upstream' };
  }
  issues.add(ENV.EMBEDDER, `must be ollama|upstream (got "${kind}")`);
  return { kind: 'ollama', url: 'http://localhost:11434', model: 'nomic-embed-text' };
}

function parseFloatMin(
  name: string,
  raw: string,
  issues: Issues,
  min = 0,
  max = 1,
): number {
  const n = Number.parseFloat(raw);
  if (!Number.isFinite(n) || n < min || n > max) {
    issues.add(
      name,
      `must be a number between ${min} and ${max} (got "${raw}")`,
    );
    return min;
  }
  return n;
}

function parseAppetite(
  raw: string,
  issues: Issues,
): SearchConfig['defaultAppetite'] {
  if (
    raw === 'strict' ||
    raw === 'cautious' ||
    raw === 'balanced' ||
    raw === 'adventurous'
  ) {
    return raw;
  }
  issues.add(
    ENV.SEARCH_DEFAULT_APPETITE,
    `must be strict|cautious|balanced|adventurous (got "${raw}")`,
  );
  return 'balanced';
}

function parseSearch(env: EnvSource, issues: Issues): SearchConfig {
  const fusionRaw = optional(env, ENV.SEARCH_FUSION_MODE, 'linear');
  let fusionMode: SearchConfig['fusionMode'];
  if (fusionRaw === 'linear' || fusionRaw === 'rrf') {
    fusionMode = fusionRaw;
  } else {
    issues.add(
      ENV.SEARCH_FUSION_MODE,
      `must be linear|rrf (got "${fusionRaw}")`,
    );
    fusionMode = 'linear';
  }

  const t1Raw = env[ENV.SEARCH_TIER1_THRESHOLD]?.trim();
  const t2Raw = env[ENV.SEARCH_TIER2_THRESHOLD]?.trim();
  const tier1Threshold =
    t1Raw === undefined || t1Raw === ''
      ? undefined
      : parseFloatMin(ENV.SEARCH_TIER1_THRESHOLD, t1Raw, issues);
  const tier2Threshold =
    t2Raw === undefined || t2Raw === ''
      ? undefined
      : parseFloatMin(ENV.SEARCH_TIER2_THRESHOLD, t2Raw, issues);

  const deepSearchEnabled = parseBool(
    ENV.SEARCH_DEEP_ENABLED,
    optional(env, ENV.SEARCH_DEEP_ENABLED, 'false'),
    issues,
  );
  const rerankerEnabled = parseBool(
    ENV.SEARCH_RERANKER_ENABLED,
    optional(env, ENV.SEARCH_RERANKER_ENABLED, 'false'),
    issues,
  );

  const defaultAppetite = parseAppetite(
    optional(env, ENV.SEARCH_DEFAULT_APPETITE, 'balanced'),
    issues,
  );

  const circuitBreakerThreshold = parseInt10(
    ENV.SEARCH_CIRCUIT_BREAKER_THRESHOLD,
    optional(env, ENV.SEARCH_CIRCUIT_BREAKER_THRESHOLD, '3'),
    issues,
  );
  const circuitBreakerCooldownMs = parseInt10(
    ENV.SEARCH_CIRCUIT_BREAKER_COOLDOWN_MS,
    optional(env, ENV.SEARCH_CIRCUIT_BREAKER_COOLDOWN_MS, '30000'),
    issues,
    100,
  );

  const cacheTtlTier1 = parseInt10(
    ENV.SEARCH_CACHE_TTL_TIER1,
    optional(env, ENV.SEARCH_CACHE_TTL_TIER1, '3600'),
    issues,
    1,
  );
  const cacheTtlTier2 = parseInt10(
    ENV.SEARCH_CACHE_TTL_TIER2,
    optional(env, ENV.SEARCH_CACHE_TTL_TIER2, '1800'),
    issues,
    1,
  );
  const cacheTtlTier3 = parseInt10(
    ENV.SEARCH_CACHE_TTL_TIER3,
    optional(env, ENV.SEARCH_CACHE_TTL_TIER3, '600'),
    issues,
    1,
  );

  return {
    fusionMode,
    tier1Threshold,
    tier2Threshold,
    deepSearchEnabled,
    rerankerEnabled,
    defaultAppetite,
    circuitBreakerThreshold,
    circuitBreakerCooldownMs,
    cacheTtlTier1,
    cacheTtlTier2,
    cacheTtlTier3,
  };
}

function parseMcp(env: EnvSource, issues: Issues): McpConfig {
  const serverName = optional(env, ENV.MCP_SERVER_NAME, 'skillsregistry-local');
  const serverVersion = optional(env, ENV.MCP_SERVER_VERSION, '0.1.0');
  const canonicalRaw = env[ENV.MCP_CANONICAL_ORIGIN]?.trim();
  const canonicalOrigin =
    canonicalRaw === undefined || canonicalRaw === '' ? undefined : canonicalRaw;
  const docRaw = env[ENV.MCP_DOCUMENTATION_URL]?.trim();
  const documentationUrl =
    docRaw === undefined || docRaw === '' ? undefined : docRaw;
  const openapiRaw = env[ENV.MCP_OPENAPI_URL]?.trim();
  const openapiUrl =
    openapiRaw === undefined || openapiRaw === '' ? undefined : openapiRaw;

  const searchDefaultLimit = parseInt10(
    ENV.MCP_SEARCH_DEFAULT_LIMIT,
    optional(env, ENV.MCP_SEARCH_DEFAULT_LIMIT, '10'),
    issues,
  );
  const searchMaxLimit = parseInt10(
    ENV.MCP_SEARCH_MAX_LIMIT,
    optional(env, ENV.MCP_SEARCH_MAX_LIMIT, '50'),
    issues,
  );
  const searchQueryMax = parseInt10(
    ENV.MCP_SEARCH_QUERY_MAX,
    optional(env, ENV.MCP_SEARCH_QUERY_MAX, '500'),
    issues,
  );
  const leaderboardDefaultLimit = parseInt10(
    ENV.MCP_LEADERBOARD_DEFAULT_LIMIT,
    optional(env, ENV.MCP_LEADERBOARD_DEFAULT_LIMIT, '20'),
    issues,
  );
  const leaderboardMaxLimit = parseInt10(
    ENV.MCP_LEADERBOARD_MAX_LIMIT,
    optional(env, ENV.MCP_LEADERBOARD_MAX_LIMIT, '100'),
    issues,
  );
  const batchMax = parseInt10(
    ENV.MCP_BATCH_MAX,
    optional(env, ENV.MCP_BATCH_MAX, '20'),
    issues,
  );
  const invocationArgsMaxChars = parseInt10(
    ENV.MCP_INVOCATION_ARGS_MAX,
    optional(env, ENV.MCP_INVOCATION_ARGS_MAX, '4096'),
    issues,
    64,
  );

  return {
    serverName,
    serverVersion,
    canonicalOrigin,
    documentationUrl,
    openapiUrl,
    searchDefaultLimit,
    searchMaxLimit,
    searchQueryMax,
    leaderboardDefaultLimit,
    leaderboardMaxLimit,
    batchMax,
    invocationArgsMaxChars,
  };
}

function parseUpstream(env: EnvSource, issues: Issues): UpstreamConfig | null {
  const baseUrl = env[ENV.MOTHERSHIP_URL]?.trim();
  const apiKey = env[ENV.MOTHERSHIP_API_KEY]?.trim();
  const tenantId = env[ENV.TENANT_ID]?.trim();

  // Air-gap mode: nothing set.
  if (!baseUrl && !apiKey && !tenantId) return null;

  // Partial config = misconfig. All three must be present together.
  if (!baseUrl) issues.add(ENV.MOTHERSHIP_URL, 'required when any upstream var is set');
  if (!apiKey) issues.add(ENV.MOTHERSHIP_API_KEY, 'required when any upstream var is set');
  if (!tenantId) issues.add(ENV.TENANT_ID, 'required when any upstream var is set');

  const searchFallbackRaw = env[ENV.UPSTREAM_SEARCH_FALLBACK]?.trim();
  const searchFallback =
    searchFallbackRaw === undefined || searchFallbackRaw === ''
      ? true
      : parseBool(ENV.UPSTREAM_SEARCH_FALLBACK, searchFallbackRaw, issues);

  return {
    baseUrl: baseUrl ?? '',
    apiKey: apiKey ?? '',
    tenantId: tenantId ?? '',
    searchFallback,
  };
}

/**
 * Parse the process environment into an AppConfig, or throw ConfigError
 * with every issue enumerated.
 *
 * @param env - Environment source. Defaults to `process.env`.
 */
export function loadConfig(env: EnvSource = process.env): AppConfig {
  const issues = new Issues();

  const nodeEnv = parseNodeEnv(optional(env, ENV.NODE_ENV, 'development'), issues);

  const http: HttpConfig = {
    host: optional(env, ENV.HOST, '0.0.0.0'),
    port: parseInt10(ENV.PORT, optional(env, ENV.PORT, '3000'), issues),
  };

  const postgres: PostgresConfig = {
    connectionString: required(env, ENV.DATABASE_URL, issues),
    poolMax: parseInt10(
      ENV.POSTGRES_POOL_MAX,
      optional(env, ENV.POSTGRES_POOL_MAX, '10'),
      issues,
    ),
    statementTimeoutMs: parseInt10(
      ENV.POSTGRES_STATEMENT_TIMEOUT_MS,
      optional(env, ENV.POSTGRES_STATEMENT_TIMEOUT_MS, '30000'),
      issues,
      100,
    ),
  };

  const admin: AdminConfig = {
    token: required(env, ENV.ADMIN_TOKEN, issues),
  };

  const artifact = parseArtifact(env, issues);
  const budget = parseBudget(env, issues);
  const embedder = parseEmbedder(env, issues);
  const upstream = parseUpstream(env, issues);
  const search = parseSearch(env, issues);
  const mcp = parseMcp(env, issues);

  const log: LogConfig = {
    level: parseLogLevel(optional(env, ENV.LOG_LEVEL, 'info'), issues),
    format: parseLogFormat(optional(env, ENV.LOG_FORMAT, 'json'), issues),
    requestIdHeader: parseRequestIdHeader(
      optional(env, ENV.LOG_REQUEST_ID_HEADER, 'X-Request-Id'),
      issues,
    ),
  };

  issues.throwIfAny();

  return {
    nodeEnv,
    http,
    postgres,
    admin,
    artifact,
    budget,
    embedder,
    upstream,
    search,
    mcp,
    log,
  };
}

/** Names of every env var this module reads. Handy for docs / tests. */
export const CONFIG_ENV_VARS: readonly string[] = Object.values(ENV);
