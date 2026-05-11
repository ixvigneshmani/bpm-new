# FlowPro

AI-native BPMN 2.0 BPM platform. Headless workflow engine + visual designer + AI copilot.

## Layout

```
api/      NestJS + Fastify + Drizzle + Postgres — workflow engine, REST API
web/      Vite + React + Tailwind — designer, instance ops, task inbox
shared/   Shared TypeScript types
```

## Stack

- **API:** NestJS 11 (Fastify adapter), Drizzle ORM, Postgres 15+, JWT auth, Anthropic SDK
- **Web:** React 18, Vite, React Flow, Tailwind v4
- **Node:** 20.x (use `nvm use`)
- **Package manager:** pnpm

## Quickstart

```bash
# 1. Postgres — local install or container
createdb flowpro

# 2. API
cd api
cp .env.example .env.development
# edit DATABASE_URL + JWT_SECRET
pnpm install
pnpm db:push        # apply schema
pnpm db:seed        # initial tenant + admin user
pnpm dev            # http://localhost:3001/api

# 3. Web (separate terminal)
cd web
pnpm install
pnpm dev            # http://localhost:5173
```

Default seeded login: `vignesh.mani@innovatechs.com` / `password123` (change in `api/src/database/seed.ts`).

## Key endpoints

- `GET  /api/version` — build info (version, git SHA, build time)
- `GET  /api/engine/health` — DB reachability probe (public)
- `POST /api/auth/login` — JWT issuance (rate-limited 10/min/IP)
- `GET  /api/processes` — list processes
- `POST /api/processes/:id/publish` — promote DRAFT → ACTIVE
- `POST /api/processes/:id/instances` — start instance (ACTIVE required, or `?testRun=true`)
- `GET  /api/processes/:id/export` — D1 cross-env bundle
- `POST /api/processes/import` — D1 import bundle
- `GET  /api/tasks` — task inbox (claim queue + assigned)
- `POST /api/tasks/:id/{claim,complete,reassign,skip}` — task lifecycle

## Production config

The API refuses to boot with `NODE_ENV=production` if:

- `JWT_SECRET` is missing, the dev placeholder, or shorter than 32 chars
- `CORS_ORIGIN` contains any `localhost` entry

`CORS_ORIGIN` accepts a comma-separated allowlist:

```
CORS_ORIGIN=https://app.flowpro.io,https://staging.flowpro.io
```

## Status

Engine MVP shipped (E1–E6). D1 cross-environment deployment shipped (export/import). Next milestone: EE1 — enterprise-readiness baseline (in progress).
