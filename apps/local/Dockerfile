# syntax=docker/dockerfile:1.7
# ══════════════════════════════════════════════════════════════════════════════
# SkillsRegistry Local — production image.
# ══════════════════════════════════════════════════════════════════════════════
#
# Two stages:
#   1. build     — installs the pnpm workspace, builds every @skillsregistry/*
#                  package + apps/local, then `pnpm deploy --prod` prunes to a
#                  self-contained tree at /out (dist + prod node_modules).
#   2. runtime   — copies /out into a slim node:22-alpine image, drops root,
#                  advertises /v1/health for the orchestrator, and delegates
#                  boot to `entrypoint.sh` (documents design §11 startup phases
#                  and execs node with source-map support).
#
# Ops notes:
#   - Non-root: runtime process runs as `app:app` (uid 100+).
#   - Signal handling: Node is PID 1 (via `exec` in entrypoint.sh); SIGINT +
#     SIGTERM handled by src/index.ts shutdown hook (drains services + pool).
#   - Health check: `wget -q --spider http://127.0.0.1:${PORT}/v1/health`; the
#     handler reports `degraded` (503) on Postgres unreachability. The probe is
#     pinned to the IPv4 loopback on purpose — see the HEALTHCHECK note below.
#   - Source maps: `--enable-source-maps` in entrypoint.sh keeps prod stack
#     traces pointing at .ts line numbers.
#
# ══════════════════════════════════════════════════════════════════════════════

# ─── build stage ────────────────────────────────────────────────────────────
FROM node:22-alpine AS build

RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

WORKDIR /repo

# Copy workspace manifests first for cache-friendly layer.
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json tsconfig.base.json ./
COPY packages ./packages
COPY scripts ./scripts
COPY apps/local/package.json ./apps/local/package.json
COPY apps/local/web/package.json ./apps/local/web/package.json

RUN pnpm install --frozen-lockfile

# Copy source and build. `@skillsregistry/local` build script also runs the
# Astro build for apps/local/web, producing web/dist next to the app.
COPY apps/local ./apps/local
RUN pnpm --filter '@skillsregistry/*' build \
 && pnpm --filter '@skillsregistry/local' build

# Prune to production deps only.
RUN pnpm --filter '@skillsregistry/local' deploy --prod /out

# Ship the built admin UI alongside the pruned app tree so Hono's serveStatic
# can resolve `./web/dist` at runtime (working dir = /app).
RUN mkdir -p /out/web && cp -r apps/local/web/dist /out/web/dist

# ─── runtime stage ──────────────────────────────────────────────────────────
FROM node:22-alpine AS runtime

# OCI image labels — supply-chain identification, license reporting.
LABEL org.opencontainers.image.title="skillsregistry-local"
LABEL org.opencontainers.image.description="Open-source SkillsRegistry local runtime (Hono + Postgres/pgvector + Ollama)"
LABEL org.opencontainers.image.source="https://github.com/cogniumhq/skillsregistry"
LABEL org.opencontainers.image.licenses="Apache-2.0"
LABEL org.opencontainers.image.vendor="Cognium Labs"

RUN addgroup -S app && adduser -S -G app app
WORKDIR /app

COPY --from=build --chown=app:app /out /app
COPY --chown=app:app --chmod=0755 apps/local/entrypoint.sh /app/entrypoint.sh

USER app

ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=0.0.0.0

EXPOSE 3000

# The probe must use the IPv4 loopback literal, not `localhost` (#103).
# Alpine's /etc/hosts maps `localhost` to BOTH 127.0.0.1 and ::1, BusyBox wget
# tries the IPv6 record first, and the app binds IPv4 only (HOST=0.0.0.0) — so
# `localhost` yields "can't connect to remote host: Connection refused" and the
# container is reported unhealthy while it is serving fine. `$PORT` is expanded
# by the shell form so a PORT override (docker-compose.yml, .env) stays probed.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget --quiet --tries=1 --spider "http://127.0.0.1:${PORT:-3000}/v1/health" || exit 1

ENTRYPOINT ["/app/entrypoint.sh"]
