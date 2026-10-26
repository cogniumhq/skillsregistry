# QA publishing on the hosted registry

Production is the only deployment the hosted registry has today — there is no
staging host and no preview environment. So QA tests publishing **on the live
catalog**, inside a namespace that is fenced off by convention and enforced in
code. This page is that contract.

Two halves, in two repositories:

| Half | Where it lives |
|---|---|
| QA mints entries only inside its own namespace | `scripts/qa-publish.mts`, `scripts/qa-guardrails.mts` — **this repo** |
| The catalog hides those entries from anyone who didn't ask for them | the hosted registry's own query layer — see [Where QA entries are hidden](#where-qa-entries-are-hidden-and-where-they-are-not) |

This repository owns the publisher side. The exclusion predicate runs inside
the hosted registry, on the queries that build the export, the report feed and
the leaderboards; it is not something this repository can apply on its behalf.
Coordination for anything that spans the two goes the same way as everything
else in [mothership-migration.md](./mothership-migration.md).

## The guardrails

- **Namespace.** Publisher `@cogniumhq-qa`; every slug is
  `@cogniumhq-qa/<what>-<yyyymmdd>`. Never `@cognium/*` or `@cogniumhq/*` —
  those are first-party names. `qa-publish.mts` adds the prefix and today's
  UTC date stamp when they're missing, and **refuses** a manifest that names
  any other publisher rather than rewriting it.
- **Tags.** `qa` and `cognium-internal` on every entry, forced. `qa` is the
  tag the registry's exclusion predicate reads; `cognium-internal` is for
  humans.
- **Description.** Opens with `QA test entry — not for use.`, forced, and not
  doubled when the same manifest is published again.
- **Tenant header.** One advisory `X-Tenant-Id: cogniumhq-qa` on every
  request, never rotated. See [Rate budget](#rate-budget). It grants nothing —
  the registry only honors a tenant assertion on trusted ingress, never on a
  public hostname.
- **Lifecycle.** QA sets an entry to `deprecated` when its case closes.
  `scripts/qa-cleanup.mts` does that. See [Cleanup](#cleanup) for why there is
  no revoke path.
- **Unsigned.** Publisher signing (D2) is in Phase A grace, so an unsigned
  publish is accepted, recorded as `missing_signature`, and lands in the
  lowest verification tier.

## Where QA entries are hidden, and where they are not

| Surface | QA entries | Why |
|---|---|---|
| `GET /v1/catalog/export` | hidden | the export speaks for the catalog |
| `GET /v1/reports/export` | hidden | published trust/quality/usage figures must not count test rows |
| `GET /v1/leaderboards/*`, `trending` included | hidden | a QA publish must never rank |
| MCP `list_leaderboard` | hidden | same ranking queries as the REST routes |
| `GET /v1/skills/{slug}` | **visible** | QA has to read back what it published |
| `GET /v1/skills/{slug}/report` | **visible** | the per-skill report is a targeted read |
| `POST /v1/search`, `POST /v1/search/instant` | **visible** | search is how QA — and cleanup — find their entries |

Filtering search would make the QA entries untestable and would leave cleanup
with no way to discover an entry missing from its ledger. That asymmetry is
deliberate: catalog-wide surfaces hide them, targeted surfaces don't.

A self-hosted node that proxies the hosted rankings rather than computing them
inherits the hosted exclusion. If it wants belt-and-braces — so that a node
pointed at an older registry build still never ranks a QA entry — the rule to
re-apply on the proxied rows is "drop anything tagged `qa`, or whose slug
starts with `@cogniumhq-qa/`".

## Publishing

```sh
node scripts/qa-publish.mts --manifest ./qa/search.json --skill-md ./qa/SKILL.md --dry-run
node scripts/qa-publish.mts --manifest ./qa/search.json --skill-md ./qa/SKILL.md
```

Needs Node ≥ 22.18 (or `node --experimental-strip-types` on 22.6–22.17). No
install, no dependencies.

`--dry-run` prints the exact request — run it first. Each successful publish is
appended to a ledger (`./qa-published.json`, git-ignored) so cleanup can find
the entry even if search hasn't caught up.

**Endpoint.** `api.skillsregistry.net` is read-only by design and 404s every
write, so the scripts default writes to the registry's `workers.dev` origin and
reads to the public host; `--endpoint` / `--read-endpoint` override both. See
[Connected](../apps/local/README.md#connected) for the same split from the
local node's side.

### Auth, and why the key is optional today

`SR_WRITE_API_KEY` is sent as `Authorization: Bearer` when set. That is the
credential the hosted registry's write gate checks on internet ingress — its
internal write key, or its admin key (`ADMIN_API_KEY` works too).

It is optional **today** only because that gate runs in warn mode: an
unauthenticated publish still returns 201, with an `X-Write-Auth-Warning`
response header and a log line. The fail-closed default is enforce, and when
production flips to it the same unauthenticated publish becomes a **401**.

So: export the key now.

```sh
export SR_WRITE_API_KEY=…
```

It changes nothing while the gate is in warn mode, and it keeps working after
the flip. Running without it is supported but leaves a warning header on every
publish, and will break on the day the mode changes.

## Cleanup

```sh
node scripts/qa-cleanup.mts --dry-run            # what would change
node scripts/qa-cleanup.mts                      # deprecate every QA entry
node scripts/qa-cleanup.mts --reason "case closed"
```

Cleanup discovers entries from the ledger **and** from a `tags=qa` search, then
drops everything whose slug is not under `@cogniumhq-qa/`. That filter, not the
discovery, is the safety property: a stale ledger line or an unexpected search
hit can never turn into a write against a real skill. The namespace check runs
again immediately before each request is built.

Deprecation is `PATCH /v1/skills/:id/status`, and `:id` is the skill's **UUID**,
not its slug — so each discovered slug is first resolved through
`GET /v1/skills/:slug`, short-circuited by the `skillId` the ledger recorded at
publish time. A slug that resolves to nothing is reported as `unresolved`
rather than guessed at. The hosted handler's owner-initiated transition guard
allows `published → deprecated` and back, nothing else; a `409` from it is
reported as "left alone", not as a failed run, so re-running cleanup over an
already-handled entry stays green.

### There is no revoke

The hosted registry exposes no operator route that revokes an arbitrary skill.
The only ways a row reaches `status='revoked'` are the Cognium attestation
callback (which stamps `revoked_reason='content_safety_failed'` — a false
statement about a QA entry, and the one route the write gate deliberately keeps
un-author-writable), the publisher-key revocation cascade (keyed on a key, not
on a skill), and a direct database `UPDATE`.

So revoking a QA entry is an operator action on the database.
`qa-cleanup.mts` refuses `--revoke` with that explanation rather than firing at
a route that does not exist.

`deprecated` is the lifecycle state QA owns, and it is enough: a deprecated QA
entry is already out of the export, the report feed and every leaderboard by
virtue of its `qa` tag, whatever its status.

## What QA can cover today

- `POST /v1/skills` — publish, including the validation failures
- `/versions` — publish a second version of the same slug
- `/report` — the per-skill report on its own entries
- `POST /v1/search` + `/v1/search/instant` — QA entries are searchable,
  including by `tags=qa`
- `/pull` — fetching its own entries' artifacts
- lineage — fork / copy / extend between QA entries
- `PATCH /:id/status` — the deprecate half of the lifecycle

## What QA cannot cover yet

- **Signed publish.** The D2 root key is not bootstrapped, so everything QA
  publishes is unsigned under Phase A grace.
- **Scan → tier upgrade.** Scanning is paused, so a new entry stays
  `pending-trust` and no QA case can assert a tier change.
- **Enforced write auth.** The write gate is in warn mode, so QA cannot assert
  the 401 an unauthenticated write will eventually produce. Worth a case the
  day it flips.
- **Scoped / tenant publish.** `X-Tenant-Id` is advisory on a public hostname —
  it selects nothing and grants nothing — so every QA entry is public-scope.
- **Revoke.** No route; see above.
- **Staging.** No staging host exists. When one does, point the scripts at it
  with `--endpoint` / `--read-endpoint` and the guardrails here stop being
  load-bearing.

## Rate budget

The budget is **600 requests per minute per tenant**, shared between REST and
MCP. QA uses one tenant id — `cogniumhq-qa` — on every request and **never
rotates it to buy a fresh budget**: rate limiting is keyed on the caller, and
rotating a client-set header to reset a budget is exactly the abuse that keying
exists to stop. On a 429, back off; don't re-key.

Both scripts send their writes one at a time with a short gap, which keeps a
full cleanup run well inside the budget.

---

*Cognium Labs · 2026*
