# SkillsRegistry — test architecture

## 1. System surfaces and entry points

| Surface | Entry | Repo path |
|--------|--------|-----------|
| Local HTTP API | `apps/local` Hono app (`createApp`) | `apps/local/src/index.ts`, `routes/*.ts` |
| MCP JSON-RPC | `POST /mcp` | `apps/local/src/routes/mcp.ts`, `packages/mcp/src/dispatch.ts` |
| Admin UI | Astro (`apps/local/web`) | Playwright+axe in CI (`pnpm --filter @skillsregistry/local-web`) |
| SDK packages | `@skillsregistry/*` npm tarballs | `packages/*` |
| Upstream (mothership) wire | `api.skillsregistry.net` | Contract: `packages/contracts/src/upstream.ts`; consumer: `apps/local/src/upstream-client/`; producer: `cogniumhq/sr` (`src/routes/*`) |
| Control plane hooks | Finding intake, Cognium SAST | `.github/workflows/` (QE does not modify) |

Cross-plane: **Cortex** and **Controldeck** call mothership search/trust via the same camelCase `SearchRequest` contract documented in `upstream.ts` and implemented in `sr/src/routes/search.ts`.

## 2. Test pyramid inventory

### L1 — unit and invariants

- **contracts**: Zod round-trips (`packages/contracts/src/schemas.test.ts`, `openapi.test.ts`)
- **domain**: confidence gate tiers, circuit breaker, scoring policy, composition graph, pgvector search filters
- **mcp**: JSON-RPC dispatch, tool ports, invocation writer
- **local node**: middleware (tenant, admin-auth, loopback), adapters, config boot checks, upstream client fetch mocks

### L2 — hermetic contract and service E2E

- **MCP in-process**: `apps/local/src/routes/mcp.test.ts` — full tool loop with fakes
- **routing**: `apps/local/src/routes/routing.test.ts`, `public.test.ts`, `admin.test.ts`
- **migration door**: `apps/local/src/migration/publish-to-mothership.test.ts`
- **Gap (this run)**: `upstream-response` HTTP mapping had no dedicated suite — public/admin routes depend on it for every mothership failure path

### L3 — browser, container, live

- Admin Astro `check` in CI; full Docker Compose + air-gap smoke on `ubuntu-latest` CI job
- Hosted mothership E2E lives in `cogniumhq/sr` (`tests/routes/search.test.ts`, Playwright under `web/`)
- **Needs maintainer wiring**: new Playwright loopback harness for local admin UI (blocked on Q1 for `playwright.config` changes outside existing paths)

## 3. Cross-repo wire contracts

| Contract | Producer (mothership) | Consumer (local node / SDK) |
|----------|----------------------|----------------------------|
| `SearchRequestSchema` (camelCase) | `sr/src/routes/search.ts` | `packages/contracts/src/upstream.ts`, `ConfidenceGate`, `UpstreamClient` |
| `UpstreamErrorSchema` / codes | `sr` error handlers | `apps/local/src/upstream-client/client.ts`, `apps/local/src/http/upstream-response.ts` |
| `TrustScore*` / `BudgetResponse` | `sr` trust + tenant routes | `UpstreamClient`, `TrustClient` |
| MCP tool wire shapes | `sr` MCP surface (proprietary) vs local | `packages/mcp`, `apps/local/src/routes/mcp.test.ts` |
| Skill visibility bands | `sr` search SQL + tenant context | `SkillVisibilitySchema`, `sr/tests/routes/search.test.ts` tenant/oracle cases |

## 4. E2E framework architecture

- **Runner**: Vitest 4 monorepo projects (`vitest.config.ts`); `pnpm build && pnpm typecheck && pnpm test` on `grace` (glibc `node:22-bookworm` container).
- **L2 hermetic pattern**: In-process Hono `app.request()`, hand-rolled port fakes, `fakeFetch` queues for `UpstreamClient` — no live Postgres required for most suites (pool stubbed).
- **L3 pattern (sr reference)**: Playwright on `127.0.0.1` ephemeral ports; SkillsRegistry local node should mirror `sr/web` when L3 admin tests land.
- **Exit codes**: Align with `controldeck-harness` convention where scripts are added under `scripts/` (0 ok, 1 regression, 2 env missing).

## 5. Prioritized flow backlog

| Priority | Flow | Risk | L2/L3 |
|----------|------|------|-------|
| P0 | Upstream error → HTTP mapping (local proxy) | Wrong status leaks auth semantics or hides budget exhaustion | L2 — **this run** |
| P0 | Search camelCase vs legacy snake (X6 drift) | Silent filter drop | L1 exists; add L2 route body test |
| P1 | Revocation delta pull (`GET /v1/sync/revocations`) | Stale trust after mothership revoke | L2 client method + schema (not yet in `UpstreamClient`) |
| P1 | Tenant header oracle on search body | Cross-tenant existence leak | Covered in `sr`; port key cases to local public routes |
| P2 | Migration publish + sandbox contract exit 90 | L3 sandbox mis-provision | L2 `sandbox_contract_violated` mapping; L3 needs staging |