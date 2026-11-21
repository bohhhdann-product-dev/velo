# Vela

A visual studio for building image and video ideas from references, prompts and photo-based characters.

## Current scope

Nuxt 4 serves both the Vue canvas and a Nitro API. Clerk authenticates users, PostgreSQL stores projects and character documents, and private storage holds normalized photos and reference sheets. Storage supports S3 and a local development directory outside the web root.

There are two explicit modes:

- **Demo:** an in-memory design sandbox with sample media and simulated generations.
- **Live:** authenticated projects, uploads, library, favorites and characters. Generation providers and billing are not connected; the app does not simulate successful generations in live mode.

No Encore or separate microservices are required.

## Local setup

Requirements: Node.js 24, pnpm 10 and Docker. Use a Clerk Development application for local sign-in.

```sh
docker compose up -d
cd frontend
pnpm install
cp .env.example .env
```

For demo mode, run `pnpm dev --host 127.0.0.1 --port 3457`.

For live mode, configure `.env`:

1. Set `NUXT_PUBLIC_APP_MODE=live`.
2. Set the existing application's `CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY` and `CLERK_ISSUER_URL` (the HTTPS Clerk instance domain).
3. Keep the local `DATABASE_URL` from the example, or supply your PostgreSQL connection.
4. Choose local media storage or configure a private S3 bucket and AWS credentials through the standard SDK credential chain.
5. Set `VELA_ALLOWED_ORIGINS` to the exact origins where you open Vela.

```sh
pnpm db:migrate
pnpm dev --host 127.0.0.1 --port 3457
```

Open http://127.0.0.1:3457. Sign in, create a project, upload a reference and edit its prompt. Reloading should restore the saved board. The status beside the project tells you when changes have reached the server.

Secrets belong in the ignored `.env` file or the deployment's secret store. Never add them to source control. For an existing Clerk application, the official CLI can pull keys directly to `.env` after `clerk auth login`; do not provision a replacement application.

## Checks

```sh
cd frontend
pnpm test:studio
pnpm test:live
pnpm test:server
pnpm typecheck
pnpm build
```

Database integration tests additionally require `VELA_TEST_DATABASE_URL` pointing to an isolated local PostgreSQL database. Tests use unique schemas and local temporary media storage; they never need Clerk secrets or real S3 files. See [backend setup](docs/backend-setup.md) for verification and operations.

## Structure

```text
frontend/app/                 Vue features, stores, canvas and persistence client
frontend/server/api/          Authenticated Nitro HTTP endpoints
frontend/server/services/     Project, private-media and character workflows
frontend/server/db/migrations Versioned SQL migrations
frontend/scripts/             Migrations and regression checks
frontend/tests/               Persistence, auth and media tests
docker-compose.yaml           Local PostgreSQL with a persistent volume
```

[Backend architecture and delivery sequence](docs/backend-plan.md) · [Design system](docs/design-system.md)
