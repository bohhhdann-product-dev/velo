# Backend setup and operations

## Development

Use the root `docker-compose.yaml` to run PostgreSQL on `127.0.0.1:55432`. Its named volume survives container restarts. The default password is explicitly local-only; never reuse it for a hosted database. Do not run `docker compose down -v` against data you want to keep.

Copy `frontend/.env.example` to `.env`, configure the existing Clerk Development application, then run `pnpm db:migrate` and `pnpm dev --host 127.0.0.1 --port 3457` from `frontend/`. Migrations use an advisory lock and checksums; edit a new migration instead of rewriting one already applied.

`CLERK_ISSUER_URL` is the HTTPS instance domain encoded in its publishable key. `VELA_ALLOWED_ORIGINS` must contain the exact browser origins. The API accepts only verified session tokens for the configured Clerk instance. Authenticated image requests use the same-origin Clerk session cookie.

For S3, set `VELA_STORAGE_DRIVER=s3`, `AWS_REGION` and `AWS_S3_BUCKET`. Local development can use `aws login --profile vela`, then `AWS_PROFILE=vela`. These are temporary credentials: reauthenticate when the development session expires. A deployed application should use a runtime IAM role limited to its media bucket, not a copied personal session or permanent access key.

The bucket must remain private: block all public access, disable ACL ownership, encrypt objects and deny HTTP access. The browser talks to Vela's authenticated file endpoint, so a public bucket or permissive bucket CORS is unnecessary.

For local-only storage, set `VELA_STORAGE_DRIVER=local`. The default development directory is `~/.local/share/vela/media`. An override must be an absolute private directory outside `public/`. Production refuses an implicit local fallback; if deliberately self-hosting local files, configure an explicit durable volume and back it up.

## Validation

From `frontend/`:

```sh
pnpm test:studio
pnpm test:live
VELA_TEST_DATABASE_URL=postgres://vela:vela_local_only@127.0.0.1:55432/vela pnpm test:server
pnpm typecheck
pnpm build
```

The tests create isolated database schemas and temporary file directories. They verify identity boundaries, actual HTTP uploads/downloads, image decoding and metadata removal, conflicting project saves, mutation retries, character approvals, stale sheet composition, immutable version references, deletion dependencies and quotas. A test run without `VELA_TEST_DATABASE_URL` does not certify database integration.

Browser acceptance should cover sign-in; create/edit/reload a project; upload/reload/download a photo; favorite/reload; create a character with real face/body uploads; approve/build/publish; insert it with @; edit the character and confirm old project references remain pinned; sign out and confirm private state is cleared.

## Acceptance recorded on 2026-11-21

The integrated local app passed 35 server tests with PostgreSQL, the demo/live client regressions, typecheck and a production build. Browser acceptance used a dedicated Clerk Development test account and bundled sample photographs: sign-in, project and prompt edits, S3 reference upload, reload, favorites, face/body approval, sheet composition/download, publish, @ insertion and another reload. Database inspection confirmed the canvas retained an immutable character version and its sheet asset. Sign-out returned to the login screen; unauthenticated project and media requests returned 401. No generation provider was called. These checks cover local development with real S3; they do not certify a hosted production deployment.

## Maintenance

```sh
pnpm media:cleanup          # dry-run counts only
pnpm media:cleanup --apply  # explicitly apply eligible deletion
```

The maintenance command requires explicit database and storage configuration. Deleted media is retained for seven days; uncommitted orphan files have a 24-hour grace period. Referenced files remain protected. This command is not automatically scheduled by the local app.

If S3 versioning is enabled later, configure noncurrent-version retention separately: removing the current object does not erase old versions. Quotas measure application-tracked media, not an AWS invoice.

## Backups and production

The local PostgreSQL volume and S3 persistence are not a complete backup plan. Before inviting external users, configure database backups/PITR, an independent media recovery policy and a restore drill. Keep database and media lifecycles separate from server deployment so replacing the application cannot delete user data.

Production deployment is not performed by cloning the repository. It additionally needs a domain, Clerk Production and Google OAuth configuration, hosted PostgreSQL, server hosting, runtime secrets/IAM, monitored storage limits, scheduled cleanup, account-deletion handling and a defined retention policy. Select a hosting budget before provisioning continuously billed infrastructure.

Generation-provider credentials are not required for this persistence release. No real generation or credit billing is implemented.
