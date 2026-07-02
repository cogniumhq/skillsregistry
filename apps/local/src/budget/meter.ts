// ══════════════════════════════════════════════════════════════════════════════
// BudgetMeter — nightly poll of `GET /v1/tenant/budget`, cached in kv_store.
// ══════════════════════════════════════════════════════════════════════════════
//
// Runs on a `node-cron` schedule (default `0 3 * * *`, host-local time). Each
// tick calls the mothership, converts the payload into a `BudgetSnapshot`
// (shared shape defined by T-2.8's `snapshotFromBudget`), and writes it to
// `kv_store` under `trust:budget:v1:<tenantId>` with a configurable TTL.
//
// Concerns owned here:
//
//   1. Cron scheduling  — `start()` schedules the recurring refresh; `stop()`
//                         tears it down for a clean shutdown. `start()` also
//                         fires one refresh immediately so the KV cache is
//                         warm before the first cron tick (see the T-2.11
//                         precheck flow — a cold cache degrades gracefully
//                         but a warm one is nicer).
//   2. Refresh          — `refresh()` is the doorway the admin route
//                         `POST /v1/admin/budget/refresh` (T-2.12) will call.
//                         It throws through to the caller so the operator
//                         sees the failure. The cron callback wraps it in a
//                         try/catch that logs + swallows so a mothership
//                         outage doesn't crash the process.
//   3. Threshold event  — when the fresh snapshot's `lowBalance` flips true,
//                         emit a structured `warn` event so operators can
//                         wire a pager. Only fires on transitions
//                         (`false → true` or first-ever refresh with
//                         `true`), never on repeat `true → true` ticks.
//   4. Read-through     — `getCached()` shares the same parser as T-2.8's
//                         `TrustClient.getCachedBudget()` via the exported
//                         `parseBudgetSnapshot()` so reader and writer can't
//                         drift.
//
// Air-gap mode: `tenantId === null` → `start()`, `refresh()`, and
// `getCached()` all no-op (or return null). Route wiring stays uniform.
//
// Testability: cron scheduling is behind a `Scheduler` interface. Tests
// inject a stub that captures the callback + exposes `trigger()` so the
// unit suite never touches wall-clock time.
//
// ══════════════════════════════════════════════════════════════════════════════

import type { KvAdapter } from '@skillsregistry/domain/adapters';
import cron, { type ScheduledTask } from 'node-cron';
import type { BudgetConfig } from '../config.js';
import {
  budgetKey,
  parseBudgetSnapshot,
  snapshotFromBudget,
  type BudgetSnapshot,
  type TrustClientLogger,
} from '../trust-client.js';
import type { UpstreamClient } from '../upstream-client/index.js';

/**
 * Abstract cron scheduler seam. `NodeCronScheduler` is the default (wraps
 * `node-cron`); tests inject a stub that captures the callback + exposes
 * `trigger()`.
 */
export interface Scheduler {
  schedule(cronExpr: string, callback: () => void | Promise<void>): ScheduledJob;
}

/** Handle returned by `Scheduler.schedule`. Idempotent stop. */
export interface ScheduledJob {
  stop(): void;
}

/** Default `Scheduler` implementation backed by `node-cron`. */
export class NodeCronScheduler implements Scheduler {
  schedule(
    cronExpr: string,
    callback: () => void | Promise<void>,
  ): ScheduledJob {
    const task: ScheduledTask = cron.schedule(cronExpr, () => {
      void callback();
    });
    return {
      stop: () => task.stop(),
    };
  }
}

const consoleLogger: TrustClientLogger = {
  info: (msg, meta) => console.log(`[budget-meter] ${msg}`, meta ?? ''),
  warn: (msg, meta) => console.warn(`[budget-meter] ${msg}`, meta ?? ''),
  error: (msg, meta) => console.error(`[budget-meter] ${msg}`, meta ?? ''),
};

export interface BudgetMeterOptions {
  upstream: UpstreamClient;
  kv: KvAdapter;
  config: BudgetConfig;
  /** null in air-gap mode; refresh/getCached become no-ops. */
  tenantId: string | null;
  scheduler?: Scheduler;
  logger?: TrustClientLogger;
}

export class BudgetMeter {
  private readonly upstream: UpstreamClient;
  private readonly kv: KvAdapter;
  private readonly config: BudgetConfig;
  private readonly tenantId: string | null;
  private readonly scheduler: Scheduler;
  private readonly logger: TrustClientLogger;
  private job: ScheduledJob | null = null;
  private lastLowBalance: boolean | null = null;

  constructor(options: BudgetMeterOptions) {
    this.upstream = options.upstream;
    this.kv = options.kv;
    this.config = options.config;
    this.tenantId = options.tenantId;
    this.scheduler = options.scheduler ?? new NodeCronScheduler();
    this.logger = options.logger ?? consoleLogger;
  }

  /**
   * Kick off the recurring refresh. Runs one refresh immediately so the KV
   * cache is warm at boot, then schedules the cron tick. Idempotent — a
   * second `start()` call is ignored (already scheduled). In air-gap mode
   * (`tenantId === null`) this is a no-op.
   */
  start(): void {
    if (this.tenantId === null) {
      this.logger.info('start: air-gap mode, skipping cron');
      return;
    }
    if (this.job !== null) {
      this.logger.info('start: already scheduled, skipping');
      return;
    }
    // Warm the cache. Failure is logged + swallowed so boot is not blocked
    // by a mothership outage — the mothership stays authoritative and
    // `T-2.11`'s precheck flow degrades gracefully when the cache is empty.
    void this.safeRefresh('boot');
    this.job = this.scheduler.schedule(this.config.refreshCron, () =>
      this.safeRefresh('cron'),
    );
    this.logger.info('start: scheduled', {
      cron: this.config.refreshCron,
      tenantId: this.tenantId,
    });
  }

  /** Tear down the cron job. Idempotent. */
  stop(): void {
    if (this.job === null) return;
    this.job.stop();
    this.job = null;
    this.logger.info('stop: cron torn down');
  }

  /**
   * Force a refresh. Throws through to the caller so the admin route
   * `POST /v1/admin/budget/refresh` (T-2.12) can surface the failure. Do
   * NOT use this in the cron callback — that wraps it in `safeRefresh` so a
   * transient mothership outage doesn't crash the process.
   *
   * In air-gap mode, returns `null` without calling the upstream.
   */
  async refresh(): Promise<BudgetSnapshot | null> {
    if (this.tenantId === null) return null;
    const response = await this.upstream.getBudget();
    const snapshot = snapshotFromBudget(response);
    await this.kv.put(
      budgetKey(this.tenantId),
      JSON.stringify(snapshot),
      this.config.ttlSeconds,
    );
    this.emitLowBalanceIfTransition(snapshot);
    this.lastLowBalance = snapshot.lowBalance;
    return snapshot;
  }

  /**
   * Read the current cached snapshot. Returns `null` on missing key,
   * malformed payload, KV throw, or air-gap. Never throws — cache is
   * best-effort by design (mirrors `TrustClient.getCachedBudget`).
   */
  async getCached(): Promise<BudgetSnapshot | null> {
    if (this.tenantId === null) return null;
    let raw: string | null;
    try {
      raw = await this.kv.get(budgetKey(this.tenantId));
    } catch (err) {
      this.logger.warn('kv read failed', {
        tenantId: this.tenantId,
        error: (err as Error).message,
      });
      return null;
    }
    if (raw === null) return null;
    return parseBudgetSnapshot(raw, this.logger);
  }

  // ── Internals ─────────────────────────────────────────────────────────

  private async safeRefresh(trigger: 'boot' | 'cron'): Promise<void> {
    try {
      const snapshot = await this.refresh();
      if (snapshot !== null) {
        this.logger.info('refresh: ok', {
          trigger,
          tenantId: snapshot.tenantId,
          plan: snapshot.plan,
          tokensRemaining: snapshot.tokensRemaining,
          lowBalance: snapshot.lowBalance,
        });
      }
    } catch (err) {
      this.logger.error('refresh failed', {
        trigger,
        tenantId: this.tenantId,
        error: (err as Error).message,
      });
    }
  }

  private emitLowBalanceIfTransition(snapshot: BudgetSnapshot): void {
    if (!snapshot.lowBalance) return;
    // Only emit on transitions: prior state was `false`, or this is the
    // first refresh in this process (`lastLowBalance === null`). Prevents
    // pager fatigue on repeat ticks while the tenant remains under the
    // 10% threshold.
    if (this.lastLowBalance === true) return;
    this.logger.warn('low balance', {
      tenantId: snapshot.tenantId,
      plan: snapshot.plan,
      tokensRemaining: snapshot.tokensRemaining,
      tokensTotal: snapshot.tokensTotal,
      tokensResetAt: snapshot.tokensResetAt,
    });
  }
}
