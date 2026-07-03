// ══════════════════════════════════════════════════════════════════════════════
// Logging module — pino-backed root logger + port-logger adapter.
// ══════════════════════════════════════════════════════════════════════════════
//
// One pino instance per process. `createLogger(config)` builds it from
// `LogConfig` (level + format). `pretty` format shells to `pino-pretty` for
// local dev readability; `json` (default) writes one NDJSON line per event to
// stdout — the format container log collectors expect.
//
// Every domain module in `apps/local/` accepts an optional `Logger` port
// with the identical shape (see `TrustClientLogger`, `BootLogger`,
// `SkillsClientLogger`, `PublishToMothershipLogger` — same signature).
// `PortLogger` is that shared shape; `adaptToPortLogger(pino)` returns a value
// that satisfies every one of them so `buildAppServices` can pass one root
// logger (with per-module `child({ module: '…' })`) into every collaborator.
//
// pino's native call convention is `info(mergingObject, message)`; the domain
// ports use `info(message, meta)`. The adapter flips the arg order once so
// module code doesn't have to know pino exists.
//
// ══════════════════════════════════════════════════════════════════════════════

import pino, { type Logger as PinoLogger } from 'pino';
import type { LogConfig } from '../config.js';

export type { PinoLogger };

/**
 * Structured logger port used by every domain module. Compatible with
 * `TrustClientLogger`, `BootLogger`, `SkillsClientLogger`, and
 * `PublishToMothershipLogger` — they all share this shape.
 */
export interface PortLogger {
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}

/**
 * Build the root pino logger from LogConfig. `pretty` format resolves the
 * `pino-pretty` transport (dev only — dep lives in devDependencies); `json`
 * (default, production) writes NDJSON to stdout.
 *
 * Callers pass this into `buildAppServices` where it gets `child`-scoped
 * per module and adapted to `PortLogger` shape for downstream modules.
 */
export function createLogger(config: LogConfig): PinoLogger {
  if (config.format === 'pretty') {
    return pino({
      level: config.level,
      transport: {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'SYS:HH:MM:ss.l',
          ignore: 'pid,hostname',
        },
      },
    });
  }
  return pino({ level: config.level });
}

/**
 * Silent logger for tests. Discards every event without touching stdout.
 * Prefer this in test factories that don't assert on log output.
 */
export function createSilentLogger(): PinoLogger {
  return pino({ level: 'silent' });
}

/**
 * Adapt a pino logger to the `PortLogger` shape the domain modules expect.
 * Flips pino's `(mergingObject, message)` convention to the modules'
 * `(message, meta)` convention.
 *
 * Typical use: `adaptToPortLogger(root.child({ module: 'trust-client' }))`.
 */
export function adaptToPortLogger(logger: PinoLogger): PortLogger {
  return {
    info: (message, meta) => logger.info(meta ?? {}, message),
    warn: (message, meta) => logger.warn(meta ?? {}, message),
    error: (message, meta) => logger.error(meta ?? {}, message),
  };
}
