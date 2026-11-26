// ══════════════════════════════════════════════════════════════════════════════
// Policy buckets — unit tests
// ══════════════════════════════════════════════════════════════════════════════
//
// Covers the policy-bucket taxonomy (issue #105): the `dual-use` value exists,
// `isPolicyBucket` accepts only declared values, and the published scoring
// surface carries no per-skill assignments (those belong in registry data).
//
// ══════════════════════════════════════════════════════════════════════════════

import { describe, it, expect } from 'vitest';
import { POLICY_BUCKETS, isPolicyBucket } from './policy-bucket.js';
import * as scoring from './index.js';

describe('POLICY_BUCKETS', () => {
  it('declares the dual-use bucket', () => {
    expect(POLICY_BUCKETS).toContain('dual-use');
  });
});

describe('isPolicyBucket', () => {
  it.each([...POLICY_BUCKETS])('accepts %s', (bucket) => {
    expect(isPolicyBucket(bucket)).toBe(true);
  });

  it('rejects undeclared values', () => {
    expect(isPolicyBucket('DUAL-USE')).toBe(false);
    expect(isPolicyBucket('offensive-security')).toBe(false);
    expect(isPolicyBucket('')).toBe(false);
    expect(isPolicyBucket(null)).toBe(false);
    expect(isPolicyBucket(1)).toBe(false);
  });
});

describe('scoring exports', () => {
  it('exports the taxonomy only, with no per-skill assignments', () => {
    expect(scoring.POLICY_BUCKETS).toBe(POLICY_BUCKETS);
    expect(scoring.isPolicyBucket).toBe(isPolicyBucket);
    expect(scoring).not.toHaveProperty('DUAL_USE_SLUGS');
    expect(scoring).not.toHaveProperty('policyBucketFor');
  });
});
