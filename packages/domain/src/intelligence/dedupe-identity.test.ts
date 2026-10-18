import { describe, expect, it } from 'vitest';
import {
  normalizeRepositoryUrl,
  preferSearchDuplicate,
  searchDedupeKey,
} from './dedupe-identity.js';

describe('normalizeRepositoryUrl', () => {
  it('returns null for empty values', () => {
    expect(normalizeRepositoryUrl(null)).toBeNull();
    expect(normalizeRepositoryUrl(undefined)).toBeNull();
    expect(normalizeRepositoryUrl('   ')).toBeNull();
  });

  it('treats https, trailing slash, .git, and ssh as the same repo', () => {
    const expected = 'github.com/owner/repo';
    expect(normalizeRepositoryUrl('https://github.com/Owner/Repo.git')).toBe(expected);
    expect(normalizeRepositoryUrl('https://github.com/owner/repo/')).toBe(expected);
    expect(normalizeRepositoryUrl('http://www.github.com/owner/repo')).toBe(expected);
    expect(normalizeRepositoryUrl('git@github.com:owner/repo.git')).toBe(expected);
    expect(normalizeRepositoryUrl('https://github.com/owner/repo.git/')).toBe(expected);
  });

  it('keeps nested group paths', () => {
    expect(normalizeRepositoryUrl('https://gitlab.com/group/sub/repo.git')).toBe(
      'gitlab.com/group/sub/repo',
    );
  });
});

describe('searchDedupeKey', () => {
  it('keys on the repository when one is present', () => {
    expect(
      searchDedupeKey({
        slug: 'glama-weather',
        repositoryUrl: 'https://github.com/acme/weather.git',
      }),
    ).toBe('repo:github.com/acme/weather');
  });

  it('falls back to the slug when there is no repository', () => {
    expect(searchDedupeKey({ slug: 'Weather-A', repositoryUrl: null })).toBe('slug:weather-a');
    expect(searchDedupeKey({ slug: 'weather-b' })).toBe('slug:weather-b');
  });

  it('does not merge different projects that share a display name', () => {
    const a = searchDedupeKey({ slug: 'acme-gmail', repositoryUrl: 'https://github.com/acme/gmail' });
    const b = searchDedupeKey({ slug: 'other-gmail', repositoryUrl: 'https://github.com/other/gmail' });
    expect(a).not.toBe(b);
  });
});

describe('preferSearchDuplicate', () => {
  const row = (over: Partial<{ status: string; score: number; trustScore: number }>) => ({
    status: 'published',
    score: 0.5,
    trustScore: 0.5,
    ...over,
  });

  it('keeps a published row over a higher-scoring deprecated row', () => {
    const published = row({ status: 'published', score: 0.4 });
    const deprecated = row({ status: 'deprecated', score: 0.9 });
    expect(preferSearchDuplicate(published, deprecated)).toBe(true);
    expect(preferSearchDuplicate(deprecated, published)).toBe(false);
  });

  it('keeps the higher score when both are published', () => {
    expect(preferSearchDuplicate(row({ score: 0.8 }), row({ score: 0.2 }))).toBe(true);
    expect(preferSearchDuplicate(row({ score: 0.2 }), row({ score: 0.8 }))).toBe(false);
  });

  it('breaks a score tie with trust score', () => {
    expect(
      preferSearchDuplicate(row({ score: 0.5, trustScore: 0.9 }), row({ score: 0.5, trustScore: 0.2 })),
    ).toBe(true);
  });
});
