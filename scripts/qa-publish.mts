#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════════════
// qa-publish.mts — publish ONE QA test skill to the hosted registry
// ════════════════════════════════════════════════════════════════════════════
//
//   node scripts/qa-publish.mts --manifest ./qa/search.json --skill-md ./qa/SKILL.md
//   node scripts/qa-publish.mts --manifest ./qa/search.json --skill-md ./qa/SKILL.md --dry-run
//
// Takes a local SKILL.md plus a manifest and POSTs them to `/v1/skills` under
// the QA guardrails in `qa-guardrails.mts`: the `@cogniumhq-qa/` slug prefix
// (refused, not rewritten, if the manifest names another publisher), the `qa`
// and `cognium-internal` tags, the `QA test entry — not for use.` description
// prefix, and the one advisory `X-Tenant-Id: cogniumhq-qa` header.
//
// Unsigned is fine: D2 is in Phase A grace, so the registry accepts the
// publish, records `missing_signature` and gives it the lowest verification
// tier. Scanning is paused, so the entry stays `pending-trust` — a QA case
// cannot assert a tier upgrade today.
//
// **Endpoint.** Writes default to the registry's `workers.dev` origin, not
// `api.skillsregistry.net`: the public host is read-only by design and 404s
// every write (`apps/local/README.md` → Connected). Point it anywhere with
// `--endpoint`, and at staging once staging exists.
//
// **Auth.** `SR_WRITE_API_KEY` is sent as `Authorization: Bearer` when set.
// That is the credential the hosted registry's write gate wants on internet
// ingress. It is optional *today* only because that gate runs in warn mode —
// an unauthenticated publish still returns 201, with an
// `X-Write-Auth-Warning` header and a log line. The fail-closed default is
// enforce, and when production flips to it the same unauthenticated publish
// becomes a 401. Export the key now: it changes nothing in warn mode and
// keeps working after the flip.
//
// Every successful publish is appended to a ledger file (default
// `./qa-published.json`) so `qa-cleanup.mts` can find the entry again even if
// search has not caught up. The ledger is a convenience, not the source of
// truth — cleanup also queries the registry.
//
// Flags:
//   --manifest FILE     Skill manifest JSON (required)
//   --skill-md FILE     SKILL.md body (required; use --no-skill-md to omit)
//   --slug NAME         Override the manifest slug (prefix/date still forced)
//   --date YYYYMMDD     Date stamp for the slug (default: today, UTC)
//   --endpoint URL      Write origin (default: the workers.dev origin)
//   --ledger FILE       Ledger path (default: ./qa-published.json)
//   --dry-run           Print the exact request and exit without sending it
//
// Env: SR_WRITE_API_KEY — operator write key, sent as `Authorization: Bearer`.
//      Optional while the registry's write gate is in warn mode; required
//      once it enforces.
//
// ════════════════════════════════════════════════════════════════════════════

import { readFile, writeFile } from 'node:fs/promises';
import { argv, env, exit, stderr, stdout } from 'node:process';
import { pathToFileURL } from 'node:url';
import {
  QA_TENANT_ID,
  QA_WRITE_ENDPOINT,
  buildQaPublishBody,
  describeFailure,
  flagBool,
  flagString,
  parseFlags,
  qaFetch,
  qaHeaders,
  stripSlash,
  type QaPublishBody,
} from './qa-guardrails.mts';

export const DEFAULT_LEDGER = './qa-published.json';

export interface PublishQaSkillOptions {
  manifest: Record<string, unknown>;
  skillMd?: string;
  endpoint?: string;
  slug?: string;
  date?: string;
  apiKey?: string;
  fetchImpl?: typeof fetch;
}

export interface PublishQaSkillResult {
  body: QaPublishBody;
  url: string;
  headers: Record<string, string>;
  response: unknown;
}

/**
 * Build the guarded body and POST it. Separated from the CLI so the
 * guardrails can be tested without a process boundary.
 */
export async function publishQaSkill(
  opts: PublishQaSkillOptions,
): Promise<PublishQaSkillResult> {
  const body = buildQaPublishBody(opts.manifest, opts.skillMd ?? '', {
    ...(opts.slug === undefined ? {} : { slug: opts.slug }),
    ...(opts.date === undefined ? {} : { date: opts.date }),
  });
  const url = `${stripSlash(opts.endpoint ?? QA_WRITE_ENDPOINT)}/v1/skills`;
  const headers = qaHeaders(opts.apiKey);

  const res = await qaFetch(
    url,
    { method: 'POST', headers, body: JSON.stringify(body) },
    opts.fetchImpl ?? fetch,
  );
  if (res.status === 404 || res.status === 405) {
    throw new Error(
      `publish: HTTP ${res.status} — ${url} does not accept writes. ` +
        'api.skillsregistry.net is read-only; pass the write origin with --endpoint.',
    );
  }
  if (res.status !== 201 && res.status !== 200) throw describeFailure('publish', res);

  return { body, url, headers, response: res.body };
}

// ── Ledger ──────────────────────────────────────────────────────────────────

export interface LedgerEntry {
  slug: string;
  version: string;
  endpoint: string;
  publishedAt: string;
  skillId?: string;
}

export async function appendToLedger(path: string, entry: LedgerEntry): Promise<void> {
  let entries: LedgerEntry[] = [];
  try {
    const parsed = JSON.parse(await readFile(path, 'utf8')) as { entries?: unknown };
    if (Array.isArray(parsed.entries)) entries = parsed.entries as LedgerEntry[];
  } catch (err) {
    if ((err as { code?: string }).code !== 'ENOENT') throw err;
  }
  entries.push(entry);
  await writeFile(path, `${JSON.stringify({ entries }, null, 2)}\n`);
}

// ── CLI ─────────────────────────────────────────────────────────────────────

const HELP = `qa-publish.mts — publish one QA test skill to SkillsRegistry

  node scripts/qa-publish.mts --manifest FILE --skill-md FILE [options]

  --manifest FILE     skill manifest JSON (required)
  --skill-md FILE     SKILL.md body (required; --no-skill-md to omit)
  --slug NAME         override the manifest slug (@cogniumhq-qa/ + date forced)
  --date YYYYMMDD     slug date stamp (default: today, UTC)
  --endpoint URL      write origin (default ${QA_WRITE_ENDPOINT})
  --ledger FILE       ledger path (default ${DEFAULT_LEDGER})
  --dry-run           print the request and exit

  Env SR_WRITE_API_KEY is sent as Authorization: Bearer. Optional while the
  registry's write gate is in warn mode (today); required once it enforces.
  X-Tenant-Id is always ${QA_TENANT_ID} and is never rotated — the 600 rpm
  budget is per tenant. Guardrails + cleanup: docs/qa-publishing.md
`;

async function main(): Promise<void> {
  const flags = parseFlags(argv.slice(2));
  if (flagBool(flags, 'help') || flagBool(flags, 'h') || argv.length <= 2) {
    stdout.write(HELP);
    return;
  }

  const manifestPath = flagString(flags, 'manifest');
  if (manifestPath === undefined) throw new Error('missing --manifest');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as Record<string, unknown>;

  const skillMdPath = flagString(flags, 'skill-md');
  if (skillMdPath === undefined && !flagBool(flags, 'no-skill-md')) {
    throw new Error('missing --skill-md (pass --no-skill-md to publish without one)');
  }
  const skillMd = skillMdPath === undefined ? '' : await readFile(skillMdPath, 'utf8');

  const endpoint = stripSlash(flagString(flags, 'endpoint') ?? QA_WRITE_ENDPOINT);
  const apiKey = env.SR_WRITE_API_KEY;

  if (flagBool(flags, 'dry-run')) {
    const body = buildQaPublishBody(manifest, skillMd, {
      ...(flagString(flags, 'slug') === undefined ? {} : { slug: flagString(flags, 'slug')! }),
      ...(flagString(flags, 'date') === undefined ? {} : { date: flagString(flags, 'date')! }),
    });
    const headers = qaHeaders(apiKey);
    if (headers.authorization !== undefined) headers.authorization = 'Bearer <redacted>';
    stdout.write(
      `${JSON.stringify({ method: 'POST', url: `${endpoint}/v1/skills`, headers, body }, null, 2)}\n`,
    );
    return;
  }

  const result = await publishQaSkill({
    manifest,
    skillMd,
    endpoint,
    ...(flagString(flags, 'slug') === undefined ? {} : { slug: flagString(flags, 'slug')! }),
    ...(flagString(flags, 'date') === undefined ? {} : { date: flagString(flags, 'date')! }),
    ...(apiKey === undefined ? {} : { apiKey }),
  });

  const response = (result.response ?? {}) as Record<string, unknown>;
  const skillId = typeof response.id === 'string'
    ? response.id
    : typeof response.skill_id === 'string'
      ? response.skill_id
      : undefined;

  await appendToLedger(flagString(flags, 'ledger') ?? DEFAULT_LEDGER, {
    slug: result.body.slug,
    version: result.body.version,
    endpoint,
    publishedAt: new Date().toISOString(),
    ...(skillId === undefined ? {} : { skillId }),
  });

  stdout.write(
    `Published ${result.body.slug}@${result.body.version}${skillId === undefined ? '' : ` (id ${skillId})`}.\n` +
      'Unsigned (D2 Phase A) and unscanned, so it stays pending-trust.\n' +
      'Deprecate it when the case closes: node scripts/qa-cleanup.mts\n',
  );
}

if (argv[1] !== undefined && import.meta.url === pathToFileURL(argv[1]).href) {
  main().catch((err: unknown) => {
    stderr.write(`error: ${err instanceof Error ? err.message : String(err)}\n`);
    exit(1);
  });
}
