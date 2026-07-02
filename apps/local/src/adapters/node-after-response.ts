// ══════════════════════════════════════════════════════════════════════════════
// NodeAfterResponse — AfterResponse over `setImmediate`.
// ══════════════════════════════════════════════════════════════════════════════
//
// The mothership binds `AfterResponse` to Cloudflare's
// `executionCtx.waitUntil()`. On Node we schedule the task via `setImmediate`
// so the response socket has already flushed before the background work runs.
//
// Task rejections are logged, never rethrown to the request handler — the
// interface documents that callers cannot rely on completion for correctness.
// Anything that needs failure semantics belongs on `QueueAdapter`.
//
// ══════════════════════════════════════════════════════════════════════════════

import type { AfterResponse } from '@skillsregistry/domain/adapters';

export interface NodeAfterResponseOptions {
  /** Called when a task rejects. Defaults to `console.error`. */
  onError?: (err: unknown) => void;
}

export class NodeAfterResponse implements AfterResponse {
  private readonly onError: (err: unknown) => void;

  constructor(options: NodeAfterResponseOptions = {}) {
    this.onError =
      options.onError ??
      ((err) => console.error('[after-response] task failed:', err));
  }

  run(task: () => Promise<void>): void {
    setImmediate(() => {
      task().catch((err) => this.onError(err));
    });
  }
}
