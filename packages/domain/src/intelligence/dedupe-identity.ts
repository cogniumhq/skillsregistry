// Search-time identity for cross-source copies of the same project.
//
// Display name is not an identity: unrelated projects share names. The
// repository URL is. When a row has no repository, the slug is the identity
// so two unpublished-source listings stay distinct.

const SSH_REPO = /^git@([^:/\s]+):(.+)$/i;
const SCP_STYLE_GIT = /^git@([^:/\s]+)[/:](.+)$/i;

/** GitHub web UI paths after `owner/repo` — not part of clone identity. */
const GITHUB_WEB_SEGMENTS = new Set([
  'tree',
  'blob',
  'pull',
  'issues',
  'wiki',
  'commit',
  'releases',
  'actions',
  'settings',
  'packages',
  'discussions',
  'projects',
]);

function stripGitHubWebPath(hostPath: string): string {
  const parts = hostPath.split('/');
  if (parts.length < 3 || parts[0] !== 'github.com') return hostPath;
  const segment = parts[3]?.toLowerCase();
  if (!segment || !GITHUB_WEB_SEGMENTS.has(segment)) return hostPath;
  return `${parts[0]}/${parts[1]}/${parts[2]}`;
}

/** GitLab browser URLs use `/-/tree/`, `/-/blob/`, etc. after the project path. */
function stripGitLabWebPath(hostPath: string): string {
  if (!hostPath.startsWith('gitlab.com/')) return hostPath;
  const dash = hostPath.indexOf('/-/');
  return dash === -1 ? hostPath : hostPath.slice(0, dash);
}

function stripWebUiPath(hostPath: string): string {
  return stripGitLabWebPath(stripGitHubWebPath(hostPath));
}

function canonicalHostPath(host: string, path: string): string | null {
  const h = host.toLowerCase();
  const p = path.replace(/^\/+/, '').replace(/\/+$/, '').toLowerCase();
  if (!p) return null;
  return stripWebUiPath(`${h}/${p}`);
}

/** Canonical `host/path` form. Null when the value is empty. */
export function normalizeRepositoryUrl(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  let s = raw.trim();
  if (!s) return null;
  // Strip trailing slashes before `.git` so `repo.git/` canonicalizes like `repo.git`.
  s = s.replace(/\/+$/, '').replace(/\.git$/i, '').replace(/\/+$/, '');
  // `ssh://git@host/path` and `git+ssh://git@host/path` — slash separator, not `:`
  s = s.replace(/^(?:git\+ssh|ssh):\/\//i, '');

  const ssh = SSH_REPO.exec(s);
  const sshHost = ssh?.[1];
  const sshPath = ssh?.[2];
  if (sshHost && sshPath) {
    return canonicalHostPath(sshHost, sshPath);
  }

  const scp = SCP_STYLE_GIT.exec(s);
  if (scp?.[1] && scp[2]) {
    return canonicalHostPath(scp[1], scp[2]);
  }

  s = s.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '');
  s = s.replace(/^www\./i, '').toLowerCase();
  return s ? stripWebUiPath(s) : null;
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
