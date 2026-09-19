# Mothership migration: consume `@skillsregistry/*` from npm

> **Audience:** an engineer (or agent session) working in the private
> mothership repo.
>
> **This file lives in this open-source repo** and
> is **read-only reference** from the mothership side. Do not copy it
> in; open it, execute against the mothership, delete when done.
>
> **Sacred boundary:** the session that produced this note stopped
> at the local-repo boundary per the `skillsregistry-local` CLAUDE.md.
> Mothership edits belong to a mothership-repo session.

---

## Context

`skillsregistry-local` publishes six SDK packages to npm under
`@skillsregistry/*`:

| Package | Version | Extracted from mothership path |
|---|---|---|
| `@skillsregistry/contracts` | `1.0.0` | `src/schemas/{common,responses}.ts` + upstream contracts |
| `@skillsregistry/schema` | `1.0.0` | `src/db/schema.ts` + `src/db/migrations/*.sql` |
| `@skillsregistry/domain` | `1.0.0` | `src/{composition,intelligence,providers,cognium/scoring-policy,ingestion/text-fingerprint,resilience}/*` |
| `@skillsregistry/mcp` | `1.0.0` | `src/mcp/{server,invocation-writer}.ts` |
| `@skillsregistry/eval` | `1.0.0` | `src/eval/*` + `scripts/run-eval.ts` |
| `@skillsregistry/dag` | `1.0.0` | `packages/dag/` (already on npm since June 2026) |

The mothership currently either inlines these modules or consumes
them via `file:../skillsregistry-local/packages/*` links. This note
is the recipe for swapping to the published npm versions.

**Task tracker line:** T-1.7 in the mothership's own Specifica tracker.

---

## Pre-flight

1. Mothership is on a clean `main`. If not, stash / commit first.
2. Branch: `git checkout -b chore/consume-skillsregistry-packages-npm`
3. Confirm the npm versions exist:
   ```
   npm view @skillsregistry/schema version   # → 1.0.0
   npm view @skillsregistry/contracts version
   npm view @skillsregistry/domain version
   npm view @skillsregistry/mcp version
   npm view @skillsregistry/eval version
   ```
   If any returns 404, the local publish did not complete — coordinate
   back before proceeding.

---

## Step 1 — package.json dependency swap

In the mothership `package.json`:

```diff
-    "@skillsregistry/dag": "file:../skillsregistry-local/packages/dag",
-    "@skillsregistry/domain": "file:../skillsregistry-local/packages/domain",
-    "@skillsregistry/eval": "file:../skillsregistry-local/packages/eval",
-    "@skillsregistry/mcp": "file:../skillsregistry-local/packages/mcp",
+    "@skillsregistry/dag": "^1.0.0",
+    "@skillsregistry/schema": "^1.0.0",
+    "@skillsregistry/contracts": "^1.0.0",
+    "@skillsregistry/domain": "^1.0.0",
+    "@skillsregistry/eval": "^1.0.0",
+    "@skillsregistry/mcp": "^1.0.0",
```

Then `pnpm install` (or `npm install` — mothership currently uses
npm) to update the lockfile.

---

## Step 2 — delete inlined copies (mothership-side)

Every file below has an authoritative version now shipped by
`@skillsregistry/*`. Delete them **in this order** (dependents last)
so intermediate typechecks fail loudly at the deleted symbol, not
inside a still-inlined dependency:

### 2a. schema layer

- `src/db/schema.ts`
- `src/db/migrations/*.sql` (all files)

Replaced by `@skillsregistry/schema`.

### 2b. contracts layer

- `src/schemas/common.ts`
- `src/schemas/responses.ts`

Replaced by `@skillsregistry/contracts`.

### 2c. domain layer

- `src/composition/*.ts` (except any adapter-specific wiring)
- `src/intelligence/*.ts` (confidence-gate, deep-search, reranker, reranker-backend, composition-detector)
- `src/providers/pgvector-provider.ts`, `src/providers/pgvector-fusion.ts` etc.
- `src/cognium/scoring-policy.ts`
- `src/ingestion/text-fingerprint.ts`
- `src/resilience/circuit-breaker.ts` (if present)

Replaced by `@skillsregistry/domain`.

### 2d. mcp layer

- `src/mcp/server.ts`
- `src/mcp/invocation-writer.ts`

Replaced by `@skillsregistry/mcp`.

### 2e. eval layer

- `src/eval/*.ts`
- `scripts/run-eval.ts`

Replaced by `@skillsregistry/eval` (the runner is now available as
the `skillsregistry-eval` bin from the eval package).

---

## Step 3 — rewrite imports

Find/replace across `src/`, `tests/`, and `scripts/`:

| Old import path | New import |
|---|---|
| `../db/schema` (and any depth) | `@skillsregistry/schema` |
| `../schemas/common` | `@skillsregistry/contracts` |
| `../schemas/responses` | `@skillsregistry/contracts` |
| `../composition/*` | `@skillsregistry/domain` |
| `../intelligence/*` | `@skillsregistry/domain` |
| `../providers/*` | `@skillsregistry/domain` |
| `../cognium/scoring-policy` | `@skillsregistry/domain` |
| `../ingestion/text-fingerprint` | `@skillsregistry/domain` |
| `../resilience/*` | `@skillsregistry/domain` |
| `../mcp/server` | `@skillsregistry/mcp` |
| `../mcp/invocation-writer` | `@skillsregistry/mcp` |
| `../eval/*` | `@skillsregistry/eval` |

Grep helpers:

```bash
# Find remaining inlined imports
grep -rE 'from ["\047]\.\.?/(composition|intelligence|providers|cognium/scoring-policy|ingestion/text-fingerprint|resilience|mcp/(server|invocation-writer)|eval|schemas/(common|responses)|db/schema)' src/ tests/ scripts/
```

If that returns anything, the swap is incomplete.

---

## Step 4 — wiring adjustments

The mothership currently instantiates its own port implementations.
Since the domain package is now framework-agnostic, the mothership
needs to bind Cloudflare-specific adapters at boot. Typical spots:

- **KvAdapter:** wrap `env.SKILL_CACHE` (CF KV) — mothership already
  has a helper; make sure it satisfies the `KvAdapter` shape exported
  from `@skillsregistry/domain`.
- **QueueAdapter:** wrap `env.SCAN_QUEUE` (CF Queues) — same.
- **AfterResponse:** wrap `c.executionCtx.waitUntil` — mothership
  should keep a `waitUntil-wrapped` binding per request (via
  `c.set('afterResponse', ...)`).
- **SqlPool:** the existing Neon serverless driver client already
  matches the `SqlPool` port shape (`query(sql, params) → { rows }`).

The `McpAdapters` bundle (for `handleMcpRequest`) needs:
- `search: SearchGatewayPort` — construct from `ConfidenceGate.findSkill`
  bound to the CF pool + KV cache.
- `skills`, `compositions`, `leaderboards` — thin projections over the
  existing Postgres queries; move them behind the port shape.

---

## Step 5 — verification (all must pass before PR merge)

```bash
# 1. Install clean
rm -rf node_modules && pnpm install       # or npm install

# 2. Typecheck
pnpm typecheck                            # or npm run typecheck

# 3. Full test suite (mothership has ~558 tests)
pnpm test:run                             # or npm run test:run

# 4. Eval gate — R@5 ≥ 80%, MRR ≥ 0.70
npx skillsregistry-eval --endpoint https://<staging-worker>.workers.dev/v1/search

# 5. Smoke against staging
pnpm smoke:production                     # or npm run smoke:production
```

**Do not merge below R@5 = 80%.** That is the T-1.7 quality gate.

---

## Step 6 — deploy

Standard mothership deploy: `wrangler deploy -c wrangler.skillsregistry.toml`.
Post-deploy smoke against `api.skillsregistry.net` should show:

- All API endpoints still 200 (spot-check `/v1/health`, `/v1/search?q=weather`, `/v1/skills/<slug>`)
- MCP: `curl -X POST https://api.skillsregistry.net/mcp -H 'content-type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'` returns the 5-tool array
- `/mcp.json` still resolves

---

## Step 7 — post-merge audit

The T-4.4 audit criterion in `.specifica/6.2/tasks.md`:
"mothership has zero inlined copies of extracted modules." Verify:

```bash
# Should print nothing
grep -rE '"file:.*skillsregistry-local"' package.json

# Should print nothing
grep -rE 'src/(composition|intelligence|providers|cognium/scoring-policy|ingestion/text-fingerprint|mcp/(server|invocation-writer)|eval|schemas/(common|responses)|db/schema|db/migrations)' src/
```

Both return empty → T-1.7 marked done, T-4.4 audit criterion met.

---

## Rollback

If eval fails or staging smoke breaks:

```bash
git revert HEAD           # revert the merged PR
pnpm install              # regenerate lockfile with file: links
wrangler deploy -c wrangler.skillsregistry.toml
```

Coordinate back to `skillsregistry-local`; do not force-merge a
release below the R@5 gate.

---

## Coordination back to skillsregistry-local

If migration surfaces a port-shape mismatch (e.g., mothership needs
a method not exported from `@skillsregistry/domain`), the fix belongs
in `skillsregistry-local`, published as a patch bump. Steps:

1. Open an issue in `skillsregistry-local` describing the missing
   surface + a proposed port shape.
2. That repo's session adds the port, ships a patch release
   (`@skillsregistry/domain@1.0.1`).
3. Mothership `pnpm update @skillsregistry/domain` and continue the
   migration.

Do not fork the port shape locally on mothership; the divergence
becomes a coordination tax forever.

---

## What this note explicitly does NOT do

- Does not modify mothership `wrangler.*.toml` — env vars stay identical.
- Does not touch DNS (`api.runics.net` → `api.skillsregistry.net` cutover
  is a separate coordination item tracked in the mothership's §12).
- Does not rename the Cortex `RUNICS_SERVICE` binding — that PR lives
  in the Cortex repo, coordinated separately.
- Does not upgrade `apps/local` (this repo's runtime); local node
  already consumes the workspace-linked packages and needs no change
  post-publish.

---

*Cognium Labs · SDK extraction · Phase 1 handoff*
