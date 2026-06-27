# syntax=docker/dockerfile:1.7
# Multi-stage build for @e2e-bridge/server.
#
# Stage 1: install all workspace deps, build shared + sdk-adapter + server.
# Stage 2: pnpm deploy — produces a self-contained /out (no symlinks).
# Stage 3: runtime — node:20-alpine, non-root, dist + node_modules only.
#
# Build from repo root:
#   docker build -f apps/server/Dockerfile -t e2e-bridge-server:local .

# ---- Stage 1: deps + build ----
FROM node:20-alpine AS build
WORKDIR /repo

# Install pnpm
RUN corepack enable && corepack prepare pnpm@11.9.0 --activate

# Copy lockfiles + workspace files first (cache-friendly)
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml .npmrc tsconfig.base.json ./
# Copy only what the server depends on (with package.jsons for cache hits)
COPY packages/shared/package.json          packages/shared/
COPY packages/shared/tsconfig.json         packages/shared/
COPY packages/sdk-adapter/package.json     packages/sdk-adapter/
COPY packages/sdk-adapter/tsconfig.json    packages/sdk-adapter/
COPY apps/server/package.json              apps/server/
COPY apps/server/tsconfig.json             apps/server/

RUN pnpm install --frozen-lockfile

# Now copy source
COPY packages/shared/src        packages/shared/src
COPY packages/sdk-adapter/src   packages/sdk-adapter/src
COPY apps/server/src            apps/server/src

RUN pnpm -F @e2e-bridge/shared build && \
    pnpm -F @e2e-bridge/sdk-adapter build && \
    pnpm -F @e2e-bridge/server build

# ---- Stage 2: pnpm deploy ----
# Produces /out with server + flattened node_modules (workspace deps resolved
# to their dists; no symlinks).
RUN pnpm --filter @e2e-bridge/server deploy /out --prod

# ---- Stage 3: runtime ----
FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
ENV HOST=127.0.0.1
ENV PORT=3000

# Run as non-root
RUN addgroup -S app && adduser -S app -G app

# Self-contained artifact from stage 2
COPY --from=build --chown=app:app /out ./

# Default upload dir (mounted as a volume at runtime)
RUN mkdir -p /app/uploads && chown app:app /app/uploads

USER app
EXPOSE 3000

# Healthcheck via wget (alpine has it built-in)
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/health || exit 1

CMD ["node", "dist/index.js"]
