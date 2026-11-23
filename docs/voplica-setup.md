# Voplica generation in Vela

Vela now has a separate Voplica adapter alongside BytePlus ModelArk. PostgreSQL owns the queue and immutable generation inputs; the explicit worker submits and polls jobs. No Encore, extra queue service, SDK, or public media bucket is needed.

## Models and verified contract

Verified against Voplica's public catalogue and official API on 2026-11-21:

| Studio model | Provider variant | Supported inputs |
| --- | --- | --- |
| MiniMax H3 | `01M6MQG2J9ZF86MES4FJ4MR1DJ` | Text, image/character references, or start/end frames |
| H3 Eros Max · Beta7 | `01M765CW9DP2X9GD4MG8G54P2V` | Text and image/character references |

Beta7 is the exact user-selected variant of model `01M765C1GX68BXWVH35PQA1PBF`. It is a reference checkpoint. Voplica can route first/last-frame requests to the base H3 checkpoint, so Vela deliberately disallows frame slots on Beta7. Choose MiniMax H3 explicitly for that mode. Both variants were published and inference-enabled at verification time; the check command revalidates that information.

The initial controls are 720p, 5/10/15 seconds, one to four separate takes, and up to nine images. H3 uses a native 32-pixel dimension grid and fixed 24fps with frame counts congruent to 5 modulo 17. Actual requested dimensions are 1280×736, 736×1280, or 960×960, and frame counts 124/243/362. Duration/aspect labels are approximate. These are conservative Vela controls, not the provider's full maximum capabilities.

Other Voplica families, LoRAs, audio/video references, and optional refinement are not exposed yet. Adding a catalogue entry alone is insufficient: new families need validated parameters and adapter tests. Vela's public positioning remains SFW social video.

## Configure locally

1. Apply migrations: `cd frontend && pnpm db:migrate`. Migration 006 adds resumable provider-upload state and upstream usage accounting.
2. Create a personal API key in [Voplica API keys](https://voplica.com/profile/api-keys). Save `VOPLICA_API_KEY` only in ignored `frontend/.env` with mode `0600`. Never use a `NUXT_PUBLIC_*` variable or paste the token into an issue, terminal command line, commit, or chat.
3. Run `pnpm voplica:check` to verify public workflow, schema and model IDs. This command requires no key.
4. Run `pnpm voplica:check --dry-run` to verify authenticated execution admission for both variants. It always sends `dryRun: true`, uses fresh idempotency keys, uploads no photos and cannot launch a paid generation. A successful dry-run does not certify image-conditioned inference, result download, or output quality.
5. After account access and an agreed test spend are ready, set both `VELA_GENERATION_ENABLED=true` and `VELA_VOPLICA_ENABLED=true`, restart the app, and run `pnpm generation:worker` separately. Without both flags, new Voplica jobs are disabled. No worker is started implicitly by the web server.

API usage requires subscription, Anytime, or Earned credits. The free-credit balance shown in Voplica Studio cannot fund API inference. The workflow's pricing hint is not a guaranteed price, and Vela customer pricing is still unset. Never treat provider milli-credits as Vela wallet credits.

To stop new submissions, disable `VELA_VOPLICA_ENABLED` and restart the processes. With the key still configured, the worker continues polling accepted jobs, storing results, and cleaning uploads. Removing/revoking the key also stops those operations. Keep the worker running while draining jobs.

## Request and storage lifecycle

- Clerk verifies the user. Server-side ownership checks cover projects, reference assets, character versions, and copied results. The browser cannot choose a provider URL, API key, arbitrary workflow, or provider variant.
- Admission saves the model/variant/workflow, settings, resolved prompt, ordered references and published character-version pins in one transaction with the canvas results and storage reservation. Edits after admission cannot change the submitted request. Per-model limits are checked again on the server.
- Vela `@handle` mentions become provider references such as `@[ref1](reference:ref1)`. Character sheets use `IDENTITY_SHEET`; ordinary images use `IDENTITY_IMAGES`; frame slots use the corresponding start/end roles. Vela does not create or publish a separate Voplica character.
- Private source images are loaded from Vela storage, validated, and uploaded through `InitFileUpload → /storage/upload → FinalizeFileUpload`. Upload IDs, byte attempts and successful byte acknowledgements are checkpointed in PostgreSQL. Voplica can report zero uploaded bytes until finalization, so a stale status read must not overwrite confirmed progress. If a byte request has an uncertain outcome, the worker removes and recreates only that unsubmitted reference upload; earlier completed references remain. This may repeat file transfer, never paid inference. Each turn performs a bounded upload step; pending preparation expires after one hour.
- Only completed uploads reach `ExecuteWorkflow`. The request explicitly uses `PRIVATE` visibility and `STAGE_NONE`, omits paid refinement, and leaves provider moderation/privacy defaults intact. Default privacy is not a contractual claim of zero retention or no training.
- Each take has a stable, server-derived idempotency key. The worker durably marks submission before sending the paid request. If its outcome is uncertain, the take becomes `unknown` and is not automatically submitted again. Upstream idempotency provides another guard; it does not replace local reconciliation.
- The worker polls the saved execution ID. Upstream charged/reversed/net milli-credits and warning codes are stored separately from Vela's still-unimplemented billing. No invented price or balance is presented to the user.
- Completed runs resolve a file ID through `GetFileInfo`. The signed URL is fetched without API credentials. HTTPS, public DNS resolution, pinned destination addresses, no redirects, bounded bytes/deadlines and actual media inspection protect ingestion. ModelArk's fixed-host policy remains separate.
- Original MP4 bytes are saved into Vela's private storage and served through authenticated, owner-scoped media routes. Expired provider URLs are refreshed from the existing execution; storage retries never generate a second video.
- Once a take is done or definitively failed, its temporary reference uploads are deleted from Voplica with checkpointed cleanup. Unknown outcomes keep their uploads until reconciled. Provider-generated files/run records remain subject to provider retention; copying into Vela does not delete them automatically.

## Recovery and operational limits

A worker restart resumes queued uploads and running tasks. Expired submission leases become `unknown`; inspect the existing Voplica execution before any manual retry. Do not clear the unknown flag just to unblock a button. The UI blocks another generation from that generator while an uncertain one exists.

Deleting a local project cancels only queued/preparing work. An already accepted paid request is drained and its output retired if it has no remaining canvas pins. Upload cleanup cannot overwrite a newer lease. A process dying between remote upload initialization and the first local checkpoint can still leave an orphan; inspect Voplica My Files during periodic operational cleanup. Automatic deletion of unrelated account files is intentionally absent.

This implementation is local development infrastructure. A public launch still needs worker hosting/monitoring, user billing and spending limits, scheduled maintenance, backup/restore, and a real provider smoke test covering reference upload → inference → private MP4 retrieval. Never expose an enabled shared provider account to public signups without a spend policy.

## Evidence and sources

- Public `pnpm voplica:check` verifies the live workflow and both exact variants. Authenticated checks require the local key and eligible credits. Real synthetic 400×400 WebP (SIMPLE) and 1200×1600 PNG, 5,771,880 bytes (MULTIPART), were uploaded, finalized, read back byte-for-byte through the guarded downloader, and removed. This exposed and fixed stale provider upload counters. Real video inference remains untested until the account is funded.
- Contract tests cover private payloads, native dimensions, stable per-take idempotency, upload resume, status/output parsing, disabled paid submission and safe error handling.
- PostgreSQL tests cover admission limits, immutable Beta7 selection, upload checkpoints across restart, drain while disabled, storage retry without paid retry, cleanup and unknown outcomes.
- Download tests cover source-provider mismatch, credentials, redirects, private/mixed DNS responses, byte caps and existing ModelArk behavior.

Primary references: [API overview](https://docs.voplica.com/api/), [official definitions](https://github.com/voplica/api), [generation guide](https://docs.voplica.com/api/guides/generate/), [upload guide](https://docs.voplica.com/api/guides/upload/), [references](https://docs.voplica.com/api/concepts/references/), [selected Beta7 model](https://voplica.com/models/01M765C1GX68BXWVH35PQA1PBF/variant/01M765CW9DP2X9GD4MG8G54P2V).
