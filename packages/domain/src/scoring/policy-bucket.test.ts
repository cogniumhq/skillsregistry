// ══════════════════════════════════════════════════════════════════════════════
// Policy buckets — unit tests
// ══════════════════════════════════════════════════════════════════════════════
//
// Covers the `dual-use` bucket (issue #105): the nine offensive-security
// frameworks from the Milestone-1 TP cohort classify into it, ordinary skills
// do not, and the lookup is exact (no prefix or case folding).
//
// ══════════════════════════════════════════════════════════════════════════════

import { describe, it, expect } from 'vitest';
import {
  POLICY_BUCKETS,
  DUAL_USE_SLUGS,
  policyBucketFor,
} from './policy-bucket.js';

const ISSUE_105_SLUGS = [
  'netcuter-hexstrike-ai',
  'wangqiongpeng-pengstrike-mcp',
  'cybermaster000-cyber-master-mcp',
  'veteranchat-mcp-ngrok',
  'dr-yato-pentest-mcp-server',
  'omamishra8051-source-pentest-mcp',
  'deloney-code-ai-powered-red-team-automation',
  'deepakdubat-offensiveset',
  'dandadadandan-mcp-osint',
];

describe('POLICY_BUCKETS', () => {
  it('declares the dual-use bucket', () => {
    expect(POLICY_BUCKETS).toContain('dual-use');
  });
});

describe('DUAL_USE_SLUGS', () => {
  it('holds exactly the nine frameworks named in issue #105', () => {
    expect([...DUAL_USE_SLUGS].sort()).toEqual([...ISSUE_105_SLUGS].sort());
  });
});

describe('policyBucketFor', () => {
  it.each(ISSUE_105_SLUGS)('classifies %s as dual-use', (slug) => {
    expect(policyBucketFor(slug)).toBe('dual-use');
  });

  it('returns null for an ordinary skill', () => {
    expect(policyBucketFor('acme-changelog-writer')).toBeNull();
  });

  it('matches slugs exactly', () => {
    expect(policyBucketFor('NETCUTER-HEXSTRIKE-AI')).toBeNull();
    expect(policyBucketFor('netcuter-hexstrike-ai-fork')).toBeNull();
    expect(policyBucketFor('')).toBeNull();
  });
});
