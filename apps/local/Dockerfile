# syntax=docker/dockerfile:1.7
# ─── build stage ────────────────────────────────────────────────────────────
FROM node:22-alpine AS build

RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

WORKDIR /repo

# Copy workspace manifests first for cache-friendly layer.
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json tsconfig.base.json ./
COPY packages ./packages
COPY apps/local/package.json ./apps/local/package.json

RUN pnpm install --frozen-lockfile

# Copy source and build.
COPY apps/local ./apps/local
RUN pnpm --filter '@skillsregistry/*' build \
 && pnpm --filter '@skillsregistry/local' build

# Prune to production deps only.
RUN pnpm --filter '@skillsregistry/local' deploy --prod /out

# ─── runtime stage ──────────────────────────────────────────────────────────
FROM node:22-alpine AS runtime

RUN addgroup -S app && adduser -S -G app app
WORKDIR /app

COPY --from=build --chown=app:app /out /app

USER app

ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=0.0.0.0

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget --quiet --tries=1 --spider http://localhost:3000/v1/health || exit 1

CMD ["node", "./dist/index.js"]
