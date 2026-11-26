// ══════════════════════════════════════════════════════════════════════════════
// Policy buckets — editorial classification independent of scan findings
// ══════════════════════════════════════════════════════════════════════════════
//
// A policy bucket records what a skill *is*, not what the scanner found in it.
// `dual-use` is for offensive-security / pentest frameworks whose flagged code
// is the tool doing its advertised job (issue #105): rescans will always flag
// them, so precision work cannot clear them and they need a label an operator
// can filter on rather than a permanent pending-review state.
//
// Taxonomy only: this module declares the bucket values. Which skill sits in
// which bucket is registry data, set through the data or admin path so each
// assignment can be audited and reversed without a package release.
//
// ══════════════════════════════════════════════════════════════════════════════

export const POLICY_BUCKETS = ['dual-use'] as const;

export type PolicyBucket = (typeof POLICY_BUCKETS)[number];

/** True when `value` is a declared policy bucket. Exact match. */
export function isPolicyBucket(value: unknown): value is PolicyBucket {
  return (POLICY_BUCKETS as readonly unknown[]).includes(value);
}
