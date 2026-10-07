// ════════════════════════════════════════════════════════════════════════════
// qa-guardrails — the rules that stop a QA publish touching a real namespace
// ════════════════════════════════════════════════════════════════════════════

import { describe, expect, it } from 'vitest';
import {
  QA_DESCRIPTION_PREFIX,
  QA_SLUG_PREFIX,
  QA_TENANT_ID,
  assertQaSlug,
  buildQaPublishBody,
  flagBool,
  isQaSlug,
  parseFlags,
  qaDescription,
  qaHeaders,
  qaSlug,
  qaTags,
  utcDateStamp,
} from './qa-guardrails.mts';

const DATE = '20261002';

describe('qaSlug', () => {
  it('adds the QA publisher prefix and the date stamp to a bare name', () => {
    expect(qaSlug('search', { date: DATE })).toBe(`${QA_SLUG_PREFIX}search-${DATE}`);
  });

  it('keeps a name that already carries a date stamp', () => {
    expect(qaSlug('search-20260915', { date: DATE })).toBe(
      `${QA_SLUG_PREFIX}search-20260915`,
    );
  });

  it('accepts a slug that is already fully qualified', () => {
    expect(qaSlug(`${QA_SLUG_PREFIX}pull-${DATE}`)).toBe(`${QA_SLUG_PREFIX}pull-${DATE}`);
  });

  it('defaults the date stamp to today in UTC', () => {
    expect(qaSlug('lineage')).toBe(`${QA_SLUG_PREFIX}lineage-${utcDateStamp()}`);
  });

  it('refuses the first-party publishers by name', () => {
    expect(() => qaSlug('@cogniumhq/real-skill')).toThrow(/first-party publisher/);
    expect(() => qaSlug('@cognium/real-skill')).toThrow(/first-party publisher/);
  });

  it('refuses any other publisher rather than rewriting it', () => {
    expect(() => qaSlug('acme/thing')).toThrow(/names another publisher/);
    expect(() => qaSlug('@cogniumhq-qa-sneaky/thing')).toThrow(/names another publisher/);
  });

  it('refuses an empty or malformed name', () => {
    expect(() => qaSlug('   ')).toThrow(/empty/);
    expect(() => qaSlug(QA_SLUG_PREFIX)).toThrow(/no name after the publisher/);
    expect(() => qaSlug('Search')).toThrow(/lower-case/);
    expect(() => qaSlug('search', { date: '2-oct' })).toThrow(/not yyyymmdd/);
  });
});

describe('isQaSlug / assertQaSlug', () => {
  it('is true only inside the QA namespace', () => {
    expect(isQaSlug(`${QA_SLUG_PREFIX}x-${DATE}`)).toBe(true);
    expect(isQaSlug('@cogniumhq/x')).toBe(false);
    expect(isQaSlug(undefined)).toBe(false);
    expect(isQaSlug(42)).toBe(false);
  });

  it('throws on anything outside it, naming what it refused', () => {
    expect(() => assertQaSlug('@cogniumhq/real')).toThrow(/refusing to act on/);
    expect(() => assertQaSlug(null)).toThrow(/only @cogniumhq-qa\/\* entries/);
    expect(assertQaSlug(`${QA_SLUG_PREFIX}x-${DATE}`)).toBe(`${QA_SLUG_PREFIX}x-${DATE}`);
  });
});

describe('qaTags', () => {
  it('forces both mandated tags, QA first', () => {
    expect(qaTags()).toEqual(['qa', 'cognium-internal']);
  });

  it('keeps extra tags without duplicating the mandated ones', () => {
    expect(qaTags(['browser', 'qa', 'browser', 'cognium-internal'])).toEqual([
      'qa',
      'cognium-internal',
      'browser',
    ]);
  });

  it('ignores non-strings and blanks', () => {
    expect(qaTags([1, '', '  ', null, ' search '])).toEqual([
      'qa',
      'cognium-internal',
      'search',
    ]);
  });
});

describe('qaDescription', () => {
  it('prefixes the description', () => {
    expect(qaDescription('Exercises /report.')).toBe(
      `${QA_DESCRIPTION_PREFIX} Exercises /report.`,
    );
  });

  it('does not double the prefix on a re-publish', () => {
    const once = qaDescription('Exercises /report.');
    expect(qaDescription(once)).toBe(once);
  });

  it('stands alone when there is nothing to say', () => {
    expect(qaDescription()).toBe(QA_DESCRIPTION_PREFIX);
    expect(qaDescription('   ')).toBe(QA_DESCRIPTION_PREFIX);
  });
});

describe('buildQaPublishBody', () => {
  const manifest = {
    name: 'QA search probe',
    slug: 'search',
    version: '1.2.0',
    description: 'Exercises /v1/search.',
    executionLayer: 'instructions',
    runtimeEnv: 'api',
    tags: ['search'],
    capabilitiesRequired: ['net'],
  };

  it('forces slug, tags and description and carries SKILL.md', () => {
    const body = buildQaPublishBody(manifest, '# QA\n', { date: DATE });
    expect(body).toEqual({
      name: 'QA search probe',
      slug: `${QA_SLUG_PREFIX}search-${DATE}`,
      version: '1.2.0',
      description: `${QA_DESCRIPTION_PREFIX} Exercises /v1/search.`,
      executionLayer: 'instructions',
      runtimeEnv: 'api',
      capabilitiesRequired: ['net'],
      tags: ['qa', 'cognium-internal', 'search'],
      skillMd: '# QA\n',
    });
  });

  it('lets --slug override the manifest, prefix and date still forced', () => {
    const body = buildQaPublishBody(manifest, '', { slug: 'report', date: DATE });
    expect(body.slug).toBe(`${QA_SLUG_PREFIX}report-${DATE}`);
    expect(body).not.toHaveProperty('skillMd');
  });

  it('refuses a manifest that names a real publisher', () => {
    expect(() =>
      buildQaPublishBody({ ...manifest, slug: '@cogniumhq/real' }, '', { date: DATE }),
    ).toThrow(/first-party publisher/);
  });

  it('defaults the version and derives a name when the manifest omits them', () => {
    const body = buildQaPublishBody(
      { slug: 'pull', executionLayer: 'instructions' },
      '',
      { date: DATE },
    );
    expect(body.version).toBe('1.0.0');
    expect(body.name).toBe(`pull-${DATE}`);
    expect(body.description).toBe(QA_DESCRIPTION_PREFIX);
  });

  it('insists on the fields the registry requires', () => {
    expect(() => buildQaPublishBody({ slug: 'x' }, '', { date: DATE })).toThrow(
      /executionLayer/,
    );
    expect(() => buildQaPublishBody({ executionLayer: 'instructions' }, '')).toThrow(
      /needs a `slug`/,
    );
  });

  it('drops manifest fields the publish contract does not carry', () => {
    const body = buildQaPublishBody(
      { ...manifest, trustScore: 0.99, verificationTier: 'verified' },
      '',
      { date: DATE },
    );
    expect(body).not.toHaveProperty('trustScore');
    expect(body).not.toHaveProperty('verificationTier');
  });
});

describe('qaHeaders', () => {
  it('always sends the one QA tenant id and no credential by default', () => {
    const headers = qaHeaders();
    expect(headers['x-tenant-id']).toBe(QA_TENANT_ID);
    expect(headers).not.toHaveProperty('authorization');
  });

  it('adds the bearer token when one is configured', () => {
    expect(qaHeaders('k1').authorization).toBe('Bearer k1');
    expect(qaHeaders('').authorization).toBeUndefined();
  });
});

describe('parseFlags / flagBool', () => {
  it('reads `--key value` pairs and bare switches', () => {
    expect(parseFlags(['--manifest', 'm.json', '--dry-run', '--date', '20261002'])).toEqual({
      manifest: 'm.json',
      'dry-run': true,
      date: '20261002',
    });
  });

  it('treats a switch as set even when a stray token followed it', () => {
    // `parseFlags` swallows the next bare token as a value, so `--dry-run junk`
    // lands as a string. A script that writes to production must still read
    // that as a dry run.
    const flags = parseFlags(['--dry-run', 'junk']);
    expect(flags['dry-run']).toBe('junk');
    expect(flagBool(flags, 'dry-run')).toBe(true);
    expect(flagBool(flags, 'revoke')).toBe(false);
  });
});
