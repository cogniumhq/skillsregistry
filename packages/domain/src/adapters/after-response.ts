// ══════════════════════════════════════════════════════════════════════════════
// AfterResponse — deferred work dispatcher
// ══════════════════════════════════════════════════════════════════════════════
//
// Search logs, quality-feedback writes, invocation counters, MCP invocation
// telemetry — every write that must NOT block the HTTP response goes through
// this adapter. The mothership binds it to Cloudflare's
// `executionCtx.waitUntil()`. The local node binds it to `setImmediate()`
// (Node) so the response socket closes before the background write runs.
//
// Contract:
//
//   - The adapter never awaits the task inline. Callers cannot rely on
//     completion for correctness.
//   - Task rejections are logged by the adapter (never rethrown to the
//     request handler). A domain service that needs failure semantics uses
//     `QueueAdapter`, not this.
//   - Tasks that outlive the process (e.g., during a graceful shutdown)
//     are cancelled; the adapter is not a durability guarantee.
//
// ══════════════════════════════════════════════════════════════════════════════

export interface AfterResponse {
  /**
   * Fire off a background task. Returns synchronously; the task may still
   * be running when the caller returns to its HTTP framework.
   */
  run(task: () => Promise<void>): void;
}
