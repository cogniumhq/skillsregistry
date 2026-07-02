// ══════════════════════════════════════════════════════════════════════════════
// MemoryQueue — QueueAdapter over an in-process array.
// ══════════════════════════════════════════════════════════════════════════════
//
// MVP queue. Fine for a single-node local install; a Postgres LISTEN/NOTIFY
// variant lands post-MVP for durability across restarts.
//
// Producer contract (from `QueueAdapter<T>`): fire-and-forget `send()` /
// `sendBatch()`. Consumer contract is orthogonal — the local app registers a
// handler via `onMessage()`; messages published before a handler is bound
// are buffered and drained when one is.
//
// ══════════════════════════════════════════════════════════════════════════════

import type { QueueAdapter } from '@skillsregistry/domain/adapters';

export type QueueHandler<T> = (message: T) => Promise<void>;

export interface MemoryQueueOptions {
  /** Called when a handler throws. Defaults to `console.error`. */
  onError?: (err: unknown, message: unknown) => void;
}

export class MemoryQueue<T> implements QueueAdapter<T> {
  private handler: QueueHandler<T> | null = null;
  private readonly buffered: T[] = [];
  private readonly onError: (err: unknown, message: unknown) => void;

  constructor(options: MemoryQueueOptions = {}) {
    this.onError =
      options.onError ??
      ((err, message) =>
        console.error('[memory-queue] handler failed:', err, message));
  }

  async send(message: T): Promise<void> {
    if (this.handler !== null) {
      this.dispatch(this.handler, message);
    } else {
      this.buffered.push(message);
    }
  }

  async sendBatch(messages: T[]): Promise<void> {
    for (const m of messages) {
      await this.send(m);
    }
  }

  /**
   * Register the single consumer handler. Buffered messages drain
   * asynchronously on the next microtask.
   */
  onMessage(handler: QueueHandler<T>): void {
    this.handler = handler;
    const drained = this.buffered.splice(0);
    for (const m of drained) this.dispatch(handler, m);
  }

  /** How many messages are buffered awaiting a handler. Testing hook. */
  pending(): number {
    return this.buffered.length;
  }

  private dispatch(handler: QueueHandler<T>, message: T): void {
    queueMicrotask(() => {
      handler(message).catch((err) => this.onError(err, message));
    });
  }
}
