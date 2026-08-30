# syntax=docker/dockerfile:1

FROM oven/bun@sha256:5acc90a93e91ff07bf72aa90a7c9f0fa189765aec90b47bdbf2152d2196383c0 AS build
WORKDIR /app

COPY package.json bun.lock ./
RUN --mount=type=cache,target=/root/.bun/install/cache \
    bun install --frozen-lockfile --ignore-scripts

COPY . .
RUN bun run security:verify-build-deps

ARG VITE_MAP_ASSETS_URL=
ARG VITE_FAVICON_ASSETS_URL=
ENV VITE_MAP_ASSETS_URL=${VITE_MAP_ASSETS_URL} \
    VITE_FAVICON_ASSETS_URL=${VITE_FAVICON_ASSETS_URL} \
    VITE_DEMO_ENABLED=false \
    VITE_PUG_ANALYTICS_ENABLED=false \
    VITE_PUG_PROJECT_ID= \
    VITE_PUG_PUBLIC_KEY=
# API and session traffic always use the page origin. There is intentionally no
# build argument capable of sending browser credentials to another origin.
RUN bun run build

# Bun installs the frozen Linux dependency graph; Node runs Vitest because the
# current Bun runtime mis-evaluates Zod's namespace export in part of this suite.
FROM node@sha256:8ea2348b068a9544dae7317b4f3aafcdc032df1647bb7d768a05a5cad1a7683f AS test-base
WORKDIR /app
COPY --from=build --chown=node:node /app /app
USER node

# Keep CI and local validation within a predictable memory envelope. The full
# suite is CPU-heavy and can otherwise starve sibling service containers.
FROM test-base AS test
RUN node node_modules/vitest/vitest.mjs run --maxWorkers=2

FROM nginx@sha256:1870de6d59aafee152589b64404556d2535922cdd998e6dac1c4888c938ed8f9

# The pinned upstream image predates Alpine's OpenSSL 3.5.8 security rebuild.
# Pin the exact fixed packages so a removed or changed repository artifact fails
# the build instead of silently resolving a different dependency set.
RUN apk add --no-cache --upgrade \
    libcrypto3=3.5.8-r0 \
    libssl3=3.5.8-r0

COPY nginx.conf /etc/nginx/nginx.conf
COPY --from=build /app/dist /usr/share/nginx/html

# nginx:alpine's nginx account is uid/gid 101. nginx.conf keeps every runtime
# write under /tmp, so this image also works with a read-only root filesystem.
USER 101:101
EXPOSE 8080

HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:8080/healthz || exit 1
