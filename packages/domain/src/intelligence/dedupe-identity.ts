// Search-time identity for cross-source copies of the same project.
//
// Display name is not an identity: unrelated projects share names. The
// repository URL is. When a row has no repository, the slug is the identity
// so two unpublished-source listings stay distinct.

const SSH_REPO = /^git@([^:/\s]+):(.+)$/i;

/** Canonical `host/path` form. Null when the value is empty. */
export function normalizeRepositoryUrl(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  let s = raw.trim();
  if (!s) return null;
  s = s.replace(/\.git$/i, '').replace(/\/+$/, '');

  const ssh = SSH_REPO.exec(s);
  const sshHost = ssh?.[1];
  const sshPath = ssh?.[2];
  if (sshHost && sshPath) {
    const host = sshHost.toLowerCase();
    const path = sshPath.replace(/^\/+/, '').replace(/\/+$/, '').toLowerCase();
    if (!path) return null;
    return `${host}/${path}`;
  }

  s = s.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '');
  s = s.replace(/^www\./i, '').toLowerCase();
  return s || null;
}

export function searchDedupeKey(skill: {
  repositoryUrl?: string | null;
  slug: string;
}): string {
  const repo = normalizeRepositoryUrl(skill.repositoryUrl);
  if (repo) return `repo:${repo}`;
  return `slug:${skill.slug.trim().toLowerCase()}`;
}

/**
 * Whether `candidate` should replace `existing` for the same identity.
 * A published row beats any other status, then higher score, then higher
 * trust score. Equal on all three keeps the row already chosen.
 */
export function preferSearchDuplicate<
  T extends { status: string; score: number; trustScore: number },
>(candidate: T, existing: T): boolean {
  const candidateLive = candidate.status === 'published';
  const existingLive = existing.status === 'published';
  if (candidateLive !== existingLive) return candidateLive;
  if (candidate.score !== existing.score) return candidate.score > existing.score;
  return candidate.trustScore > existing.trustScore;
}
