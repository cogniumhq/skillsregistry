import { describe, expect, it } from 'vitest';
import { UpstreamError } from './errors.js';

describe('UpstreamError', () => {
  it('carries code + message', () => {
    const err = new UpstreamError('not_found', 'skill missing');
    expect(err.name).toBe('UpstreamError');
    expect(err.code).toBe('not_found');
    expect(err.message).toBe('skill missing');
  });

  it('is an instance of Error (catchable via `instanceof`)', () => {
    const err = new UpstreamError('upstream_timeout', 'took too long');
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(UpstreamError);
  });

  it('carries optional retryAfter / detail / requestId', () => {
    const err = new UpstreamError('rate_limited', 'slow down', {
      retryAfter: 42,
      detail: { limit: 60 },
      requestId: 'req-abc',
    });
    expect(err.retryAfter).toBe(42);
    expect(err.detail).toEqual({ limit: 60 });
    expect(err.requestId).toBe('req-abc');
  });

  it('preserves cause on the Error chain', () => {
    const root = new Error('socket hang up');
    const err = new UpstreamError('upstream_unavailable', 'wrapped', {
      cause: root,
    });
    expect((err as { cause?: unknown }).cause).toBe(root);
  });
});
