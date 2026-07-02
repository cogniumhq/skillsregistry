// ══════════════════════════════════════════════════════════════════════════════
// Scoring — barrel for the trust-scoring policy module
// ══════════════════════════════════════════════════════════════════════════════

export {
  BASE_TRUST,
  MAX_TRUST,
  DEFAULT_SIGNATURE_BONUS,
  DEFAULT_SIGNATURE_REVOKED_PENALTY,
  capTrustBySource,
  computeTrustScore,
  deriveStatus,
  deriveTier,
  parsePositiveFloat,
  clampTrust,
  effectiveTrustBadge,
  applyRevocationScoring,
  buildRemediationMessage,
  type SignatureGateInput,
} from './policy.js';
