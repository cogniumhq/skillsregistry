// ══════════════════════════════════════════════════════════════════════════════
// Oracle taxonomy — scanner finding type → validation-oracle threat type
// ══════════════════════════════════════════════════════════════════════════════
//
// The scanner and the skills validation oracle name some threats differently.
// A correct detection under the scanner's name fails the gate unless it is
// mapped. This table is the alias layer for that (issue #10); it grows one
// finding type at a time, each slice with its own tests.
//
// RENAMES: the oracle's primary name for the same threat. Unaliased types map
// to themselves, so the table is safe to apply to every finding.
//
// ══════════════════════════════════════════════════════════════════════════════

/** Scanner finding type → the oracle's primary name for the same threat. */
export const ORACLE_TYPE_RENAMES: Readonly<Record<string, string>> = Object.freeze({
  // Instruction-safety pass: an undisclosed outbound data flow is what the
  // oracle scores as `data_exfiltration`.
  undisclosed_exfiltration: 'data_exfiltration',
});

/** Primary oracle type for a scanner finding type (identity when unaliased). */
export function oracleTypeFor(findingType: string): string {
  return Object.hasOwn(ORACLE_TYPE_RENAMES, findingType)
    ? ORACLE_TYPE_RENAMES[findingType]!
    : findingType;
}

/**
 * Every oracle type a finding satisfies: the primary name first, then the
 * scanner's own name when it differs, so a gate matching either one passes.
 */
export function oracleTypesFor(findingType: string): string[] {
  const primary = oracleTypeFor(findingType);
  return primary === findingType ? [primary] : [primary, findingType];
}
