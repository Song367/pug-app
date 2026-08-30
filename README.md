# Pug UI

Dashboard frontend for **Pug** — an analytics + communication platform. Built for growth managers.

## Stack

- React + TypeScript + Vite
- ConnectRPC (binary protobuf)
- Jotai (state management)
- shadcn/ui + Tailwind CSS

## Getting Started

```sh
bun install
bun run dev
```

## Commands

```sh
bun run dev       # Start dev server
bun run build     # Type-check + production build
bun run generate  # Regenerate TypeScript proto types from backend protos
bun run format    # Biome formatter (format only)
bun run lint      # Biome check — format + lint + import organization (safe fixes)
```

## Hardened local deployment

The production build intentionally has no configurable cross-origin API base.
Dashboard, session, and Connect RPC traffic use the page origin. In the
production-style local stack, the sibling Pug backend provides a TLS Session
Gateway that keeps raw access/refresh tokens server-side and gives the browser
only a `Secure`, `HttpOnly`, `SameSite=Strict` session cookie plus an in-memory
CSRF token.

Build the local runtime image, then follow the backend secure-stack guide:

```sh
docker build -t pug-l1/dashboard:local .
```

See
[`../pug/infra/secure/README.md`](../pug/infra/secure/README.md).

Security reports and SBOMs generated under `artifacts/` are deliberately
excluded from both Git and the Docker build context.
