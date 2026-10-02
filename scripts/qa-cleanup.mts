#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════════════
// qa-cleanup.mts — close out the QA entries on the hosted registry
// ════════════════════════════════════════════════════════════════════════════
//
//   node scripts/qa-cleanup.mts --dry-run         # what would change
//   node scripts/qa-cleanup.mts                   # set every entry deprecated
//
// QA marks an entry `deprecated` when its case closes. This script finds the
// entries and does that.
//
// It finds them two ways and takes the union:
//
//   1. the ledger `qa-publish.mts` writes (`./qa-published.json`), and
//   2. a search for the `qa` tag on the read host — which works precisely
//      because search deliberately does NOT exclude QA entries. Catalog-wide
//      surfaces hide them; targeted ones don't. See docs/qa-publishing.md
//      for which surface is which.
//
// Then it drops everything whose slug is not under `@cogniumhq-qa/`. That
// filter, not the discovery, is the safety property: a wrong search hit or a
// stale ledger line can never turn into a write against a real skill. The
// check runs again immediately before each request is built.
//
// **Route shapes.** Deprecation is `PATCH /v1/skills/:id/status` on the hosted
// registry, and `:id` is the skill's **UUID**, not its slug. So each
// discovered slug is resolved to an id first, via `GET /v1/skills/:slug`,
// falling back to the `skillId` the ledger recorded at publish time. The
// hosted handler's owner-initiated transition guard allows
// `published → deprecated` and back, nothing else — a 409 from it means the
// entry was in some other state and is reported, not retried.
//
// **There is no `--revoke`.** The hosted registry exposes no operator route
// that revokes an arbitrary skill. The only ways a row reaches
// `status='revoked'` are the Cognium attestation callback (which stamps
// `revoked_reason='content_safety_failed'` — a false statement about a QA
// entry, and the one route the write gate deliberately keeps
// un-author-writable), the publisher-key revocation cascade, and a direct
// database `UPDATE`. Revoking a QA entry is therefore an operator action on
// the database. `deprecated` is the lifecycle state QA owns, and it is enough:
// a deprecated entry is already out of the export, the report feed and every
// leaderboard by virtue of the `qa` tag.
//
// Flags:
//   --slugs a,b,c       extra slugs to include (still prefix-checked)
//   --query TEXT        search probe (default: the QA description prefix)
//   --limit N           search page size, 1..50 (default 50)
//   --endpoint URL      write origin (default: the workers.dev origin)
//   --read-endpoint URL read host (default api.skillsregistry.net)
//   --ledger FILE       ledger path (default ./qa-published.json)
//   --no-ledger         ignore the ledger; discover by search only
//   --dry-run           print the planned requests and exit
//
// Env: SR_WRITE_API_KEY — operator write key, sent as `Authorization: Bearer`.
//      Optional while the registry's write gate is in warn mode (today);
//      required once it enforces. ADMIN_API_KEY works too — the gate accepts
//      either.
//
// ════════════════════════════════════════════════════════════════════════════

import { readFile } from 'node:fs/promises';
import { argv, env, exit, stderr, stdout } from 'node:process';
import { pathToFileURL } from 'node:url';
import {
  QA_DESCRIPTION_PREFIX,
  QA_READ_ENDPOINT,
  QA_SLUG_PREFIX,
  QA_TAGS,
  QA_WRITE_ENDPOINT,
  assertQaSlug,
  describeFailure,
  flagBool,
  flagString,
  isQaSlug,
  parseFlags,
  qaFetch,
  qaHeaders,
  sleep,
  stripSlash,
} from './qa-guardrails.mts';
import { DEFAULT_LEDGER } from './qa-publish.mts';

/**
 * The hosted deprecation route. `skillId` is the skill's UUID — the handler
 * looks it up by primary key, so a slug here yields a 404. `reason` rides
 * along: the handler accepts it and stores it on the skill.
 */
export const DEPRECATE = (endpoint: string, skillId: string, reason?: string) => ({
  method: 'PATCH',
  url: `${endpoint}/v1/skills/${encodeURIComponent(skillId)}/status`,
  body: {
    status: 'deprecated',
    ...(reason === undefined ? {} : { reason }),
  } as Record<string, unknown>,
});

/** Pacing between writes — the tenant budget is 600 rpm. */
const WRITE_SPACING_MS = 120;

// ── Discovery ───────────────────────────────────────────────────────────────

export async function slugsFromLedger(path: string): Promise<string[]> {
  return (await ledgerEntries(path)).map((e) => e.slug);
}

/**
 * Ledger rows, QA-filtered, newest occurrence of a slug winning. The `skillId`
 * `qa-publish.mts` recorded at publish time is the cheap path to the UUID the
 * deprecation route needs — it saves a `GET /v1/skills/:slug` per entry, and
 * it still works for an entry that search has not indexed yet.
 */
export async function ledgerEntries(
  path: string,
): Promise<Array<{ slug: string; skillId?: string }>> {
  try {
    const parsed = JSON.parse(await readFile(path, 'utf8')) as { entries?: unknown };
    if (!Array.isArray(parsed.entries)) return [];
    const bySlug = new Map<string, { slug: string; skillId?: string }>();
    for (const raw of parsed.entries) {
      const { slug, skillId } = (raw ?? {}) as { slug?: unknown; skillId?: unknown };
      if (!isQaSlug(slug)) continue;
      bySlug.set(slug, {
        slug,
        ...(typeof skillId === 'string' && skillId !== '' ? { skillId } : {}),
      });
    }
    return [...bySlug.values()];
  } catch (err) {
    if ((err as { code?: string }).code === 'ENOENT') return [];
    throw err;
  }
}

export async function slugsFromSearch(opts: {
  readEndpoint: string;
  query: string;
  limit: number;
  apiKey?: string;
  fetchImpl?: typeof fetch;
}): Promise<string[]> {
  const url =
    `${stripSlash(opts.readEndpoint)}/v1/search` +
    `?q=${encodeURIComponent(opts.query)}` +
    `&tags=${encodeURIComponent(QA_TAGS.join(','))}` +
    `&limit=${opts.limit}`;
  const res = await qaFetch(
    url,
    { method: 'GET', headers: qaHeaders(opts.apiKey) },
    opts.fetchImpl ?? fetch,
  );
  if (res.status !== 200) throw describeFailure('search', res);

  const body = (res.body ?? {}) as { skills?: unknown; results?: unknown };
  const rows = Array.isArray(body.skills)
    ? body.skills
    : Array.isArray(body.results)
      ? body.results
      : Array.isArray(res.body)
        ? (res.body as unknown[])
        : [];
  return rows.map((r) => (r as { slug?: unknown }).slug).filter(isQaSlug);
}

/** Union of every source, deduped, sorted, and prefix-filtered. */
export function qaSlugsOnly(...sources: readonly (readonly unknown[])[]): string[] {
  const slugs = new Set<string>();
  for (const source of sources) {
    for (const slug of source) if (isQaSlug(slug)) slugs.add(slug);
  }
  return [...slugs].sort();
}

// ── Slug → id resolution ────────────────────────────────────────────────────

/** One entry to act on. `skillId` is what the deprecation route addresses. */
export interface QaTarget {
  slug: string;
  skillId?: string;
}

/**
 * Resolve a QA slug to its skill UUID via `GET /v1/skills/:slug` — a targeted
 * read, which is exactly the surface QA entries stay visible on. Returns
 * `undefined` on a 404 (already gone) and throws on anything else, so a
 * read-host outage does not quietly look like an empty catalog.
 */
export async function resolveSkillId(opts: {
  readEndpoint: string;
  slug: string;
  apiKey?: string;
  fetchImpl?: typeof fetch;
}): Promise<string | undefined> {
  const slug = assertQaSlug(opts.slug);
  const res = await qaFetch(
    `${stripSlash(opts.readEndpoint)}/v1/skills/${encodeURIComponent(slug)}`,
    { method: 'GET', headers: qaHeaders(opts.apiKey) },
    opts.fetchImpl ?? fetch,
  );
  if (res.status === 404) return undefined;
  if (res.status !== 200) throw describeFailure(`resolve ${slug}`, res);
  const id = (res.body as { id?: unknown } | null)?.id;
  if (typeof id !== 'string' || id === '') {
    throw new Error(`resolve ${slug}: response carried no id`);
  }
  return id;
}

/**
 * Fill in the UUID for every target that the ledger did not already supply.
 * The ledger is a convenience; the read host is the source of truth, and a
 * target that resolves to nothing is reported rather than skipped silently.
 */
export async function resolveTargets(opts: {
  targets: readonly QaTarget[];
  readEndpoint: string;
  apiKey?: string;
  fetchImpl?: typeof fetch;
}): Promise<QaTarget[]> {
  const resolved: QaTarget[] = [];
  for (const target of opts.targets) {
    if (target.skillId !== undefined) {
      resolved.push(target);
      continue;
    }
    const skillId = await resolveSkillId({
      readEndpoint: opts.readEndpoint,
      slug: target.slug,
      ...(opts.apiKey === undefined ? {} : { apiKey: opts.apiKey }),
      ...(opts.fetchImpl === undefined ? {} : { fetchImpl: opts.fetchImpl }),
    });
    resolved.push(skillId === undefined ? target : { ...target, skillId });
  }
  return resolved;
}

// ── Cleanup ─────────────────────────────────────────────────────────────────

export interface CleanupOptions {
  targets: readonly QaTarget[];
  endpoint: string;
  reason?: string;
  apiKey?: string;
  dryRun?: boolean;
  fetchImpl?: typeof fetch;
  log?: (line: string) => void;
  spacingMs?: number;
}

export interface CleanupOutcome {
  slug: string;
  status: 'changed' | 'planned' | 'unresolved' | 'unsupported' | 'failed';
  detail?: string;
}

/**
 * Deprecate each target, one request at a time. Every slug passes
 * `assertQaSlug` immediately before its request is built, so the namespace
 * gate sits on the write path itself and not only on discovery.
 */
export async function cleanupQaEntries(opts: CleanupOptions): Promise<CleanupOutcome[]> {
  const log = opts.log ?? ((line: string) => stdout.write(line));
  const fetchImpl = opts.fetchImpl ?? fetch;
  const outcomes: CleanupOutcome[] = [];

  for (const [index, target] of opts.targets.entries()) {
    const slug = assertQaSlug(target.slug);

    if (target.skillId === undefined) {
      // No UUID means no addressable route. Reported, never guessed at — a
      // PATCH keyed on the slug would 404 and read as "already gone".
      outcomes.push({
        slug,
        status: 'unresolved',
        detail: 'no skill id — not in the ledger and GET /v1/skills/:slug returned 404',
      });
      log(`! ${slug}: unresolved (no skill id), nothing changed\n`);
      continue;
    }

    const request = DEPRECATE(opts.endpoint, target.skillId, opts.reason);

    if (opts.dryRun === true) {
      log(`would deprecate ${slug}: ${request.method} ${request.url} ${JSON.stringify(request.body)}\n`);
      outcomes.push({ slug, status: 'planned' });
      continue;
    }

    if (index > 0) await sleep(opts.spacingMs ?? WRITE_SPACING_MS);

    const res = await qaFetch(
      request.url,
      {
        method: request.method,
        headers: qaHeaders(opts.apiKey),
        body: JSON.stringify(request.body),
      },
      fetchImpl,
    );

    if (res.status === 404 || res.status === 405) {
      outcomes.push({
        slug,
        status: 'unsupported',
        detail: `HTTP ${res.status} on ${request.method} ${request.url} — this registry build does not expose that route (or the entry is gone)`,
      });
      log(`! ${slug}: HTTP ${res.status} — route not available, nothing changed\n`);
      continue;
    }
    // 409 is the handler's transition guard: already deprecated, or in a state
    // only Cognium can move it out of. Not a failure of this run.
    if (res.status === 409) {
      outcomes.push({ slug, status: 'unsupported', detail: describeFailure('deprecate', res).message });
      log(`- ${slug}: HTTP 409 — not a published→deprecated transition, left alone\n`);
      continue;
    }
    if (res.status < 200 || res.status >= 300) {
      const failure = describeFailure('deprecate', res);
      outcomes.push({ slug, status: 'failed', detail: failure.message });
      log(`! ${slug}: ${failure.message}\n`);
      continue;
    }

    outcomes.push({ slug, status: 'changed' });
    log(`deprecated ${slug}\n`);
  }

  return outcomes;
}

// ── CLI ─────────────────────────────────────────────────────────────────────

const HELP = `qa-cleanup.mts — deprecate the ${QA_SLUG_PREFIX}* entries

  node scripts/qa-cleanup.mts [--dry-run]

  --reason REASON     deprecation reason recorded on the skill
  --slugs a,b,c       extra slugs to include
  --query TEXT        search probe (default ${JSON.stringify(QA_DESCRIPTION_PREFIX)})
  --limit N           search page size 1..50 (default 50)
  --endpoint URL      write origin (default ${QA_WRITE_ENDPOINT})
  --read-endpoint URL read host (default ${QA_READ_ENDPOINT})
  --ledger FILE       ledger path (default ${DEFAULT_LEDGER})
  --no-ledger         discover by search only
  --dry-run           print the planned requests and exit

  Env SR_WRITE_API_KEY is sent as Authorization: Bearer (ADMIN_API_KEY works
  too). Optional while the registry's write gate is in warn mode (today);
  required once it enforces.

  Deprecation is PATCH /v1/skills/:id/status, keyed on the skill UUID, so each
  slug is resolved via GET /v1/skills/:slug (or the ledger's recorded id).
  There is no --revoke: this registry exposes no operator revoke route — see
  the header note. Only ${QA_SLUG_PREFIX}* slugs are ever touched.
  Guardrails: docs/qa-publishing.md
`;

async function main(): Promise<void> {
  const flags = parseFlags(argv.slice(2));
  if (flagBool(flags, 'help') || flagBool(flags, 'h')) {
    stdout.write(HELP);
    return;
  }

  if (flagBool(flags, 'revoke')) {
    throw new Error(
      '--revoke is not available: this registry exposes no operator revoke route. ' +
        'Deprecate instead (the default), and revoke via the database if an entry ' +
        'really must leave the catalog — see the header note in this file.',
    );
  }

  // The write gate accepts either the write key or the admin key; prefer the
  // narrower one. Both are optional while it is in warn mode.
  const apiKey = env.SR_WRITE_API_KEY || env.ADMIN_API_KEY;

  const endpoint = stripSlash(flagString(flags, 'endpoint') ?? QA_WRITE_ENDPOINT);
  const readEndpoint = stripSlash(flagString(flags, 'read-endpoint') ?? QA_READ_ENDPOINT);
  const ledgerPath = flagString(flags, 'ledger') ?? DEFAULT_LEDGER;

  const limitRaw = flagString(flags, 'limit');
  const limit = limitRaw === undefined ? 50 : Number(limitRaw);
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
    throw new Error('--limit must be an integer between 1 and 50');
  }

  const fromLedger = flagBool(flags, 'no-ledger') ? [] : await ledgerEntries(ledgerPath);
  const fromSearch = await slugsFromSearch({
    readEndpoint,
    query: flagString(flags, 'query') ?? QA_DESCRIPTION_PREFIX,
    limit,
    ...(apiKey === undefined ? {} : { apiKey }),
  });
  const extra = (flagString(flags, 'slugs') ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s !== '');

  const slugs = qaSlugsOnly(fromLedger.map((e) => e.slug), fromSearch, extra);
  stdout.write(
    `${slugs.length} ${QA_SLUG_PREFIX}* entr${slugs.length === 1 ? 'y' : 'ies'} ` +
      `(ledger ${fromLedger.length}, search ${fromSearch.length}, flags ${extra.length})\n`,
  );
  if (slugs.length === 0) return;

  // Ledger ids short-circuit the resolve; everything else costs one GET.
  const ledgerIds = new Map(fromLedger.map((e) => [e.slug, e.skillId]));
  const targets = await resolveTargets({
    targets: slugs.map((slug) => {
      const skillId = ledgerIds.get(slug);
      return skillId === undefined ? { slug } : { slug, skillId };
    }),
    readEndpoint,
    ...(apiKey === undefined ? {} : { apiKey }),
  });

  const outcomes = await cleanupQaEntries({
    targets,
    endpoint,
    ...(flagString(flags, 'reason') === undefined ? {} : { reason: flagString(flags, 'reason')! }),
    ...(apiKey === undefined ? {} : { apiKey }),
    ...(flagBool(flags, 'dry-run') ? { dryRun: true } : {}),
  });

  const notDone = outcomes.filter(
    (o) => o.status === 'failed' || o.status === 'unsupported' || o.status === 'unresolved',
  );
  stdout.write(
    `${outcomes.filter((o) => o.status === 'changed').length} changed, ` +
      `${outcomes.filter((o) => o.status === 'planned').length} planned, ` +
      `${notDone.length} not done\n`,
  );
  if (notDone.length > 0) exit(1);
}

if (argv[1] !== undefined && import.meta.url === pathToFileURL(argv[1]).href) {
  main().catch((err: unknown) => {
    stderr.write(`error: ${err instanceof Error ? err.message : String(err)}\n`);
    exit(1);
  });
}
