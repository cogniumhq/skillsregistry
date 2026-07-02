import { describe, expect, it, vi } from 'vitest';
import { MemoryQueue } from './memory-queue.js';

/** Wait one microtask + one macrotask so `queueMicrotask` handlers run. */
async function flush(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

describe('MemoryQueue', () => {
  it('buffers messages sent before a handler is registered', async () => {
    const queue = new MemoryQueue<string>();
    await queue.send('a');
    await queue.send('b');
    expect(queue.pending()).toBe(2);
  });

  it('drains buffered messages when the handler is bound', async () => {
    const queue = new MemoryQueue<string>();
    await queue.send('a');
    await queue.send('b');
    const seen: string[] = [];
    queue.onMessage(async (m) => {
      seen.push(m);
    });
    expect(queue.pending()).toBe(0);
    await flush();
    expect(seen).toEqual(['a', 'b']);
  });

  it('dispatches new messages immediately once a handler is bound', async () => {
    const queue = new MemoryQueue<string>();
    const seen: string[] = [];
    queue.onMessage(async (m) => {
      seen.push(m);
    });
    await queue.send('x');
    await flush();
    expect(seen).toEqual(['x']);
  });

  it('sendBatch enqueues each message', async () => {
    const queue = new MemoryQueue<number>();
    const seen: number[] = [];
    queue.onMessage(async (m) => {
      seen.push(m);
    });
    await queue.sendBatch([1, 2, 3]);
    await flush();
    expect(seen).toEqual([1, 2, 3]);
  });

  it('routes handler rejections through onError, not the caller', async () => {
    const onError = vi.fn();
    const queue = new MemoryQueue<string>({ onError });
    queue.onMessage(async () => {
      throw new Error('boom');
    });
    await queue.send('bad');
    await flush();
    expect(onError).toHaveBeenCalledTimes(1);
    expect((onError.mock.calls[0]![0] as Error).message).toBe('boom');
    expect(onError.mock.calls[0]![1]).toBe('bad');
  });

  it('defaults onError to console.error', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const queue = new MemoryQueue<string>();
    queue.onMessage(async () => {
      throw new Error('kaboom');
    });
    await queue.send('bad');
    await flush();
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});
