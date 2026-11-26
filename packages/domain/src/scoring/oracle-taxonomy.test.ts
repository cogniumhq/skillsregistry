// ══════════════════════════════════════════════════════════════════════════════
// Oracle taxonomy — unit tests
// ══════════════════════════════════════════════════════════════════════════════

import { describe, it, expect } from 'vitest';
import {
  ORACLE_TYPE_RENAMES,
  oracleTypeFor,
  oracleTypesFor,
} from './oracle-taxonomy.js';
import * as scoring from './index.js';

describe('oracleTypeFor', () => {
  it('maps undisclosed_exfiltration to the oracle name data_exfiltration', () => {
    expect(oracleTypeFor('undisclosed_exfiltration')).toBe('data_exfiltration');
  });

  it('passes unaliased types through unchanged', () => {
    expect(oracleTypeFor('credential_exfiltration')).toBe('credential_exfiltration');
    expect(oracleTypeFor('data_exfiltration')).toBe('data_exfiltration');
  });

  it('does not resolve inherited object keys as aliases', () => {
    expect(oracleTypeFor('toString')).toBe('toString');
    expect(oracleTypeFor('__proto__')).toBe('__proto__');
  });
});

describe('oracleTypesFor', () => {
  it('lists the oracle name first, then the scanner name', () => {
    expect(oracleTypesFor('undisclosed_exfiltration')).toEqual([
      'data_exfiltration',
      'undisclosed_exfiltration',
    ]);
  });

  it('returns a single entry for unaliased types', () => {
    expect(oracleTypesFor('prompt_injection')).toEqual(['prompt_injection']);
  });
});

describe('ORACLE_TYPE_RENAMES', () => {
  it('is frozen and never maps a type to itself', () => {
    expect(Object.isFrozen(ORACLE_TYPE_RENAMES)).toBe(true);
    for (const [from, to] of Object.entries(ORACLE_TYPE_RENAMES)) {
      expect(to).not.toBe(from);
    }
  });

  it('is exported from the scoring barrel', () => {
    expect(scoring.oracleTypeFor('undisclosed_exfiltration')).toBe('data_exfiltration');
    expect(scoring.ORACLE_TYPE_RENAMES).toBe(ORACLE_TYPE_RENAMES);
  });
});
