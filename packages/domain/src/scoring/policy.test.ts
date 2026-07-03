// ══════════════════════════════════════════════════════════════════════════════
// Scoring policy — unit tests
// ══════════════════════════════════════════════════════════════════════════════
//
// Ported from mothership `tests/cognium/scoring-policy.test.ts` and expanded
// for:
//   - the local package's slightly different D2 signature — `applyRevocationScoring`
//     takes `penalty: number` directly (mothership takes an env dict and parses
//     inside; local expects the consumer to parse once at boot);
//   - `parsePositiveFloat` (local) instead of `trustSignatureBonus` /
//     `trustSignatureRevokedPenalty` (mothership env wrappers);
//   - `DEFAULT_SIGNATURE_BONUS` + `DEFAULT_SIGNATURE_REVOKED_PENALTY` constant
//     exports.
//
// Pure functions dominate; only `applyRevocationScoring` needs a mock (the
// exported `SqlPool` adapter port).
//
// ══════════════════════════════════════════════════════════════════════════════

import { describe, it, expect, vi } from 'vitest';
import {
  computeTrustScore,
  capTrustBySource,
  deriveStatus,
  deriveTier,
  buildRemediationMessage,
  BASE_TRUST,
  MAX_TRUST,
  DEFAULT_SIGNATURE_BONUS,
  DEFAULT_SIGNATURE_REVOKED_PENALTY,
  parsePositiveFloat,
  clampTrust,
  effectiveTrustBadge,
  applyRevocationScoring,
} from './policy.js';
import type { ScanFinding, SkillRow } from '../types.js';
import type { SqlPool } from '../adapters/sql.js';

// ──────────────────────────────────────────────────────────────────────────────
// Fixtures
// ──────────────────────────────────────────────────────────────────────────────

function makeSkill(overrides?: Partial<SkillRow>): SkillRow {
  return {
    id: 'test-id',
    slug: 'test-skill',
    version: '1.0.0',
    name: 'Test Skill',
    description: 'A test skill',
    source: 'github',
    status: 'published',
    executionLayer: 'mcp-remote',
    ...overrides,
  };
}

function makeFinding(overrides?: Partial<ScanFinding>): ScanFinding {
  return {
    severity: 'MEDIUM',
    cweId: 'CWE-200',
    tool: 'circle-ir',
    title: 'Test finding',
    description: 'Test finding description',
    confidence: 0.8,
    verdict: 'VULNERABLE',
    llmVerified: false,
    ...overrides,
  };
}

function mockPool(rowCount: number): SqlPool {
  return {
    query: vi.fn().mockResolvedValue({
      rowCount,
      rows: Array.from({ length: rowCount }, (_, i) => ({ id: `s${i}` })),
    }),
    connect: vi.fn(),
  } as unknown as SqlPool;
}

// ══════════════════════════════════════════════════════════════════════════════
// computeTrustScore
// ══════════════════════════════════════════════════════════════════════════════

describe('computeTrustScore', () => {
  it('returns base trust when no findings', () => {
    const skill = makeSkill({ source: 'mcp-registry' });
    expect(computeTrustScore(skill, [])).toBe(BASE_TRUST['mcp-registry']);
  });

  it('prefers rootSource over source', () => {
    const skill = makeSkill({ source: 'direct', rootSource: 'clawhub' });
    expect(computeTrustScore(skill, [])).toBe(BASE_TRUST['clawhub']);
  });

  it('defaults to 0.40 for unknown sources', () => {
    const skill = makeSkill({ source: 'unknown-source' });
    expect(computeTrustScore(skill, [])).toBe(0.40);
  });

  it('applies CRITICAL_INJECTION impact (CWE-78)', () => {
    // github base 0.55 - 0.25 = 0.30
    const skill = makeSkill({ source: 'github' });
    const findings = [makeFinding({ severity: 'CRITICAL', cweId: 'CWE-78' })];
    expect(computeTrustScore(skill, findings)).toBe(0.30);
  });

  it('applies CRITICAL_INJECTION for CWE-77 (command injection)', () => {
    const skill = makeSkill({ source: 'github' });
    const findings = [makeFinding({ severity: 'CRITICAL', cweId: 'CWE-77' })];
    expect(computeTrustScore(skill, findings)).toBe(0.30);
  });

  it('applies CRITICAL_INJECTION for CWE-89 (SQL injection)', () => {
    const skill = makeSkill({ source: 'github' });
    const findings = [makeFinding({ severity: 'CRITICAL', cweId: 'CWE-89' })];
    expect(computeTrustScore(skill, findings)).toBe(0.30);
  });

  it('applies CRITICAL_INJECTION for CWE-94 (code injection)', () => {
    const skill = makeSkill({ source: 'github' });
    const findings = [makeFinding({ severity: 'CRITICAL', cweId: 'CWE-94' })];
    expect(computeTrustScore(skill, findings)).toBe(0.30);
  });

  it('applies HIGH_INJECTION for CWE-79 at HIGH severity', () => {
    const skill = makeSkill({ source: 'mcp-registry' }); // base: 0.80
    const findings = [makeFinding({ severity: 'HIGH', cweId: 'CWE-79' })];
    expect(computeTrustScore(skill, findings)).toBe(0.60);
  });

  it('applies CRITICAL_SAST fallback (non-injection CWE, CRITICAL)', () => {
    // github base 0.55 - 0.20 = 0.35
    const skill = makeSkill({ source: 'github' });
    const findings = [makeFinding({ severity: 'CRITICAL', cweId: 'CWE-400' })];
    expect(computeTrustScore(skill, findings)).toBe(0.35);
  });

  it('applies HIGH_SAST fallback (non-injection CWE, HIGH)', () => {
    // github base 0.55 - 0.15 = 0.40
    const skill = makeSkill({ source: 'github' });
    const findings = [makeFinding({ severity: 'HIGH', cweId: 'CWE-400' })];
    expect(computeTrustScore(skill, findings)).toBe(0.40);
  });

  it('applies SECRET_EXPOSURE for CWE-798 (hardcoded credentials)', () => {
    // github base 0.55 - 0.30 = 0.25
    const skill = makeSkill({ source: 'github' });
    const findings = [makeFinding({ severity: 'HIGH', cweId: 'CWE-798' })];
    expect(computeTrustScore(skill, findings)).toBe(0.25);
  });

  it('applies SECRET_EXPOSURE for CWE-312 (cleartext storage)', () => {
    const skill = makeSkill({ source: 'github' });
    const findings = [makeFinding({ severity: 'HIGH', cweId: 'CWE-312' })];
    expect(computeTrustScore(skill, findings)).toBe(0.25);
  });

  it('SECRET_EXPOSURE wins over severity — CWE-321 at MEDIUM still -0.30', () => {
    // mcp-registry 0.80 - 0.30 = 0.50 (secret exposure applied regardless of MEDIUM)
    const skill = makeSkill({ source: 'mcp-registry' });
    const findings = [makeFinding({ severity: 'MEDIUM', cweId: 'CWE-321' })];
    expect(computeTrustScore(skill, findings)).toBe(0.50);
  });

  it('SECRET_EXPOSURE for CWE-522 (insufficient credential protection) at LOW', () => {
    const skill = makeSkill({ source: 'mcp-registry' });
    const findings = [makeFinding({ severity: 'LOW', cweId: 'CWE-522' })];
    expect(computeTrustScore(skill, findings)).toBe(0.50);
  });

  it('applies MEDIUM default -0.05 for unclassified CWE', () => {
    const skill = makeSkill({ source: 'mcp-registry' });
    const findings = [makeFinding({ severity: 'MEDIUM', cweId: 'CWE-200' })];
    expect(computeTrustScore(skill, findings)).toBe(BASE_TRUST['mcp-registry'] - 0.05);
  });

  it('LOW unclassified finding contributes zero', () => {
    const skill = makeSkill({ source: 'github' });
    const findings = [makeFinding({ severity: 'LOW', cweId: 'CWE-200', phase: undefined })];
    expect(computeTrustScore(skill, findings)).toBe(0.55);
  });

  it('accumulates multiple finding impacts', () => {
    // mcp-registry 0.80 - 0.20 (HIGH_INJECTION) - 0.05 (MEDIUM) = 0.55
    const skill = makeSkill({ source: 'mcp-registry' });
    const findings = [
      makeFinding({ severity: 'HIGH', cweId: 'CWE-79' }),
      makeFinding({ severity: 'MEDIUM', cweId: 'CWE-200' }),
    ];
    expect(computeTrustScore(skill, findings)).toBe(0.55);
  });

  it('accumulates SAST + instruction + capability findings', () => {
    // mcp-registry 0.80 - 0.20 (HIGH_INJECTION) - 0.20 (HIGH_INSTRUCTION) - 0.15 (HIGH_CAP) = 0.25
    const skill = makeSkill({ source: 'mcp-registry' });
    const findings = [
      makeFinding({ severity: 'HIGH', cweId: 'CWE-79' }),
      makeFinding({ severity: 'HIGH', phase: 'instruction_safety' }),
      makeFinding({ severity: 'HIGH', phase: 'capability_mismatch' }),
    ];
    expect(computeTrustScore(skill, findings)).toBe(0.25);
  });

  it('clamps to 0.0 floor with multiple severe findings', () => {
    const skill = makeSkill({ source: 'forge' }); // base: 0.40
    const findings = [
      makeFinding({ severity: 'CRITICAL', cweId: 'CWE-78' }),
      makeFinding({ severity: 'CRITICAL', cweId: 'CWE-89' }),
    ];
    expect(computeTrustScore(skill, findings)).toBe(0.0);
  });

  it('clamps to 1.0 ceiling', () => {
    const skill = makeSkill({ source: 'mcp-registry' });
    const score = computeTrustScore(skill, []);
    expect(score).toBeLessThanOrEqual(1.0);
  });

  it('returns correct base trust for each known source', () => {
    const cases: [string, number][] = [
      ['mcp-registry',    0.80],
      ['smithery',        0.65],
      ['pulsemcp',        0.50],
      ['glama',           0.60],
      ['clawhub',         0.65],
      ['openclaw',        0.55],
      ['github',          0.55],
      ['manual',          0.60],
      ['forge',           0.40],
      ['human-distilled', 0.50],
    ];
    for (const [source, expected] of cases) {
      expect(computeTrustScore(makeSkill({ source }), [])).toBe(expected);
    }
  });

  it('applies CRITICAL_INSTRUCTION for instruction_safety phase', () => {
    // clawhub 0.65 - 0.30 = 0.35
    const skill = makeSkill({ source: 'clawhub' });
    const findings = [makeFinding({ severity: 'CRITICAL', phase: 'instruction_safety' })];
    expect(computeTrustScore(skill, findings)).toBe(0.35);
  });

  it('applies HIGH_INSTRUCTION for instruction_safety phase', () => {
    // clawhub 0.65 - 0.20 = 0.45
    const skill = makeSkill({ source: 'clawhub' });
    const findings = [makeFinding({ severity: 'HIGH', phase: 'instruction_safety' })];
    expect(computeTrustScore(skill, findings)).toBe(0.45);
  });

  it('MEDIUM in instruction_safety phase gets phase-empty classification (zero impact)', () => {
    // instruction_safety only classifies CRITICAL/HIGH; MEDIUM returns '' from
    // classifyFinding, so TRUST_IMPACT[''] is undefined → falls through to
    // (severity === 'MEDIUM' ? -0.05 : 0). Net: 0.65 - 0.05 = 0.60.
    const skill = makeSkill({ source: 'clawhub' });
    const findings = [makeFinding({ severity: 'MEDIUM', phase: 'instruction_safety' })];
    expect(computeTrustScore(skill, findings)).toBe(0.60);
  });

  it('applies CRITICAL_CAPABILITY_MISMATCH for capability_mismatch phase', () => {
    // clawhub 0.65 - 0.25 = 0.40
    const skill = makeSkill({ source: 'clawhub' });
    const findings = [makeFinding({ severity: 'CRITICAL', phase: 'capability_mismatch' })];
    expect(computeTrustScore(skill, findings)).toBe(0.40);
  });

  it('applies HIGH_CAPABILITY_MISMATCH for capability_mismatch phase', () => {
    // clawhub 0.65 - 0.15 = 0.50
    const skill = makeSkill({ source: 'clawhub' });
    const findings = [makeFinding({ severity: 'HIGH', phase: 'capability_mismatch' })];
    expect(computeTrustScore(skill, findings)).toBe(0.50);
  });

  it('LOW in capability_mismatch phase contributes zero', () => {
    const skill = makeSkill({ source: 'clawhub' });
    const findings = [makeFinding({ severity: 'LOW', phase: 'capability_mismatch' })];
    expect(computeTrustScore(skill, findings)).toBe(0.65);
  });

  it('handles finding with undefined cweId', () => {
    const skill = makeSkill({ source: 'github' });
    const findings = [makeFinding({ severity: 'MEDIUM', cweId: undefined })];
    expect(computeTrustScore(skill, findings)).toBe(0.50);
  });

  it('rounds to 2 decimal places', () => {
    // Construct a case where floating math would leave >2dp
    // github 0.55 - 0.05 = 0.50 already round; force via multi-MEDIUM:
    // 0.55 - 0.05 - 0.05 = 0.45
    const skill = makeSkill({ source: 'github' });
    const findings = [
      makeFinding({ severity: 'MEDIUM', cweId: 'CWE-200' }),
      makeFinding({ severity: 'MEDIUM', cweId: 'CWE-200' }),
    ];
    const score = computeTrustScore(skill, findings);
    expect(score).toBe(0.45);
    // No more than 2 decimals in the returned number
    expect(score.toString()).toMatch(/^\d+(\.\d{1,2})?$/);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// capTrustBySource
// ══════════════════════════════════════════════════════════════════════════════

describe('capTrustBySource', () => {
  it('caps GitHub trust at 0.65', () => {
    expect(capTrustBySource(1.0, 'github')).toBe(MAX_TRUST['github']);
    expect(capTrustBySource(0.65, 'github')).toBe(0.65);
    expect(capTrustBySource(0.50, 'github')).toBe(0.50);
  });

  it('caps mcp-registry trust at 0.85', () => {
    expect(capTrustBySource(1.0, 'mcp-registry')).toBe(MAX_TRUST['mcp-registry']);
    expect(capTrustBySource(0.80, 'mcp-registry')).toBe(0.80);
  });

  it('caps glama trust at 0.70', () => {
    expect(capTrustBySource(0.90, 'glama')).toBe(MAX_TRUST['glama']);
  });

  it('caps smithery trust at 0.75', () => {
    expect(capTrustBySource(0.90, 'smithery')).toBe(MAX_TRUST['smithery']);
  });

  it('caps forge trust at 0.50', () => {
    expect(capTrustBySource(1.0, 'forge')).toBe(0.50);
  });

  it('caps pulsemcp trust at 0.65', () => {
    expect(capTrustBySource(0.99, 'pulsemcp')).toBe(0.65);
  });

  it('does not raise scores below the cap', () => {
    expect(capTrustBySource(0.30, 'github')).toBe(0.30);
    expect(capTrustBySource(0.50, 'mcp-registry')).toBe(0.50);
  });

  it('defaults to 0.60 cap for unknown sources', () => {
    expect(capTrustBySource(1.0, 'unknown-source')).toBe(0.60);
    expect(capTrustBySource(0.55, 'unknown-source')).toBe(0.55);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// deriveStatus
// ══════════════════════════════════════════════════════════════════════════════

describe('deriveStatus', () => {
  it('returns revoked for CRITICAL', () => {
    expect(deriveStatus('CRITICAL')).toBe('revoked');
  });

  it('returns vulnerable for HIGH', () => {
    expect(deriveStatus('HIGH')).toBe('vulnerable');
  });

  it('returns vulnerable for MEDIUM', () => {
    expect(deriveStatus('MEDIUM')).toBe('vulnerable');
  });

  it('returns published for LOW', () => {
    expect(deriveStatus('LOW')).toBe('published');
  });

  it('returns published for null (no findings)', () => {
    expect(deriveStatus(null)).toBe('published');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// deriveTier
// ══════════════════════════════════════════════════════════════════════════════

describe('deriveTier', () => {
  it('returns scanned for CRITICAL severity regardless of trust', () => {
    expect(deriveTier('CRITICAL', 0.9)).toBe('scanned');
    expect(deriveTier('CRITICAL', 0.99, 'code-full')).toBe('scanned');
  });

  it('returns verified for code-full + trust≥0.70 + non-HIGH severity', () => {
    expect(deriveTier('LOW', 0.75, 'code-full')).toBe('verified');
    expect(deriveTier(null, 0.80, 'code-full')).toBe('verified');
    expect(deriveTier('MEDIUM', 0.75, 'code-full')).toBe('verified');
  });

  it('returns scanned for HIGH severity even with code-full and high trust', () => {
    expect(deriveTier('HIGH', 0.80, 'code-full')).toBe('scanned');
  });

  it('returns scanned for low trust', () => {
    expect(deriveTier('LOW', 0.50)).toBe('scanned');
    expect(deriveTier(null, 0.60)).toBe('scanned');
  });

  it('returns scanned for instructions-only coverage', () => {
    expect(deriveTier(null, 0.90, 'instructions-only')).toBe('scanned');
    expect(deriveTier('LOW', 0.85, 'instructions-only')).toBe('scanned');
  });

  it('returns scanned for metadata-only coverage', () => {
    expect(deriveTier(null, 0.90, 'metadata-only')).toBe('scanned');
  });

  it('returns scanned for code-partial coverage', () => {
    expect(deriveTier(null, 0.90, 'code-partial')).toBe('scanned');
    expect(deriveTier('LOW', 0.80, 'code-partial')).toBe('scanned');
  });

  it('returns scanned when scanCoverage is undefined', () => {
    expect(deriveTier(null, 0.90)).toBe('scanned');
    expect(deriveTier('LOW', 0.80)).toBe('scanned');
  });

  it('returns verified at exactly 0.70 trust boundary with code-full', () => {
    expect(deriveTier('LOW', 0.70, 'code-full')).toBe('verified');
    expect(deriveTier(null, 0.70, 'code-full')).toBe('verified');
  });

  it('returns scanned at 0.69 trust with code-full', () => {
    expect(deriveTier('LOW', 0.69, 'code-full')).toBe('scanned');
    expect(deriveTier(null, 0.69, 'code-full')).toBe('scanned');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// End-to-end scoring scenarios
// ══════════════════════════════════════════════════════════════════════════════

describe('end-to-end scoring scenarios', () => {
  it('clean GitHub skill: trust=0.55, published, scanned (trust below verified gate)', () => {
    const skill = makeSkill({ source: 'github' });
    const trust = computeTrustScore(skill, []);
    expect(trust).toBe(0.55);
    expect(deriveStatus(null)).toBe('published');
    expect(deriveTier(null, trust, 'code-full')).toBe('scanned');
  });

  it('clean mcp-registry metadata-only: trust=0.80, published, scanned (no code coverage)', () => {
    const skill = makeSkill({ source: 'mcp-registry' });
    const trust = computeTrustScore(skill, []);
    expect(trust).toBe(0.80);
    expect(deriveTier(null, trust, 'metadata-only')).toBe('scanned');
  });

  it('mcp-registry with full repo scan: trust=0.80, published, verified', () => {
    const skill = makeSkill({ source: 'mcp-registry' });
    const trust = computeTrustScore(skill, []);
    expect(trust).toBe(0.80);
    expect(deriveTier(null, trust, 'code-full')).toBe('verified');
  });

  it('CRITICAL CWE-78 on forge: trust=0.15, revoked, scanned', () => {
    const skill = makeSkill({ source: 'forge' });
    const findings = [makeFinding({ severity: 'CRITICAL', cweId: 'CWE-78' })];
    const trust = computeTrustScore(skill, findings);
    expect(trust).toBe(0.15);
    expect(deriveStatus('CRITICAL')).toBe('revoked');
    expect(deriveTier('CRITICAL', trust, 'code-full')).toBe('scanned');
  });

  it('multiple severe findings clamp trust at 0.0', () => {
    const skill = makeSkill({ source: 'forge' });
    const findings = [
      makeFinding({ severity: 'CRITICAL', cweId: 'CWE-78' }),
      makeFinding({ severity: 'HIGH', cweId: 'CWE-798' }),
      makeFinding({ severity: 'HIGH', phase: 'instruction_safety' }),
    ];
    expect(computeTrustScore(skill, findings)).toBe(0.0);
  });

  it('clean smithery with code-full: trust=0.65, published, but scanned (below 0.70 gate)', () => {
    const skill = makeSkill({ source: 'smithery' });
    const trust = computeTrustScore(skill, []);
    expect(trust).toBe(0.65);
    expect(deriveTier(null, trust, 'code-full')).toBe('scanned');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// buildRemediationMessage
// ══════════════════════════════════════════════════════════════════════════════

describe('buildRemediationMessage', () => {
  it('builds message with CWE ID + remediation hint', () => {
    const finding = makeFinding({
      severity: 'HIGH',
      cweId: 'CWE-89',
      remediationHint: 'Use parameterized queries',
    });
    const msg = buildRemediationMessage(finding, makeSkill());
    expect(msg).toContain('HIGH');
    expect(msg).toContain('CWE-89');
    expect(msg).toContain('Use parameterized queries');
  });

  it('builds minimal message without optional fields', () => {
    const finding = makeFinding({ severity: 'CRITICAL', cweId: 'CWE-78' });
    const msg = buildRemediationMessage(finding, makeSkill());
    expect(msg).toBe('CRITICAL finding: CWE-78');
  });

  it('falls back to title when no CWE ID', () => {
    const finding = makeFinding({ severity: 'MEDIUM', cweId: undefined, title: 'Insecure config' });
    const msg = buildRemediationMessage(finding, makeSkill());
    expect(msg).toContain('Insecure config');
  });

  it('includes phase line when phase present', () => {
    const finding = makeFinding({
      severity: 'CRITICAL',
      cweId: 'CWE-78',
      phase: 'instruction_safety',
    });
    const msg = buildRemediationMessage(finding, makeSkill());
    expect(msg).toContain('Phase: instruction_safety');
  });

  it('includes mismatch line when capabilityMismatch=true', () => {
    const finding = makeFinding({
      severity: 'HIGH',
      phase: 'capability_mismatch',
      capabilityMismatch: true,
    });
    const msg = buildRemediationMessage(finding, makeSkill());
    expect(msg).toContain('Mismatch: capability mismatch detected');
  });

  it('renders every optional field together', () => {
    const finding = makeFinding({
      severity: 'CRITICAL',
      cweId: 'CWE-77',
      phase: 'sast',
      remediationHint: 'Avoid shell exec',
      capabilityMismatch: true,
    });
    const msg = buildRemediationMessage(finding, makeSkill());
    expect(msg).toContain('CRITICAL finding: CWE-77');
    expect(msg).toContain('Phase: sast');
    expect(msg).toContain('Fix: Avoid shell exec');
    expect(msg).toContain('Mismatch: capability mismatch detected');
  });

  it('handles finding with no optional fields (no cweId/phase/hint/mismatch)', () => {
    const finding = makeFinding({
      severity: 'LOW',
      cweId: undefined,
      title: 'Minor issue',
      phase: undefined,
      remediationHint: undefined,
      capabilityMismatch: undefined,
    });
    expect(buildRemediationMessage(finding, makeSkill())).toBe('LOW finding: Minor issue');
  });

  it('preserves empty string cweId — `??` only nullish-coalesces null/undefined', () => {
    const finding = makeFinding({
      severity: 'MEDIUM',
      cweId: '',
      title: 'Suspicious pattern',
    });
    const msg = buildRemediationMessage(finding, makeSkill());
    // '' is truthy for ??, so message shows "MEDIUM finding: " (empty CWE)
    expect(msg).toContain('MEDIUM finding: ');
  });

  it('produces multi-line output ordered header/phase/hint', () => {
    const finding = makeFinding({
      severity: 'HIGH',
      cweId: 'CWE-89',
      phase: 'sast',
      remediationHint: 'Use parameterized queries',
    });
    const msg = buildRemediationMessage(finding, makeSkill());
    const lines = msg.split('\n');
    expect(lines.length).toBe(3);
    expect(lines[0]).toBe('HIGH finding: CWE-89');
    expect(lines[1]).toBe('Phase: sast');
    expect(lines[2]).toBe('Fix: Use parameterized queries');
  });

  it('omits phase line when phase is undefined', () => {
    const finding = makeFinding({
      severity: 'HIGH',
      cweId: 'CWE-89',
      phase: undefined,
      remediationHint: 'Use bcrypt',
    });
    const msg = buildRemediationMessage(finding, makeSkill());
    expect(msg).not.toContain('Phase:');
    expect(msg).toContain('Fix: Use bcrypt');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// D2 — parsePositiveFloat
// ══════════════════════════════════════════════════════════════════════════════

describe('parsePositiveFloat', () => {
  it('returns fallback for undefined', () => {
    expect(parsePositiveFloat(undefined, 0.05)).toBe(0.05);
  });

  it('returns fallback for empty string', () => {
    expect(parsePositiveFloat('', 0.05)).toBe(0.05);
  });

  it('parses valid positive float', () => {
    expect(parsePositiveFloat('0.10', 0.05)).toBe(0.10);
    expect(parsePositiveFloat('0.25', 0.05)).toBe(0.25);
    expect(parsePositiveFloat('1', 0)).toBe(1);
  });

  it('parses zero (zero is non-negative, so accepted)', () => {
    expect(parsePositiveFloat('0', 0.05)).toBe(0);
  });

  it('returns fallback for negative values', () => {
    expect(parsePositiveFloat('-0.01', 0.05)).toBe(0.05);
    expect(parsePositiveFloat('-100', 0.05)).toBe(0.05);
  });

  it('returns fallback for non-numeric input', () => {
    expect(parsePositiveFloat('nope', 0.05)).toBe(0.05);
    expect(parsePositiveFloat('abc', 0.05)).toBe(0.05);
  });

  it('returns fallback for NaN / Infinity', () => {
    expect(parsePositiveFloat('NaN', 0.05)).toBe(0.05);
    expect(parsePositiveFloat('Infinity', 0.05)).toBe(0.05);
  });

  it('DEFAULT_SIGNATURE_BONUS is 0.05', () => {
    expect(DEFAULT_SIGNATURE_BONUS).toBe(0.05);
  });

  it('DEFAULT_SIGNATURE_REVOKED_PENALTY is 0.20', () => {
    expect(DEFAULT_SIGNATURE_REVOKED_PENALTY).toBe(0.20);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// clampTrust
// ══════════════════════════════════════════════════════════════════════════════

describe('clampTrust', () => {
  it('rounds to 2 decimals', () => {
    expect(clampTrust(0.123456)).toBe(0.12);
    expect(clampTrust(0.555)).toBeCloseTo(0.56, 2);
  });

  it('clamps values above 1 to 1', () => {
    expect(clampTrust(1.5)).toBe(1);
    expect(clampTrust(100)).toBe(1);
  });

  it('clamps values below 0 to 0', () => {
    expect(clampTrust(-0.5)).toBe(0);
    expect(clampTrust(-100)).toBe(0);
  });

  it('leaves valid values in [0,1] untouched (up to rounding)', () => {
    expect(clampTrust(0)).toBe(0);
    expect(clampTrust(1)).toBe(1);
    expect(clampTrust(0.50)).toBe(0.50);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// effectiveTrustBadge
// ══════════════════════════════════════════════════════════════════════════════

describe('effectiveTrustBadge', () => {
  const verified = {
    signatureVerifiedAt: new Date(),
    signatureFailureReason: null,
    publisherKeyId: 'pk_test1234',
  };
  const unverified = {
    signatureVerifiedAt: null,
    signatureFailureReason: 'missing_signature',
    publisherKeyId: null,
  };

  it('returns null for null requested badge', () => {
    expect(effectiveTrustBadge(null, verified)).toBeNull();
  });

  it('returns null for undefined requested badge', () => {
    expect(effectiveTrustBadge(undefined, verified)).toBeNull();
  });

  it('passes auto-distilled through regardless of signature state', () => {
    expect(effectiveTrustBadge('auto-distilled', unverified)).toBe('auto-distilled');
    expect(effectiveTrustBadge('auto-distilled', verified)).toBe('auto-distilled');
  });

  it('passes upstream through regardless of signature state', () => {
    expect(effectiveTrustBadge('upstream', unverified)).toBe('upstream');
    expect(effectiveTrustBadge('upstream', verified)).toBe('upstream');
  });

  it('grants human-verified when signature fully verified + key id present', () => {
    expect(effectiveTrustBadge('human-verified', verified)).toBe('human-verified');
  });

  it('accepts a string signatureVerifiedAt (ISO string)', () => {
    expect(
      effectiveTrustBadge('human-verified', {
        signatureVerifiedAt: '2026-01-01T00:00:00Z',
        signatureFailureReason: null,
        publisherKeyId: 'pk_x',
      }),
    ).toBe('human-verified');
  });

  it('downgrades human-verified to null when signature missing', () => {
    expect(effectiveTrustBadge('human-verified', unverified)).toBeNull();
  });

  it('downgrades human-verified when failure reason present', () => {
    expect(
      effectiveTrustBadge('human-verified', {
        signatureVerifiedAt: new Date(),
        signatureFailureReason: 'bad_sig',
        publisherKeyId: 'pk_test1234',
      }),
    ).toBeNull();
  });

  it('downgrades human-verified when publisherKeyId missing', () => {
    expect(
      effectiveTrustBadge('human-verified', {
        signatureVerifiedAt: new Date(),
        signatureFailureReason: null,
        publisherKeyId: null,
      }),
    ).toBeNull();
  });

  it('downgrades human-verified when publisherKeyId is empty string', () => {
    expect(
      effectiveTrustBadge('human-verified', {
        signatureVerifiedAt: new Date(),
        signatureFailureReason: null,
        publisherKeyId: '',
      }),
    ).toBeNull();
  });

  it('downgrades human-verified when signatureVerifiedAt is undefined', () => {
    expect(
      effectiveTrustBadge('human-verified', {
        signatureVerifiedAt: undefined,
        signatureFailureReason: null,
        publisherKeyId: 'pk_x',
      }),
    ).toBeNull();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// applyRevocationScoring — SqlPool mock, port-only interaction
// ══════════════════════════════════════════════════════════════════════════════

describe('applyRevocationScoring', () => {
  it('passes keyId + penalty into the UPDATE parameters', async () => {
    const pool = mockPool(3);
    const out = await applyRevocationScoring(pool, 'pk_revoked', 0.25);
    expect(out.updated).toBe(3);
    expect(pool.query).toHaveBeenCalledTimes(1);
    const call = (pool.query as ReturnType<typeof vi.fn>).mock.calls[0];
    const [sql, params] = call;
    expect(sql).toContain('publisher_key_id = $1');
    expect(sql).toContain("signature_failure_reason = 'key_revoked'");
    expect(sql).toContain('signature_verified_at    = NULL');
    expect(sql).toContain("WHEN trust_badge = 'human-verified' THEN NULL");
    expect(params).toEqual(['pk_revoked', 0.25]);
  });

  it('uses whatever penalty the caller passes (default is DEFAULT_SIGNATURE_REVOKED_PENALTY)', async () => {
    const pool = mockPool(0);
    const out = await applyRevocationScoring(pool, 'pk_x', DEFAULT_SIGNATURE_REVOKED_PENALTY);
    expect(out.updated).toBe(0);
    const [, params] = (pool.query as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(params).toEqual(['pk_x', 0.20]);
  });

  it('returns 0 when no rows updated (idempotent re-delivery)', async () => {
    const pool = mockPool(0);
    const out = await applyRevocationScoring(pool, 'pk_never_seen', 0.20);
    expect(out.updated).toBe(0);
  });

  it('SQL is single-statement UPDATE ... RETURNING id (no side channels)', async () => {
    const pool = mockPool(1);
    await applyRevocationScoring(pool, 'pk_a', 0.10);
    const [sql] = (pool.query as ReturnType<typeof vi.fn>).mock.calls[0];
    // Exactly one UPDATE; no chained SELECT / DELETE / INSERT.
    expect(sql).toMatch(/^\s*UPDATE\s+skills/);
    expect(sql).not.toMatch(/;\s*\w+/); // no trailing statements after a semicolon
    expect(sql).toContain('RETURNING id');
  });

  it('idempotency clause: WHERE signature_failure_reason IS NULL', async () => {
    const pool = mockPool(1);
    await applyRevocationScoring(pool, 'pk_a', 0.10);
    const [sql] = (pool.query as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(sql).toContain('signature_failure_reason IS NULL');
  });

  it('falls back to rows.length when rowCount is undefined', async () => {
    const pool = {
      query: vi.fn().mockResolvedValue({
        rowCount: undefined,
        rows: [{ id: 's0' }, { id: 's1' }],
      }),
      connect: vi.fn(),
    } as unknown as SqlPool;
    const out = await applyRevocationScoring(pool, 'pk_y', 0.20);
    expect(out.updated).toBe(2);
  });
});
