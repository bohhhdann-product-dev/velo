# BytePlus ModelArk: enabling generation

Vela uses the existing Clerk identity, PostgreSQL and private media storage. A separate Node worker reads durable jobs from PostgreSQL. No Encore, Redis or public media bucket is required.

Generation remains disabled by default. Project editing, uploads, character sheets, favorites and downloads work without a provider key. The live workspace does not simulate successful generations or invent credit prices.

## Connect the account

1. In BytePlus ModelArk, select Singapore (`ap-southeast-1`), activate the intended image/video models, and confirm billing and account limits. An API key alone does not activate models or fund the account.
2. Create a server API key. Put it directly in the ignored `frontend/.env` for local development, or in the hosting secret manager for deployment. Do not send it in a prompt, commit it, or use a `NUXT_PUBLIC_*` variable.
3. Use the tested model configuration below. An `ep-…` endpoint is supported only when it is configured for the corresponding model family and capabilities. Other models need an explicit adapter/capability update.
4. Apply migrations, restart the app and start the worker. Enabling generation authorizes paid provider requests when users press Generate. Keep it disabled until account access and limits have been reviewed.

```dotenv
VELA_GENERATION_ENABLED=true
ARK_API_KEY=<server secret>
ARK_BASE_URL=https://ark.ap-southeast.bytepluses.com/api/v3
ARK_IMAGE_MODEL=dola-seedream-5-0-pro-260628
ARK_VIDEO_MODEL=dreamina-seedance-2-5-260628
```

From `frontend/`, using the same database and storage configuration for the app and worker:

```sh
pnpm db:migrate
pnpm dev --host 127.0.0.1 --port 3457
# A separate terminal / supervised process:
pnpm generation:worker
```

`pnpm generation:worker --once` processes one eligible unit of work and exits. A video generally requires subsequent runs for polling and ingestion. With credentials configured, the worker can drain already accepted jobs even while new generation is disabled. It exits with an error if no provider credentials are configured. Setting a key does not start a worker; queued jobs need the separate process. Production must supervise both processes and retain their database/storage across restarts.

## What happens after Generate

The app first saves the canvas. One idempotent request records an immutable prompt/settings/reference manifest and appends output nodes atomically. Each output is a separate durable take; selecting four outputs can cause four paid submissions.

The worker prepares private references as bounded image data, then records its submission marker before calling ModelArk. Image generation is synchronous; video creation returns a task ID that is saved before polling. Vela stores completed files in its own private storage before marking a take complete. Image originals and MP4 bytes remain intact; previews are separate. Authenticated video delivery supports byte ranges.

Admission reserves a media slot and the maximum allowed output size for every take (37 MiB per image, 232 MiB per video including its poster). Uploads and sheet composition respect these reservations. Completion consumes the reservation atomically; rejected/cancelled work releases it. Unconfirmed paid submissions retain theirs until reconciled. This is storage protection, not a spending budget: configure financial limits in BytePlus separately.

Concurrent workers claim jobs using database leases. A lost paid POST response or an expired submission lease becomes an **unconfirmed** outcome. It is never automatically submitted again. Check the ModelArk task/request history before resolving such a case; Vela does not yet expose a manual reconciliation screen. A storage retry repeats only the download/save, not the paid generation. Provider output URLs are temporary; ingestion retries stop after the retention window.

Live settings intentionally expose a small supported subset: Seedream 5 Pro and Seedance 2.5, three aspect ratios, supported quality levels and video duration. Character sheets work as image references. Frame-guided video uses the provider's adaptive aspect ratio. No billing ledger, customer payment system or guaranteed provider cost estimate is implemented.

## Real people in videos

Local face/body approval means that the user reviewed their photos. It is **not** BytePlus identity authorization.

The current Seedance 2.x real-person flow requires authorized portrait assets, with provider verification/access. Arbitrary uploaded face photos and local character sheets do not supply an authorized `asset://` reference. Vela therefore blocks character-to-video generation on Seedance and offers **Use in image**. The separate [Voplica MiniMax integration](voplica-setup.md) accepts character-sheet references and can offer **Use in video** when configured. Ordinary landscape/object references remain available for video; Vela does not classify whether an arbitrary upload contains a person.

The portrait authorization flow is a separate integration: confirm access in the BytePlus account, choose the documented verification method, then implement storage of the authorized provider asset identity and its lifecycle. It cannot honestly be reduced to adding the generation API key.

## First paid acceptance, after connection

Use one small image output, then one short video with a non-portrait reference. Verify the result in ModelArk, Vela's private storage, reload, playback, source download and account isolation. Confirm actual charges in BytePlus. Do not use a second Generate click to investigate an unconfirmed request.

Before inviting external users, complete the deployment/backups/account-deletion requirements in [backend-setup.md](backend-setup.md). The pre-key tests use provider fixtures; they do not certify an account's model access, moderation decisions, real latency, output quality or billing.

## Official references checked 2026-11-21

- [Image generation API](https://ai.byteplus.com/ark/region:ap-southeast-1/docs/image-generation-api.md)
- [Video creation API](https://ai.byteplus.com/ark/region:ap-southeast-1/docs/create-video-generation-task-api.md)
- [Video task retrieval](https://ai.byteplus.com/ark/region:ap-southeast-1/docs/get-video-generation-task-api.md)
- [Model list](https://ai.byteplus.com/ark/region:ap-southeast-1/docs/model-list.md)
- [Seedance portrait asset guide](https://ai.byteplus.com/ark/region:ap-southeast-1/docs/seedance-portrait-asset-guide)
- [Upload real-person portrait assets](https://ai.byteplus.com/ark/region:ap-southeast-1/docs/upload-real-person-portrait-assets)
- [Official generated-content download domains](https://docs.byteplus.com/en/docs/iga/accelerate_downloads_of_ai_generated_content_en-us)
