// ══════════════════════════════════════════════════════════════════════════════
// upstream-response — L2 hermetic mapping from UpstreamError → HTTP
// ══════════════════════════════════════════════════════════════════════════════
//
// Public and admin routes share `upstreamErrorToResponse`. These tests lock the
// taxonomy table so a mothership failure cannot drift to the wrong HTTP status
// (especially unauthenticated/forbidden → 502, not 401/403).

import type { UpstreamErrorCode } from '@skillsregistry/contracts';
import { describe, expect, it } from 'vitest';
import { UpstreamError } from '../upstream-client/errors.js';
import {
  UPSTREAM_ERROR_STATUS,
  upstreamErrorBody,
  upstreamErrorToResponse,
} from './upstream-response.js';

const ALL_CODES: UpstreamErrorCode[] = [
  'upstream_not_configured',
  'budget_exhausted',
  'unauthenticated',
  'forbidden',
  'not_found',
  'rate_limited',
  'bad_request',
  'upstream_unavailable',
  'upstream_timeout',
  'sandbox_contract_violated',
];

describe('UPSTREAM_ERROR_STATUS — TA-upstream-error-http-map-1', () => {
  it.each(ALL_CODES)('maps %s consistently through upstreamErrorToResponse', (code) => {
    const err = new UpstreamError(code, `msg-${code}`);
    const { status } = upstreamErrorToResponse(err);
    expect(status).toBe(UPSTREAM_ERROR_STATUS[code]);
  });

  it('covers every UpstreamErrorCode exactly once in the status table', () => {
    expect(Object.keys(UPSTREAM_ERROR_STATUS).sort()).toEqual([...ALL_CODES].sort());
  });
});

describe('unauthenticated posture — TA-upstream-error-http-map-2', () => {
  it('returns 502 so callers are not told their credential failed', () => {
    const err = new UpstreamError(
      'unauthenticated',
      'Mothership rejected the node API key',
    );
    const { status, body } = upstreamErrorToResponse(err);
    expect(status).toBe(502);
    expect(status).not.toBe(401);
    expect(body.error.code).toBe('unauthenticated');
    expect(body.error.message).toMatch(/API key/i);
  });

  it('maps forbidden to 502 for the same reason', () => {
    const { status } = upstreamErrorToResponse(
      new UpstreamError('forbidden', 'plan blocks action'),
    );
    expect(status).toBe(502);
    expect(status).not.toBe(403);
  });
});

describe('retry_after on rate limits — TA-upstream-error-http-map-3', () => {
  it('surfaces retry_after in the JSON envelope', () => {
    const err = new UpstreamError('rate_limited', 'too many trust scores', {
      retryAfter: 30,
      requestId: 'req-99',
    });
    const body = upstreamErrorBody(err);
    expect(body.error.retry_after).toBe(30);
    expect(body.error.request_id).toBe('req-99');
    expect(upstreamErrorToResponse(err).status).toBe(429);
  });
});

describe('sandbox_contract_violated — TA-upstream-error-http-map-4', () => {
  it('returns 502 with the named upstream code', () => {
    const err = new UpstreamError(
      'sandbox_contract_violated',
      'L3 runtime exit 90 — image preflight failed',
      { detail: { exit_code: 90 } },
    );
    const { status, body } = upstreamErrorToResponse(err);
    expect(status).toBe(502);
    expect(body.error.code).toBe('sandbox_contract_violated');
    expect(body.error.detail).toEqual({ exit_code: 90 });
  });

  it('maps budget_exhausted to 402', () => {
    const { status, body } = upstreamErrorToResponse(
      new UpstreamError('budget_exhausted', 'no tokens left'),
    );
    expect(status).toBe(402);
    expect(body.error.code).toBe('budget_exhausted');
  });
});

describe('compact envelope — TA-upstream-error-http-map-5', () => {
  it('omits optional fields when unset', () => {
    const body = upstreamErrorBody(
      new UpstreamError('not_found', 'skill absent'),
    );
    expect(body).toEqual({
      error: { code: 'not_found', message: 'skill absent' },
    });
    expect('retry_after' in body.error).toBe(false);
    expect('detail' in body.error).toBe(false);
    expect('request_id' in body.error).toBe(false);
  });
});