// ══════════════════════════════════════════════════════════════════════════════
// QueueAdapter — background work dispatch
// ══════════════════════════════════════════════════════════════════════════════
//
// The mothership uses Cloudflare Queues for scan requests, sync jobs, and
// invocation writes. The local node uses an in-memory queue (MVP) or
// Postgres LISTEN/NOTIFY (post-MVP). Every queue producer in the domain
// layer routes through this interface.
//
// Design constraints:
//
//   - Fire-and-forget. `send()` returns after the message is enqueued, not
//     after it is processed. Backends that offer synchronous processing
//     (in-memory) still honor the fire-and-forget contract.
//   - Payloads are plain objects. Implementers serialize to JSON as needed.
//   - No ack / retry surface on the producer interface — those concerns
//     live on the consumer side (in the local app's queue-drainer).
//
// ══════════════════════════════════════════════════════════════════════════════

export interface QueueAdapter<T = unknown> {
  /**
   * Enqueue a single message. Idempotency is the caller's responsibility —
   * this interface makes no dedupe guarantee.
   */
  send(message: T): Promise<void>;

  /**
   * Enqueue a batch. Backends that cannot batch natively fall back to
   * looping `send()`. Order is not guaranteed across the batch.
   */
  sendBatch(messages: T[]): Promise<void>;
}
