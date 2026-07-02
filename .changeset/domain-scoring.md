---
'@skillsregistry/domain': minor
---

T-1.4f: Port `src/cognium/scoring-policy.ts` from mothership as
`@skillsregistry/domain/scoring`.

- `BASE_TRUST` + `MAX_TRUST` constants (source provenance floor + ceiling)
- `computeTrustScore(skill, findings)` — Circle-IR-derived trust math with
  phase-specific (`sast` / `instruction_safety` / `capability_mismatch`)
  classification.
- `capTrustBySource`, `deriveStatus`, `deriveTier`, `clampTrust`.
- D2 publisher-signature adjustments: `effectiveTrustBadge` (badge gate),
  `applyRevocationScoring(pool, keyId, penalty)` — SQL-side revocation
  cascade takes a plain numeric `penalty` instead of an `Env`.
- `parsePositiveFloat` exported so consumers can mirror the mothership's
  env-var → number parsing behavior exactly.
- `DEFAULT_SIGNATURE_BONUS` (0.05) + `DEFAULT_SIGNATURE_REVOKED_PENALTY`
  (0.20) — kept as named constants so consumers can wire env fallbacks
  without hardcoding.
- `buildRemediationMessage(finding, skill)` remediation-string builder.

New domain types at `packages/domain/src/types.ts`:

- `CircleIRAnalysisPhase` — `'sast' | 'instruction_safety' | 'capability_mismatch'`.
- `ScanFinding` — normalized finding shape consumed by scoring.
- `SkillRow` — minimal skill projection the scoring policy reads.

Ships new subpath: `@skillsregistry/domain/scoring`.

Env-binding refactor: mothership's `trustSignatureBonus(env)` and
`trustSignatureRevokedPenalty(env)` helpers stay in the mothership (they
read `env.TRUST_SIGNATURE_*` — CF-runtime-specific). The domain exports
the raw parser + defaults so the consumer computes the number once at
boot and passes it in.

No behavioral change to trust math, tier derivation, or badge-gate logic
versus mothership.
