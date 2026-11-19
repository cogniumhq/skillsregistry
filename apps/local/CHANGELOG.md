# @skillsregistry/local

Private app, versioned with the Docker image `ghcr.io/cogniumhq/skillsregistry-local` (tag `vX.Y.Z`). Not managed by changesets.

## 1.2.0

### Minor changes
- Admin UI: skill detail page, lifecycle status, and protected delete (#108); admin reachable under Docker via token login (#44); XSS/href hardening (#119).
- Admin health reports embedding coverage and degrades when search embeddings are missing (#185, #188); `POST /v1/admin/reindex` backfills unembedded skills (#186).
- `ADMIN_REQUIRE_TOKEN` requires the admin token even from loopback (#189).
- Multi-version publish: a new version of an existing slug is a new row (#42).
- Deterministic slug reads, 4-band visibility, embed-on-publish, and facet filters (#101).
- `/health` alias next to `/v1/health` for mothership parity (#45).
- `/v1/health` and MCP `initialize` now report the app version (were hardcoded `0.1.0`).

### Ops and upgrade notes
- Docker Compose now publishes every port on 127.0.0.1 by default. Set `APP_BIND=0.0.0.0` in `.env` to serve a LAN (#100). The app service also loads `.env` as `env_file`, and a root `.dockerignore` was added.
- Docker HEALTHCHECK probes `127.0.0.1:$PORT` instead of `localhost` (#107).
- Schema migrations 0036 (`UNIQUE (slug, version)` replaces `UNIQUE (slug)`) and 0037 (`skills.domain` column + index) apply automatically at boot.

### Bundled SDK packages
- @skillsregistry/contracts 3.0.1, dag 2.0.1, domain 2.0.1, eval 1.0.6, mcp 1.2.4, schema 1.2.2.
- Runtime deps: hono 4.13.16, @hono/node-server 2.1.6, astro 7.4.x.

## 1.1.0
- Picked up the SDK 1.1.0 line (schema migrations 0034 sandbox + 0035 visibility bands). Image pushed manually, 15 Jul 2026.

## 1.0.0
- First published image, 4 Jul 2026.
