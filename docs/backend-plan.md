# Vela backend — implementation plan v3

2026-11-21. Replaces the earlier Encore proposal. The chosen stack is **Nuxt/Nitro, PostgreSQL, Clerk and private S3**. One application, versioned SQL migrations and a small set of domain services. No paid generation in this release.

## Five delivery parts

| Part | Scope | Acceptance |
| --- | --- | --- |
| 1. Identity and database | Clerk sessions, owner checks, PostgreSQL, migrations, environment setup | Signed-in user can reach their API; another user's data remains inaccessible |
| 2. Studio persistence | Projects, graph, prompts, viewport, autosave, mutation receipts, revision conflicts | A saved project survives reload; concurrent tabs cannot silently overwrite each other |
| 3. Private media | Upload validation, normalization, previews, library, favorites, S3/local storage | A real uploaded photo survives reload and cannot be downloaded anonymously |
| 4. Photo-based characters | Identity, face/body references and approvals, reference sheet, immutable published version | A saved character can be selected with @ and existing projects retain their selected version |
| 5. Integration and delivery | Cross-module tests, real Clerk/S3 verification, browser scenarios, documentation, GitHub | The complete sign-in → photo → project → character → reload flow works |

Parts 1–4 can be developed in separate worktrees against agreed contracts. They are integrated and checked together before completion is reported.

## Data and ownership

Clerk establishes identity. The backend verifies the session signature, expiry, issuer and authorized origin, then uses that identity as the owner of each resource. A request body never chooses its owner. Cookie-authenticated mutations require an allowed Origin; bearer requests are verified as well.

PostgreSQL contains users, projects, asset metadata, character drafts, immutable character versions and mutation receipts. Board documents store asset IDs and character-version IDs, not temporary blob URLs or encoded images. File bytes stay in private storage.

This first release uses one personal workspace per user, represented by owner IDs. Teams, roles and invitations are deferred until there is a product requirement. No separate Clerk Organizations or workspace hierarchy is needed yet.

## Project saves

Pinia owns immediate canvas interaction. A persistence coordinator sends debounced changes with an expected revision and a stable mutation ID. One write is in flight at a time. A successful response updates revision metadata without overwriting edits made while the request was running.

The database transaction checks a mutation receipt before checking the revision. Retrying an uncertain request therefore does not apply it twice. Reusing a mutation ID with a different payload is rejected. A stale revision returns 409; the UI retains local work and offers recovery instead of silently choosing a winner.

Undo/redo remains local canvas history. It does not undo uploads, billing or provider work. Project deletion creates a tombstone so delayed saves cannot resurrect it.

## Media lifecycle

For this first release, files upload through the authenticated API. This keeps validation and access control in one place and avoids a separate upload-completion protocol.

- Accept JPG, PNG or WebP, up to 12 MiB and 40 megapixels; decode the content instead of trusting the extension.
- Bound the incoming stream even without Content-Length. Limit concurrent image processing and per-user storage/upload usage.
- Apply orientation, strip EXIF/GPS, and write normalized WebP source plus preview using immutable generated object keys.
- Commit asset metadata only with its storage operation; ambiguous failure cleanup must not remove committed files.
- Serve files through an authenticated same-origin endpoint. No public bucket and no arbitrary external URL fetching.
- Soft-delete unused assets. An explicit maintenance sweep retains deleted files for seven days and treats uncommitted files older than 24 hours as orphan candidates. Dry-run is the default.

S3 is configured with all public-access blocks, bucket-owner-enforced ownership, encryption at rest and a policy denying insecure transport. Local storage is outside `public/`; production must not silently fall back to a development directory.

Direct-to-S3 uploads, resumable uploads and an asynchronous worker can be introduced when measured traffic or video sizes justify them. They are not required for the current photo workflow.

## Character workflow

The server owns face/body approval and sheet publication. Clients may edit names, handles, notes and owned photo IDs; they cannot assert that an arbitrary URL is an approved sheet.

Changing face inputs invalidates downstream approval and the sheet. Changing body inputs invalidates body approval and the sheet. Sheet composition uses the actual uploaded photos; it does not generate missing angles or alter identity. A revision guard prevents a stale composition from publishing after newer edits.

A published character has an immutable version and sheet asset. A canvas reference pins both. Subsequent edits or removal from the character library do not silently replace a project's existing reference.

## Environments and deployment boundary

Development uses local PostgreSQL and Clerk Development, with private S3 or local media. The app has an explicit demo mode for UI work and live mode for real persistence. Live mode starts empty and does not import sample credits or outputs.

Production hosting is a separate deployment step: select a domain and monthly budget, use Clerk Production, provision durable managed PostgreSQL and backups, deploy the Node server, and configure its origin and runtime IAM role. Local AWS CLI credentials are temporary and are not production credentials.

Production readiness also requires a restore drill, scheduled maintenance, monitoring, account-deletion lifecycle, user-facing privacy/retention rules and load testing. A passing local build alone does not establish these.

## Later: real generations

After persistence is accepted, connect the actual Seedance/Seedream provider and verify its supported models, identity-reference requirements and pricing. Existing UI labels are not an API contract.

Use durable generation jobs, immutable input manifests, idempotent submission and verified callbacks/polling. Record the provider submission before a paid call; an ambiguous timeout requires reconciliation rather than a blind second charge. Copy completed outputs to owned storage before marking them ready. Add credit reservation/settlement only alongside the real provider contract.

No Encore, Redis, Kubernetes, microservice split or distributed canvas editing is necessary for this first release.
