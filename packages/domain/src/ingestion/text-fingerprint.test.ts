// ══════════════════════════════════════════════════════════════════════════════
// text-fingerprint — unit tests
// ══════════════════════════════════════════════════════════════════════════════
//
// Ported and expanded from mothership `tests/ingestion/text-fingerprint.test.ts`.
// Verifies normalization semantics + SHA-256 identity across the whitespace/
// case surface. Runs against real Web Crypto (Node 20+ ships it globally).
//
// ══════════════════════════════════════════════════════════════════════════════

import { describe, it, expect } from 'vitest';
import { normalizeText, textNormSha256 } from './text-fingerprint.js';

describe('normalizeText', () => {
  it('lowercases input', () => {
    expect(normalizeText('HELLO World')).toBe('hello world');
  });

  it('trims leading and trailing whitespace', () => {
    expect(normalizeText('  hi  ')).toBe('hi');
    expect(normalizeText('\n\t hi \n')).toBe('hi');
  });

  it('collapses internal whitespace runs to a single space', () => {
    expect(normalizeText('foo   bar')).toBe('foo bar');
    expect(normalizeText('foo\t\tbar')).toBe('foo bar');
    expect(normalizeText('foo\n\nbar')).toBe('foo bar');
    expect(normalizeText('foo \t\n bar')).toBe('foo bar');
  });

  it('is a no-op on already-normalized text', () => {
    expect(normalizeText('foo bar baz')).toBe('foo bar baz');
  });

  it('handles empty string', () => {
    expect(normalizeText('')).toBe('');
  });

  it('handles whitespace-only string as empty', () => {
    expect(normalizeText('   \n\t   ')).toBe('');
  });

  it('preserves non-whitespace punctuation', () => {
    expect(normalizeText('  Hello, World!  ')).toBe('hello, world!');
  });

  it('preserves unicode', () => {
    expect(normalizeText('  Héllo  Wörld  ')).toBe('héllo wörld');
  });
});

describe('textNormSha256', () => {
  it('returns a 64-char lowercase hex digest', async () => {
    const hash = await textNormSha256('hello');
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash.length).toBe(64);
  });

  it('matches the known SHA-256 of "hello" (post-normalization is unchanged)', async () => {
    // SHA-256('hello') = 2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824
    const hash = await textNormSha256('hello');
    expect(hash).toBe('2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824');
  });

  it('matches SHA-256 of empty string for whitespace-only input', async () => {
    // SHA-256('') = e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
    const empty = await textNormSha256('');
    const whitespaceOnly = await textNormSha256('   \n\t   ');
    expect(empty).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(whitespaceOnly).toBe(empty);
  });

  it('is stable across identical inputs', async () => {
    const a = await textNormSha256('foo bar');
    const b = await textNormSha256('foo bar');
    expect(a).toBe(b);
  });

  it('differs for different inputs', async () => {
    const a = await textNormSha256('foo bar');
    const b = await textNormSha256('foo baz');
    expect(a).not.toBe(b);
  });

  it('is case-insensitive (mixed case hashes to the same value)', async () => {
    const lower = await textNormSha256('hello world');
    const mixed = await textNormSha256('Hello World');
    const upper = await textNormSha256('HELLO WORLD');
    expect(lower).toBe(mixed);
    expect(mixed).toBe(upper);
  });

  it('is whitespace-insensitive (collapsed runs hash the same)', async () => {
    const single = await textNormSha256('foo bar');
    const doubled = await textNormSha256('foo  bar');
    const tabbed = await textNormSha256('foo\tbar');
    const newlined = await textNormSha256('foo\nbar');
    expect(single).toBe(doubled);
    expect(doubled).toBe(tabbed);
    expect(tabbed).toBe(newlined);
  });

  it('is trim-insensitive', async () => {
    const trimmed = await textNormSha256('foo bar');
    const padded = await textNormSha256('  foo bar  ');
    expect(trimmed).toBe(padded);
  });

  it('handles unicode correctly (UTF-8 encoding)', async () => {
    // Non-ASCII input still produces a valid 64-char hex digest.
    const hash = await textNormSha256('café');
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash.length).toBe(64);
  });

  it('handles large inputs (10K chars)', async () => {
    const large = 'a'.repeat(10_000);
    const hash = await textNormSha256(large);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('differs for punctuation-only differences', async () => {
    // Punctuation is preserved by normalization, so it must affect the hash.
    const noPunct = await textNormSha256('hello world');
    const punct = await textNormSha256('hello, world!');
    expect(noPunct).not.toBe(punct);
  });
});
