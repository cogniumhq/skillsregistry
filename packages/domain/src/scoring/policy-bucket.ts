// ══════════════════════════════════════════════════════════════════════════════
// Policy buckets — editorial classification independent of scan findings
// ══════════════════════════════════════════════════════════════════════════════
//
// A policy bucket records what a skill *is*, not what the scanner found in it.
// `dual-use` holds offensive-security / pentest frameworks whose flagged code
// is the tool doing its advertised job (issue #105): rescans will always flag
// them, so precision work cannot clear them and they need a label an operator
// can filter on rather than a permanent pending-review state.
//
// Data only: nothing here changes trust math, status derivation, or any stored
// row. Consumers decide how to surface or filter the bucket.
//
// ══════════════════════════════════════════════════════════════════════════════

export const POLICY_BUCKETS = ['dual-use'] as const;

export type PolicyBucket = (typeof POLICY_BUCKETS)[number];

/** Offensive-security frameworks from the Milestone-1 TP cohort (#105). */
export const DUAL_USE_SLUGS: ReadonlySet<string> = new Set([
  'netcuter-hexstrike-ai',
  'wangqiongpeng-pengstrike-mcp',
  'cybermaster000-cyber-master-mcp',
  'veteranchat-mcp-ngrok',
  'dr-yato-pentest-mcp-server',
  'omamishra8051-source-pentest-mcp',
  'deloney-code-ai-powered-red-team-automation',
  'deepakdubat-offensiveset',
  'dandadadandan-mcp-osint',
]);

/** Policy bucket for a skill slug, or `null` when it is unclassified. Exact match. */
export function policyBucketFor(slug: string): PolicyBucket | null {
  return DUAL_USE_SLUGS.has(slug) ? 'dual-use' : null;
}
