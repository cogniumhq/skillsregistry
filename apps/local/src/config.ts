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

export interface LogConfig {
  /** Log verbosity. Default `info`. */
  level: LogLevel;
}

export interface AppConfig {
  nodeEnv: NodeEnv;
  http: HttpConfig;
  postgres: PostgresConfig;
  admin: AdminConfig;
  embedder: EmbedderConfig;
  /** null when no mothership is configured (air-gap mode). */
  upstream: UpstreamConfig | null;
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
  EMBEDDER: 'EMBEDDER',
  OLLAMA_URL: 'OLLAMA_URL',
  OLLAMA_EMBEDDING_MODEL: 'OLLAMA_EMBEDDING_MODEL',
  MOTHERSHIP_URL: 'MOTHERSHIP_URL',
  MOTHERSHIP_API_KEY: 'MOTHERSHIP_API_KEY',
  TENANT_ID: 'TENANT_ID',
  UPSTREAM_SEARCH_FALLBACK: 'UPSTREAM_SEARCH_FALLBACK',
  LOG_LEVEL: 'LOG_LEVEL',
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

  const embedder = parseEmbedder(env, issues);
  const upstream = parseUpstream(env, issues);

  const log: LogConfig = {
    level: parseLogLevel(optional(env, ENV.LOG_LEVEL, 'info'), issues),
  };

  issues.throwIfAny();

  return { nodeEnv, http, postgres, admin, embedder, upstream, log };
}

/** Names of every env var this module reads. Handy for docs / tests. */
export const CONFIG_ENV_VARS: readonly string[] = Object.values(ENV);
