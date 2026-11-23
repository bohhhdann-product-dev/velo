import { randomUUID } from 'node:crypto'
import sharp from 'sharp'
import type postgres from 'postgres'
import { getDb } from '../../utils/db'
import { assetIsUsed, fail, lockOwner, ownedAsset, retireUnusedVersions, rollbackFiles, assertMediaQuota } from '../media'
import { getStorage } from '../storage'
import { prepareGeneratedMedia, persistGeneratedMedia } from '../generated-media'
import { generationConfig } from './config'
import { modelArkProvider } from './modelark'
import { voplicaProvider } from './voplica'
import { voplicaConfig } from './voplica-config'
import { ProviderFailure, type GenerationManifest, type GenerationProvider, type ProviderOutput, type ProviderState } from './provider'
import { assertProviderSpendingAllowed, settleTakeTokens } from '../billing'
import { assertGenerationPolicy } from './account-policy'

type Claim = { id: string; generation_id: string; owner_id: string; status: string; manifest: GenerationManifest;
  provider_task_id: string | null; provider_response: ProviderOutput | null; provider_state: ProviderState;
  lease_token: string; created_at: Date; preparation_started_at: Date | null; output_received_at: Date | null }
const UNKNOWN = 'The provider may have accepted this request. Check its result before starting another generation; it will not be submitted again automatically.'
async function claimWork(): Promise<Claim | null> {
  const db = getDb()
  const ark = generationConfig(), voplica = voplicaConfig()
  const enabled = [ark.modelArkEnabled ? 'modelark' : '', voplica.enabled ? 'voplica' : '']
  const configured = [ark.modelArkConfigured ? 'modelark' : '', voplica.configured ? 'voplica' : '']
  return db.begin(async tx => {
    // Serialize admission across worker processes; each paid POST has a durable marker first.
    await tx`SELECT pg_advisory_xact_lock(8642102027)`
    await tx`UPDATE generation_takes SET status = 'unknown', error_code = 'submission_unknown', error_message = ${UNKNOWN},
      lease_token = NULL, lease_until = NULL, updated_at = now() WHERE status = 'submitting' AND lease_until < now()`
    await tx`UPDATE generation_takes SET status = 'queued', lease_token = NULL, lease_until = NULL
      WHERE status = 'preparing' AND lease_until < now()`
    const [row] = await tx`SELECT t.*, g.owner_id, g.manifest FROM generation_takes t JOIN generations g ON g.id = t.generation_id
      WHERE (t.status IN ('queued', 'running', 'ingesting') OR
          (t.status IN ('done', 'failed') AND jsonb_array_length(coalesce(t.provider_state->'uploads', '[]'::jsonb)) > 0))
        AND coalesce(g.manifest->>'provider', 'modelark') IN ${tx(configured)}
        AND (t.status <> 'queued' OR coalesce(g.manifest->>'provider', 'modelark') IN ${tx(enabled)})
        AND t.next_attempt_at <= now()
        AND (t.lease_until IS NULL OR t.lease_until < now())
        AND (t.status <> 'queued' OR (g.deleted_at IS NULL AND
          (SELECT count(*) FROM generation_takes WHERE status IN ('preparing', 'submitting', 'running')) < 2))
      ORDER BY CASE WHEN t.status = 'queued' THEN 1 ELSE 0 END, t.next_attempt_at, t.created_at
      LIMIT 1 FOR UPDATE OF t SKIP LOCKED`
    if (!row) return null
    const token = randomUUID()
    await tx`UPDATE generation_takes SET status = ${row.status === 'queued' ? 'preparing' : row.status},
      preparation_started_at = CASE WHEN ${row.status} = 'queued' THEN coalesce(preparation_started_at, now()) ELSE preparation_started_at END,
      lease_token = ${token}, lease_until = now() + interval '5 minutes', updated_at = now() WHERE id = ${row.id}`
    return { ...row, preparation_started_at: row.preparation_started_at ?? new Date(), lease_token: token } as Claim
  }) as Promise<Claim | null>
}
async function referenceData(claim: Claim) {
  const result: string[] = []
  let encodedBytes = 0
  for (const reference of claim.manifest.references) {
    const asset = await ownedAsset(getDb(), claim.owner_id, reference.assetId)
    const poster = asset.kind === 'generated_video'
    const key = poster ? asset.preview_key : asset.source_key
    if (!key) fail(400, 'missing_poster', 'This video has no reference frame. Use an image instead.')
    let bytes: Buffer
    try { bytes = await getStorage().get(key) }
    catch { throw new ProviderFailure('transient', 'reference_storage_pending') }
    const metadata = await sharp(bytes, { limitInputPixels: 36_000_000, failOn: 'error' }).metadata()
    const width = metadata.width ?? 0, height = metadata.height ?? 0
    const video = claim.manifest.draft.mode === 'video'
    if (!['jpeg', 'png', 'webp'].includes(metadata.format ?? '') || bytes.length >= 30_000_000
      || width < (video ? 300 : 15) || height < (video ? 300 : 15) || (video && (width > 6000 || height > 6000))
      || width / height < (video ? 0.4 : 1 / 16) || width / height > (video ? 2.5 : 16))
      fail(400, 'invalid_provider_reference', video ? 'Video references need 300–6000 px sides and an aspect ratio from 0.4 to 2.5.' : 'This image does not meet ModelArk reference limits.')
    const encoded = `data:image/${metadata.format};base64,${bytes.toString('base64')}`
    encodedBytes += encoded.length
    if (encodedBytes > 60 * 1024 * 1024) fail(413, 'references_too_large', 'The combined references are too large. Use fewer or smaller images.')
    result.push(encoded)
  }
  return result
}
async function updateClaim(claim: Claim, status: string, errorCode: string | null = null, message: string | null = null, delaySeconds = 0) {
  const db = getDb()
  await db.begin(async tx => {
    await lockOwner(tx, claim.owner_id)
    const changed = await tx`UPDATE generation_takes SET status = ${status}, reserved_bytes = CASE WHEN ${status} = 'failed' THEN 0 ELSE reserved_bytes END, error_code = ${errorCode}, error_message = ${message},
      lease_token = NULL, lease_until = NULL, next_attempt_at = now() + ${delaySeconds}::int * interval '1 second', updated_at = now()
      WHERE id = ${claim.id} AND lease_token = ${claim.lease_token}
        AND (${status} <> 'unknown' OR (provider_task_id IS NULL AND provider_response IS NULL)) RETURNING id`
    if (status === 'failed' && changed.length) {
      await settleTakeTokens(tx, claim.owner_id, claim.id, 'release')
      await retireUnusedVersions(tx, claim.owner_id)
    }
  })
}
async function ingest(claim: Claim, output: ProviderOutput) {
  // Only immutable server manifests select the downloader's provider policy.
  if ((output.provider ?? 'modelark') !== (claim.manifest.provider ?? 'modelark'))
    throw new ProviderFailure('transient', 'output_provider_mismatch')
  const prepared = await prepareGeneratedMedia(output, claim.manifest.provider ?? 'modelark')
  const written: string[] = []
  try {
    await getDb().begin(async tx => {
      await lockOwner(tx, claim.owner_id)
      const [current] = await tx`SELECT status FROM generation_takes WHERE id = ${claim.id} AND lease_token = ${claim.lease_token} FOR UPDATE`
      if (!current || current.status !== 'ingesting') return
      // Consume this job's reservation in the same transaction as its real bytes.
      await tx`UPDATE generation_takes SET reserved_bytes = 0 WHERE id = ${claim.id}`
      const asset = await persistGeneratedMedia(tx, claim.owner_id, `Generated ${output.mode}`, prepared, written)
      await tx`UPDATE generation_takes SET status = 'done', output_asset_id = ${asset.id}, provider_response = NULL,
        lease_token = NULL, lease_until = NULL, error_code = NULL, error_message = NULL, updated_at = now() WHERE id = ${claim.id}`
      await settleTakeTokens(tx, claim.owner_id, claim.id, 'spend')
      if (!await assetIsUsed(tx, claim.owner_id, asset.id))
        await tx`UPDATE assets SET deleted_at = now() WHERE id = ${asset.id}`
      await retireUnusedVersions(tx, claim.owner_id)
    })
  } catch (error) { await rollbackFiles(claim.owner_id, written); throw error }
}
/** One bounded unit of work. Tests inject a provider; production uses the explicit CLI. */
export async function runGenerationWorkerOnce(injectedProvider?: GenerationProvider) {
  const claim = await claimWork()
  if (!claim) return false
  const provider = injectedProvider ?? (claim.manifest.provider === 'voplica' ? voplicaProvider() : modelArkProvider())
  const saveProviderState = async (state: ProviderState) => {
    const rows = await getDb()`UPDATE generation_takes SET provider_state = ${getDb().json(state as unknown as postgres.JSONValue)}
      WHERE id = ${claim.id} AND lease_token = ${claim.lease_token} RETURNING id`
    if (!rows.length) throw new ProviderFailure('transient', 'lease_lost')
    claim.provider_state = state
  }
  let submitted = false
  let stage = claim.status
  try {
    if (claim.status === 'done' || claim.status === 'failed') {
      if (!provider.cleanup) throw new ProviderFailure('transient', 'cleanup_unavailable')
      await provider.cleanup(claim.provider_state, saveProviderState)
      // Cleanup must not erase the generation's outcome or error message.
      await getDb()`UPDATE generation_takes SET lease_token = NULL, lease_until = NULL, next_attempt_at = now() + interval '2 seconds'
        WHERE id = ${claim.id} AND lease_token = ${claim.lease_token}`
      return true
    }
    let output = claim.provider_response
    if (claim.status === 'queued') {
      await assertGenerationPolicy(getDb(), claim.owner_id, claim.manifest.draft.modelId)
      let references = await referenceData(claim)
      if (provider.prepare) {
        if (Date.now() - new Date(claim.preparation_started_at!).getTime() > 3600_000)
          throw new ProviderFailure('rejected', 'reference_preparation_expired')
        const prepared = await provider.prepare(claim.manifest, references, { state: claim.provider_state, save: saveProviderState })
        if (!prepared.ready) { await updateClaim(claim, 'queued', null, null, 2); return true }
        references = prepared.references
      }
      const marked = await getDb().begin(async tx => {
        await lockOwner(tx, claim.owner_id)
        const [current] = await tx`SELECT id FROM generation_takes WHERE id = ${claim.id} AND lease_token = ${claim.lease_token} AND status = 'preparing' FOR UPDATE`
        if (!current) return false
        await assertGenerationPolicy(tx, claim.owner_id, claim.manifest.draft.modelId)
        await assertProviderSpendingAllowed(tx, claim.owner_id)
        await assertMediaQuota(tx, claim.owner_id, 0, 0)
        await tx`UPDATE generation_takes SET status = 'submitting', submitted_at = now(), lease_until = now() + interval '5 minutes', updated_at = now() WHERE id = ${claim.id}`
        return true
      })
      if (!marked) return true // The project was deleted while references were being prepared.
      submitted = true
      stage = 'submitting'
      if (claim.manifest.draft.mode === 'video') {
        const taskId = await provider.video(claim.manifest, references, claim.id)
        await getDb()`UPDATE generation_takes SET provider_task_id = ${taskId}, status = 'running',
          lease_token = NULL, lease_until = NULL, next_attempt_at = now() + interval '5 seconds', updated_at = now()
          WHERE id = ${claim.id} AND lease_token = ${claim.lease_token}`
        return true
      }
      output = await provider.image(claim.manifest, references)
    } else if (claim.status === 'running') {
      if (!claim.provider_task_id) { await updateClaim(claim, 'unknown', 'submission_unknown', UNKNOWN); return true }
      const result = await provider.poll(claim.provider_task_id)
      if (result.usage) await getDb()`UPDATE generation_takes SET provider_usage = ${getDb().json(result.usage as unknown as postgres.JSONValue)}
        WHERE id = ${claim.id} AND lease_token = ${claim.lease_token}`
      if (result.status === 'queued' || result.status === 'running') { await updateClaim(claim, 'running', null, null, 5); return true }
      if (result.status === 'failed') { await updateClaim(claim, 'failed', result.code, 'The provider could not complete this take. Check its prompt and reference requirements.'); return true }
      output = result.output
    } else if (claim.status === 'ingesting' && claim.manifest.provider === 'voplica' && claim.provider_task_id) {
      // File links expire. Refresh only the existing result, never execute a second run.
      const refreshed = await provider.poll(claim.provider_task_id)
      if (refreshed.status !== 'succeeded') throw new ProviderFailure('transient', 'output_unavailable')
      output = refreshed.output
    }
    if (!output) throw new ProviderFailure('transient', 'missing_output')
    await getDb()`UPDATE generation_takes SET status = 'ingesting', provider_response = ${getDb().json(output as unknown as postgres.JSONValue)},
      output_received_at = coalesce(output_received_at, now()), updated_at = now()
      WHERE id = ${claim.id} AND lease_token = ${claim.lease_token}`
    stage = 'ingesting'
    await ingest(claim, output)
  } catch (error) {
    if (stage === 'done' || stage === 'failed') {
      await getDb()`UPDATE generation_takes SET lease_token = NULL, lease_until = NULL, next_attempt_at = now() + interval '5 minutes'
        WHERE id = ${claim.id} AND lease_token = ${claim.lease_token}`
    } else if (stage === 'ingesting') {
      const expired = claim.output_received_at && Date.now() - new Date(claim.output_received_at).getTime() > 24 * 3600_000
      await updateClaim(claim, expired ? 'failed' : 'ingesting', expired ? 'output_expired' : 'output_storage_pending',
        expired ? 'The provider output could not be saved before its link expired. This paid request will not be repeated.'
          : 'The result is ready; saving it to your workspace will be retried.', 30)
    } else if (submitted) {
      const rejected = error instanceof ProviderFailure && error.outcome === 'rejected'
      await updateClaim(claim, rejected ? 'failed' : 'unknown', rejected ? error.code : 'submission_unknown',
        rejected ? 'The provider rejected this take. Check model access, prompt, and reference requirements.' : UNKNOWN)
    } else if (claim.status === 'running') {
      // A transport error cannot prove a paid task failed, regardless of its age.
      await updateClaim(claim, 'running', 'provider_poll_pending', 'Waiting to reconnect to the provider.', 30)
    } else if (error instanceof ProviderFailure && error.outcome === 'transient'
      && Date.now() - new Date(claim.preparation_started_at!).getTime() < 3600_000) {
      await updateClaim(claim, 'queued', 'reference_upload_pending', 'Preparing reference images. This take has not been submitted yet.', 30)
    } else {
      const policyCode = error && typeof error === 'object' && 'data' in error ? (error.data as { code?: string })?.code : undefined
      await updateClaim(claim, 'failed', error instanceof ProviderFailure ? error.code : policyCode ?? 'invalid_input', error && typeof error === 'object' && 'statusMessage' in error
        ? String(error.statusMessage) : 'The reference images could not be prepared. Check that they are available and meet the model limits.')
    }
  }
  return true
}
