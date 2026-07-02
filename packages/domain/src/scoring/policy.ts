// ══════════════════════════════════════════════════════════════════════════════
// Scoring policy — trust math, status/tier derivation, remediation text
// ══════════════════════════════════════════════════════════════════════════════
//
// Ported verbatim from mothership `src/cognium/scoring-policy.ts` behind the
// `SqlPool` port. The two env-backed knobs
// (`TRUST_SIGNATURE_BONUS_POINTS`, `TRUST_SIGNATURE_REVOKED_PENALTY_POINTS`)
// become plain numeric options — the consumer parses env once at boot and
// passes the resolved number. `parsePositiveFloat` is exported so consumers
// can share the exact same parsing rule.
//
// Nothing here touches Circle-IR directly — it consumes the already-flattened
// `ScanFinding[]` shape defined in `../types.ts`.
//
// ══════════════════════════════════════════════════════════════════════════════

import type { SqlPool } from '../adapters/sql.js';
import type {
  ScanFinding,
  SkillRow,
  SkillStatus,
  TrustBadge,
  VerificationTier,
} from '../types.js';

// ─── Trust constants ─────────────────────────────────────────────────────────

/** Base trust by registry provenance — floor for a fresh, unscanned skill. */
export const BASE_TRUST: Record<string, number> = {
  'mcp-registry':    0.80,
  'smithery':        0.65,
  'pulsemcp':        0.50,
  'glama':           0.60,
  'clawhub':         0.65,
  'openclaw':        0.55,
  'github':          0.55,
  'manual':          0.60,
  'forge':           0.40,
  'human-distilled': 0.50,
};

/**
 * Maximum trust ceiling per source — prevents Circle-IR perfect scores
 * (100/100) from inflating unvetted tools to trust=1.0. Only seed/editorial
 * skills exceed these.
 */
export const MAX_TRUST: Record<string, number> = {
  'mcp-registry':    0.85,
  'smithery':        0.75,
  'clawhub':         0.70,
  'glama':           0.70,
  'github':          0.65,
  'openclaw':        0.65,
  'manual':          0.70,
  'forge':           0.50,
  'human-distilled': 0.60,
  'pulsemcp':        0.65,
};

// Trust impact per finding category — internal to `computeTrustScore()`.
const TRUST_IMPACT: Record<string, number> = {
  // SAST findings
  CRITICAL_INJECTION:           -0.25,
  CRITICAL_SAST:                -0.20,
  HIGH_INJECTION:               -0.20,
  HIGH_SAST:                    -0.15,
  SECRET_EXPOSURE:              -0.30,
  // Instruction safety findings
  CRITICAL_INSTRUCTION:         -0.30,
  HIGH_INSTRUCTION:             -0.20,
  // Capability mismatch findings
  CRITICAL_CAPABILITY_MISMATCH: -0.25,
  HIGH_CAPABILITY_MISMATCH:     -0.15,
};

// ─── Trust math ──────────────────────────────────────────────────────────────

/**
 * Cap a trust score by the source provenance ceiling.
 * Seed/editorial skills (already above the cap) are left unchanged.
 */
export function capTrustBySource(trustScore: number, source: string): number {
  const cap = MAX_TRUST[source] ?? 0.60;
  return Math.min(trustScore, cap);
}

export function computeTrustScore(skill: SkillRow, findings: ScanFinding[]): number {
  const originSource = skill.rootSource ?? skill.source;
  const baseScore = BASE_TRUST[originSource] ?? 0.40;

  let adjustment = 0;
  for (const finding of findings) {
    const key = classifyFinding(finding);
    adjustment += TRUST_IMPACT[key] ?? (finding.severity === 'MEDIUM' ? -0.05 : 0);
  }

  return Math.max(0.0, Math.min(1.0, Math.round((baseScore + adjustment) * 100) / 100));
}

function classifyFinding(f: ScanFinding): string {
  const cwe = f.cweId ?? '';

  // Phase-specific classification
  if (f.phase === 'instruction_safety') {
    if (f.severity === 'CRITICAL') return 'CRITICAL_INSTRUCTION';
    if (f.severity === 'HIGH') return 'HIGH_INSTRUCTION';
    return '';
  }

  if (f.phase === 'capability_mismatch') {
    if (f.severity === 'CRITICAL') return 'CRITICAL_CAPABILITY_MISMATCH';
    if (f.severity === 'HIGH') return 'HIGH_CAPABILITY_MISMATCH';
    return '';
  }

  // SAST classification (original logic)
  const isInjection = ['CWE-77', 'CWE-78', 'CWE-79', 'CWE-89', 'CWE-94'].some((c) =>
    cwe.startsWith(c),
  );
  const isSecretExposure = ['CWE-312', 'CWE-321', 'CWE-522', 'CWE-798'].some((c) =>
    cwe.startsWith(c),
  );

  if (isSecretExposure) return 'SECRET_EXPOSURE';
  if (f.severity === 'CRITICAL' && isInjection) return 'CRITICAL_INJECTION';
  if (f.severity === 'CRITICAL') return 'CRITICAL_SAST';
  if (f.severity === 'HIGH' && isInjection) return 'HIGH_INJECTION';
  if (f.severity === 'HIGH') return 'HIGH_SAST';
  return '';
}

// ─── Status + tier derivation ────────────────────────────────────────────────

export function deriveStatus(worstSeverity: ScanFinding['severity'] | null): SkillStatus {
  if (worstSeverity === 'CRITICAL') return 'revoked';
  if (worstSeverity === 'HIGH' || worstSeverity === 'MEDIUM') return 'vulnerable';
  return 'published';
}

export function deriveTier(
  worstSeverity: ScanFinding['severity'] | null,
  trustScore: number,
  scanCoverage?: string,
): VerificationTier {
  if (worstSeverity === 'CRITICAL') return 'scanned';
  // Only code-level scans can produce 'verified' tier
  if (scanCoverage === 'code-full' && trustScore >= 0.70 && worstSeverity !== 'HIGH') {
    return 'verified';
  }
  return 'scanned';
}

// ──────────────────────────────────────────────────────────────────────────────
// D2 — Publisher-signature trust adjustments
// ──────────────────────────────────────────────────────────────────────────────
//
// The verified-badge gate + revocation cascade share a tiny math surface; we
// centralize both here so the publish handler, the revocation queue consumer,
// and any future signature-aware scoring path agree on a single recipe.
//
// Defaults are deliberately small (verified bonus +0.05, revocation penalty
// -0.20). They tilt outcomes at the margin without rewriting the trust score
// — Cognium scans + source caps remain the dominant signals.

export const DEFAULT_SIGNATURE_BONUS = 0.05;
export const DEFAULT_SIGNATURE_REVOKED_PENALTY = 0.20;

/**
 * Parse an optional env-string as a non-negative float. Falls back to
 * `fallback` on empty/undefined/negative/non-finite input. Exposed for
 * consumers that want to mirror the mothership's env-binding semantics.
 */
export function parsePositiveFloat(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw === '') return fallback;
  const n = Number.parseFloat(raw);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return n;
}

/** Round to 2 decimals + clamp to [0, 1] — matches `computeTrustScore()` rounding. */
export function clampTrust(score: number): number {
  return Math.max(0, Math.min(1, Math.round(score * 100) / 100));
}

export interface SignatureGateInput {
  signatureVerifiedAt: Date | string | null | undefined;
  signatureFailureReason: string | null | undefined;
  publisherKeyId: string | null | undefined;
}

/**
 * Verified-badge precondition: `trust_badge='human-verified'` requires a fully
 * verified signature on file. Returns the badge a caller may legally request,
 * downgrading 'human-verified' to `null` when the signature columns don't
 * back it up. The other two badge values pass through untouched.
 */
export function effectiveTrustBadge(
  requested: TrustBadge | null | undefined,
  sig: SignatureGateInput,
): TrustBadge | null {
  if (!requested) return null;
  if (requested !== 'human-verified') return requested;
  const verified =
    sig.signatureVerifiedAt !== null &&
    sig.signatureVerifiedAt !== undefined &&
    !sig.signatureFailureReason &&
    !!sig.publisherKeyId;
  return verified ? 'human-verified' : null;
}

/**
 * Apply the revocation-cascade scoring delta across a batch of skills:
 *   trust_score = clamp(trust_score - penalty)
 *   signature_failure_reason = 'key_revoked'      (if not already a failure)
 *   signature_verified_at    = NULL               (badge gate fails now)
 *   trust_badge              = NULL when previously 'human-verified'
 *
 * Returns the count of skills that were actually updated (rows where the
 * publisher_key_id matched and the row hadn't already been downgraded).
 *
 * Single UPDATE so the math + flag flips land atomically per row; idempotent
 * because we only touch rows whose signature_failure_reason is still NULL.
 */
export async function applyRevocationScoring(
  pool: SqlPool,
  keyId: string,
  penalty: number,
): Promise<{ updated: number }> {
  const r = await pool.query<{ id: string }>(
    `UPDATE skills
        SET trust_score              = GREATEST(0, LEAST(1, ROUND((COALESCE(trust_score, 0) - $2)::numeric, 2))),
            signature_failure_reason = 'key_revoked',
            signature_verified_at    = NULL,
            trust_badge              = CASE WHEN trust_badge = 'human-verified' THEN NULL ELSE trust_badge END,
            updated_at               = NOW()
      WHERE publisher_key_id = $1
        AND signature_failure_reason IS NULL
      RETURNING id`,
    [keyId, penalty],
  );
  return { updated: r.rowCount ?? r.rows.length };
}

// ─── Remediation text ────────────────────────────────────────────────────────

export function buildRemediationMessage(finding: ScanFinding, _skill: SkillRow): string {
  const parts = [
    `${finding.severity} finding: ${finding.cweId ?? finding.title}`,
  ];

  if (finding.phase) {
    parts.push(`Phase: ${finding.phase}`);
  }

  if (finding.remediationHint) {
    parts.push(`Fix: ${finding.remediationHint}`);
  }

  if (finding.capabilityMismatch) {
    parts.push(`Mismatch: capability mismatch detected`);
  }

  return parts.filter(Boolean).join('\n');
}
