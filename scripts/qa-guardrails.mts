// ════════════════════════════════════════════════════════════════════════════
// qa-guardrails.mts — the rules every QA publish obeys, in one place
// ════════════════════════════════════════════════════════════════════════════
//
// QA tests the hosted registry on production, because production is the only
// deployment that exists today. These constants and pure functions are what
// keep that safe; `qa-publish.mts` and `qa-cleanup.mts` are thin CLIs over
// them, and the tests next door pin the behaviour.
//
// The guardrails:
//
//   - **Namespace.** Publisher `@cogniumhq-qa`; every slug starts with
//     `@cogniumhq-qa/`. Never `@cognium/*` or `@cogniumhq/*` — those are
//     first-party names. A slug under any other publisher is refused rather
//     than rewritten: silently moving someone else's namespace into QA's
//     would be worse than failing.
//   - **Dated names.** `@cogniumhq-qa/<what>-<yyyymmdd>`, so an entry that
//     outlives its test case is obvious. A name without the date suffix gets
//     today's (UTC) appended.
//   - **Tags.** `qa` and `cognium-internal` on every entry. `qa` is the tag
//     the hosted registry's catalog-wide queries exclude on: `/v1/catalog/export`,
//     `/v1/reports/export` and every leaderboard (`trending` included) hide
//     anything carrying it. That predicate lives on the hosted side, not in
//     this repo — see docs/qa-publishing.md for which surfaces hide QA entries
//     and which deliberately do not.
//   - **Description.** Opens with `QA test entry — not for use.` so a human
//     who reaches the entry by slug or search knows what it is.
//
// Deliberately dependency-free (Node ≥ 22.18, or ≥ 22.6 with
// `--experimental-strip-types`): these scripts get run against production by
// whoever is on shift, sometimes from a checkout with no install.
//
// ════════════════════════════════════════════════════════════════════════════

/** Advisory tenant header QA sends. One value, never rotated — see below. */
export const QA_TENANT_ID = 'cogniumhq-qa';

/** Publisher segment. The `@` is part of the name. */
export const QA_PUBLISHER = '@cogniumhq-qa';

/** Every QA slug starts with this. The one hard gate before a POST. */
export const QA_SLUG_PREFIX = `${QA_PUBLISHER}/`;

/** Forced onto every entry. `qa` is what the exclusion predicate reads. */
export const QA_TAGS: readonly string[] = ['qa', 'cognium-internal'];

/** Forced onto the front of every description. */
export const QA_DESCRIPTION_PREFIX = 'QA test entry — not for use.';

/**
 * Reads go to the public host. Writes do not: `api.skillsregistry.net` is
 * read-only by design and 404s every write — the hosted registry restricts the
 * public custom domain to a read-only allowlist (see `apps/local/README.md`
 * → Connected). Publishing is operator-only on the `workers.dev` origin.
 * Override either with `--endpoint` / `--read-endpoint`.
 */
export const QA_READ_ENDPOINT = 'https://api.skillsregistry.net';
export const QA_WRITE_ENDPOINT = 'https://skillsregistry.cognium.workers.dev';

/** `<what>-<yyyymmdd>`: the trailing date is what the convention asks for. */
const DATED_NAME = /-\d{8}$/;

/** Publishers QA must never publish under, prefix-matched. */
const FIRST_PARTY_PREFIXES = ['@cognium/', '@cogniumhq/'];

export function utcDateStamp(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10).replace(/-/g, '');
}

/**
 * Normalise a slug or bare name into a guarded QA slug.
 *
 * Accepts `search-20261002`, `search` or `@cogniumhq-qa/search-20261002`;
 * adds the publisher prefix and today's date stamp when they are missing.
 * Throws on a slug that names a different publisher — including the
 * first-party namespaces, which get their own message because confusing
 * `@cogniumhq` with `@cogniumhq-qa` is the expensive mistake here.
 */
export function qaSlug(input: string, opts: { date?: string } = {}): string {
  const raw = input.trim();
  if (raw === '') throw new Error('slug is empty');

  for (const prefix of FIRST_PARTY_PREFIXES) {
    if (raw.startsWith(prefix)) {
      throw new Error(
        `refusing to publish under the first-party publisher ${prefix.slice(0, -1)} — ` +
          `QA entries belong to ${QA_PUBLISHER}`,
      );
    }
  }

  let name: string;
  if (raw.startsWith(QA_SLUG_PREFIX)) {
    name = raw.slice(QA_SLUG_PREFIX.length);
  } else if (raw.includes('/')) {
    throw new Error(
      `slug ${JSON.stringify(raw)} names another publisher — ` +
        `QA slugs start with ${QA_SLUG_PREFIX}`,
    );
  } else {
    name = raw;
  }

  if (name === '') throw new Error(`slug ${JSON.stringify(raw)} has no name after the publisher`);
  if (!/^[a-z0-9][a-z0-9._-]*$/.test(name)) {
    throw new Error(
      `name ${JSON.stringify(name)} must be lower-case alphanumerics with . _ -`,
    );
  }

  const date = opts.date ?? utcDateStamp();
  if (!/^\d{8}$/.test(date)) throw new Error(`date ${JSON.stringify(date)} is not yyyymmdd`);

  return `${QA_SLUG_PREFIX}${DATED_NAME.test(name) ? name : `${name}-${date}`}`;
}

/** True only for slugs inside QA's namespace. The cleanup safety net. */
export function isQaSlug(slug: unknown): slug is string {
  return typeof slug === 'string' && slug.startsWith(QA_SLUG_PREFIX);
}

/**
 * The last gate before a write. Every request either script sends is
 * addressed to a slug that passed through here, so a bug upstream of it
 * cannot touch a non-QA entry.
 */
export function assertQaSlug(slug: unknown): string {
  if (!isQaSlug(slug)) {
    throw new Error(
      `refusing to act on ${JSON.stringify(slug)} — only ${QA_SLUG_PREFIX}* entries`,
    );
  }
  return slug;
}

/** `qa` + `cognium-internal` first, then whatever the manifest asked for. */
export function qaTags(tags: readonly unknown[] = []): string[] {
  const extra = tags
    .filter((t): t is string => typeof t === 'string' && t.trim() !== '')
    .map((t) => t.trim())
    .filter((t) => !QA_TAGS.includes(t));
  return [...QA_TAGS, ...new Set(extra)];
}

/** Prefix the description, without doubling it on a re-publish. */
export function qaDescription(description?: unknown): string {
  const text = typeof description === 'string' ? description.trim() : '';
  if (text.startsWith(QA_DESCRIPTION_PREFIX)) return text;
  return text === '' ? QA_DESCRIPTION_PREFIX : `${QA_DESCRIPTION_PREFIX} ${text}`;
}

/** Manifest fields `POST /v1/skills` accepts, as `tools/sr-publish.mjs` sends them. */
const PASS_THROUGH_FIELDS = [
  'name',
  'version',
  'executionLayer',
  'runtimeEnv',
  'category',
  'capabilitiesRequired',
  'mcpUrl',
  'sourceUrl',
  'repositoryUrl',
  'installMethod',
  'schemaJson',
  'agentSummary',
  'alternateQueries',
  'agentProfile',
  'sandbox',
] as const;

export interface QaPublishBody {
  name: string;
  slug: string;
  version: string;
  description: string;
  executionLayer: string;
  tags: string[];
  skillMd?: string;
  [field: string]: unknown;
}

/**
 * Build the publish body: the manifest's own fields, with slug, tags and
 * description replaced by their guarded forms and `skillMd` carrying the
 * SKILL.md read off disk.
 */
export function buildQaPublishBody(
  manifest: Record<string, unknown>,
  skillMd: string,
  opts: { slug?: string; date?: string } = {},
): QaPublishBody {
  const slugInput = opts.slug ?? manifest.slug ?? manifest.name;
  if (typeof slugInput !== 'string') {
    throw new Error('manifest needs a `slug` (or a `name` to derive one from)');
  }
  const slug = assertQaSlug(qaSlug(slugInput, opts.date === undefined ? {} : { date: opts.date }));

  const body: Record<string, unknown> = {};
  for (const field of PASS_THROUGH_FIELDS) {
    if (manifest[field] !== undefined) body[field] = manifest[field];
  }

  const name = typeof manifest.name === 'string' && manifest.name.trim() !== ''
    ? manifest.name.trim()
    : slug.slice(QA_SLUG_PREFIX.length);
  const executionLayer = manifest.executionLayer;
  if (typeof executionLayer !== 'string' || executionLayer === '') {
    throw new Error('manifest needs an `executionLayer` (e.g. "instructions")');
  }

  return {
    ...body,
    name,
    slug,
    version: typeof manifest.version === 'string' ? manifest.version : '1.0.0',
    description: qaDescription(manifest.description),
    executionLayer,
    tags: qaTags(Array.isArray(manifest.tags) ? manifest.tags : []),
    ...(skillMd === '' ? {} : { skillMd }),
  };
}

// ── Shared CLI plumbing ─────────────────────────────────────────────────────

export function parseFlags(args: readonly string[]): Record<string, string | true> {
  const flags: Record<string, string | true> = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (!arg.startsWith('--')) continue;
    const next = args[i + 1];
    if (next === undefined || next.startsWith('--')) flags[arg.slice(2)] = true;
    else {
      flags[arg.slice(2)] = next;
      i++;
    }
  }
  return flags;
}

export function flagString(
  flags: Record<string, string | true>,
  key: string,
): string | undefined {
  const value = flags[key];
  return typeof value === 'string' && value !== '' ? value : undefined;
}

/**
 * Presence is truth for a switch. `parseFlags` swallows the next bare token
 * as a value (`--dry-run foo` parses as `{'dry-run': 'foo'}`), and a script
 * that writes to production must not read that as "not a dry run".
 */
export function flagBool(flags: Record<string, string | true>, key: string): boolean {
  return Object.hasOwn(flags, key);
}

export const stripSlash = (url: string): string => url.replace(/\/+$/, '');

/**
 * Headers every QA request carries.
 *
 * `authorization` is the credential the hosted registry's write gate checks on
 * internet ingress — its internal write key or admin key. Callers read it out
 * of `SR_WRITE_API_KEY` / `ADMIN_API_KEY` and pass it in. It is OPTIONAL today
 * only because that gate runs in warn mode: an unauthenticated write is allowed
 * through with an `X-Write-Auth-Warning` response header and a log line. When
 * it flips to enforce — which is the fail-closed default — the same request
 * becomes a 401 and the key stops being optional. Set it now; nothing changes
 * until the flip, and nothing breaks after it.
 *
 * `X-Tenant-Id` is the same value on every call: the 600 rpm budget is per
 * tenant, and rotating the header to buy a fresh budget is exactly the abuse
 * the tenant-binding change exists to stop. One tenant, one budget, back off
 * on 429. Note it grants nothing — the registry only honors a tenant assertion
 * on trusted ingress, never on a public hostname.
 */
export function qaHeaders(apiKey?: string): Record<string, string> {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    accept: 'application/json',
    'x-tenant-id': QA_TENANT_ID,
  };
  if (apiKey !== undefined && apiKey !== '') headers.authorization = `Bearer ${apiKey}`;
  return headers;
}

export interface QaResponse {
  status: number;
  body: unknown;
}

/** One request, parsed leniently — error pages are not always JSON. */
export async function qaFetch(
  url: string,
  init: RequestInit,
  fetchImpl: typeof fetch = fetch,
): Promise<QaResponse> {
  const res = await fetchImpl(url, init);
  const text = await res.text();
  let body: unknown = text;
  try {
    body = text === '' ? null : JSON.parse(text);
  } catch {
    /* not JSON — keep the text */
  }
  return { status: res.status, body };
}

export function describeFailure(step: string, res: QaResponse): Error {
  const body = res.body !== null && typeof res.body === 'object'
    ? JSON.stringify(res.body)
    : String(res.body ?? '');
  return new Error(`${step}: HTTP ${res.status} ${body}`.trim());
}

/** Pacing between writes. The budget is 600 rpm; this keeps us well under. */
export const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));
