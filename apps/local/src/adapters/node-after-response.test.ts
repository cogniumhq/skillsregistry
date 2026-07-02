import { describe, expect, it, vi } from 'vitest';
import { NodeAfterResponse } from './node-after-response.js';

async function flushSetImmediate(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

describe('NodeAfterResponse', () => {
  it('run() returns synchronously and executes the task later', async () => {
    const after = new NodeAfterResponse();
    let ran = false;
    after.run(async () => {
      ran = true;
    });
    // Not yet — setImmediate hasn't fired.
    expect(ran).toBe(false);
    await flushSetImmediate();
    expect(ran).toBe(true);
  });

  it('routes task rejections through onError', async () => {
    const onError = vi.fn();
    const after = new NodeAfterResponse({ onError });
    after.run(async () => {
      throw new Error('background failed');
    });
    await flushSetImmediate();
    expect(onError).toHaveBeenCalledTimes(1);
    expect((onError.mock.calls[0]![0] as Error).message).toBe(
      'background failed',
    );
  });

  it('defaults onError to console.error', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const after = new NodeAfterResponse();
    after.run(async () => {
      throw new Error('boom');
    });
    await flushSetImmediate();
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it('does not rethrow task rejections into the caller', async () => {
    const after = new NodeAfterResponse({ onError: () => {} });
    // The caller pattern is fire-and-forget; run() cannot ever throw.
    expect(() =>
      after.run(async () => {
        throw new Error('nope');
      }),
    ).not.toThrow();
    await flushSetImmediate();
  });
});
