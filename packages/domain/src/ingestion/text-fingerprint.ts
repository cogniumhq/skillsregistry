// ════════════════════════════════════════════════════════════════════════════
// Text fingerprint — SHA-256 of normalized source text (§10 A7)
// ════════════════════════════════════════════════════════════════════════════
//
// Used as one of two stamps on `skill_embeddings` rows. Paired with
// `embed_model` (model/dims identity), the fingerprint lets the embed
// consumer skip the llmproxy call when both stamps already match what
// would be produced.
//
// Normalization is intentionally minimal: lowercase, trim, collapse runs
// of whitespace. This matches the query-side cache key normalization so
// that semantically-identical inputs hash the same way regardless of
// incidental whitespace / case.
//
// Kept in lockstep with the `text_norm_sha256` column added by
// migration 0024_add_text_norm_sha256.sql in @skillsregistry/schema.
//
// ════════════════════════════════════════════════════════════════════════════

export function normalizeText(text: string): string {
  return text.toLowerCase().trim().replace(/\s+/g, ' ');
}

/**
 * SHA-256 hex digest of `normalizeText(text)`. 64-char lowercase hex string.
 *
 * Uses Web Crypto (available in Node 20+, Workers, and Deno) so the same
 * code runs unchanged across every deployment target.
 */
export async function textNormSha256(text: string): Promise<string> {
  const normalized = normalizeText(text);
  const data = new TextEncoder().encode(normalized);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
