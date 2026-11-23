import { createHash, randomUUID } from 'node:crypto'
import sharp from 'sharp'
import { createError, getHeader, type H3Event } from 'h3'
import type postgres from 'postgres'
import { getDb } from '../utils/db'
import { getStorage } from './storage'
import { compactMutationReplies, replayReceipt } from './mutation-receipts'

export const MAX_UPLOAD_BYTES = 12 * 1024 * 1024
export const MAX_IMAGE_PIXELS = 40_000_000
export const ASSET_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
export type Db = postgres.Sql | postgres.TransactionSql
export interface AssetRow extends Record<string, unknown> {
  id: string; owner_id: string; name: string; kind: 'upload' | 'sheet' | 'generated_image' | 'generated_video'; mime_type: string
  width: number | null; height: number | null; size_bytes: string | number; source_key: string; preview_key: string | null
  preview_mime_type: string | null
  favorite: boolean; created_at: Date; deleted_at: Date | null; purged_at: Date | null
}
export interface NormalizedImage { source: Buffer; preview: Buffer; width: number; height: number }
export function fail(statusCode: number, code: string, message: string): never {
  throw createError({ statusCode, statusMessage: message, data: { code } })
}
export function assetUrl(id: string, variant: 'source' | 'preview' = 'preview') {
  return `/api/assets/${id}/file?variant=${variant}`
}
export function assetDto(asset: AssetRow) {
  const video = asset.mime_type === 'video/mp4'
  return { id: asset.id, name: asset.name, url: assetUrl(asset.id, video ? 'source' : 'preview'),
    sourceUrl: assetUrl(asset.id, 'source'), posterUrl: video && asset.preview_key ? assetUrl(asset.id) : null,
    mediaType: video ? 'video' as const : 'image' as const, createdAt: new Date(asset.created_at).getTime(),
    width: asset.width, height: asset.height, sizeBytes: Number(asset.size_bytes), mimeType: asset.mime_type,
    favorite: asset.favorite }
}
export async function lockOwner(tx: postgres.TransactionSql, ownerId: string) {
  await tx`SELECT pg_advisory_xact_lock(hashtextextended(${ownerId}, 0))`
}
export async function ownedAsset(db: Db, ownerId: string, id: string): Promise<AssetRow> {
  if (!ASSET_ID.test(id)) fail(404, 'not_found', 'Image not found')
  const [asset] = await db<AssetRow[]>`SELECT * FROM assets WHERE id = ${id} AND owner_id = ${ownerId} AND deleted_at IS NULL`
  if (!asset) fail(404, 'not_found', 'Image not found')
  return asset
}

let activeImageJobs = 0
export async function withImageSlot<T>(work: () => Promise<T>): Promise<T> {
  if (activeImageJobs >= 2) fail(429, 'media_busy', 'Image processing is busy. Try again shortly.')
  activeImageJobs++
  try { return await work() } finally { activeImageJobs-- }
}
export async function normalizeImage(input: Buffer, declaredMime?: string): Promise<NormalizedImage> {
  if (!input.length || input.length > MAX_UPLOAD_BYTES) fail(413, 'upload_too_large', 'Images must be at most 12 MiB')
  if (declaredMime && !['image/jpeg', 'image/png', 'image/webp'].includes(declaredMime))
    fail(415, 'invalid_image', 'Upload a JPG, PNG or WebP image')
  try {
    const options = { limitInputPixels: MAX_IMAGE_PIXELS, failOn: 'error' as const }
    const metadata = await sharp(input, options).metadata()
    if (!['jpeg', 'png', 'webp'].includes(metadata.format ?? '') || (metadata.pages ?? 1) !== 1)
      fail(415, 'invalid_image', 'Upload a single JPG, PNG or WebP image')
    if (!metadata.width || !metadata.height || metadata.width * metadata.height > MAX_IMAGE_PIXELS)
      fail(413, 'invalid_image', 'Images must be at most 40 megapixels')
    // rotate() applies orientation; Sharp drops EXIF/GPS and other input metadata by default.
    const result = await sharp(input, options).rotate().webp({ quality: 90 }).toBuffer({ resolveWithObject: true })
    const preview = await sharp(result.data, options).resize(1024, 1024, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 82 }).toBuffer()
    return { source: result.data, preview, width: result.info.width, height: result.info.height }
  } catch (error) {
    if (error && typeof error === 'object' && 'statusCode' in error) throw error
    fail(415, 'invalid_image', 'This image could not be decoded safely')
  }
}

// Bound the incoming stream before parsing multipart, including requests with no Content-Length.
export async function readImageUpload(event: H3Event) {
  const contentType = getHeader(event, 'content-type') ?? ''
  if (!/^multipart\/form-data\s*;/i.test(contentType)) fail(415, 'invalid_upload', 'Use multipart form data with one file')
  const maxBody = MAX_UPLOAD_BYTES + 64 * 1024
  const contentLength = Number(getHeader(event, 'content-length'))
  if (Number.isFinite(contentLength) && contentLength > maxBody) fail(413, 'upload_too_large', 'Images must be at most 12 MiB')
  const chunks: Buffer[] = []
  let size = 0
  try {
    for await (const chunk of event.node.req.iterator({ destroyOnReturn: false })) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      size += bytes.length
      if (size > maxBody) {
        event.node.req.resume()
        fail(413, 'upload_too_large', 'Images must be at most 12 MiB')
      }
      chunks.push(bytes)
    }
  } catch (error) {
    if (error && typeof error === 'object' && 'statusCode' in error) throw error
    fail(400, 'interrupted_upload', 'The image upload was interrupted')
  }
  let form: FormData
  try { form = await new Response(Buffer.concat(chunks), { headers: { 'content-type': contentType } }).formData() }
  catch { fail(400, 'invalid_upload', 'Malformed multipart upload') }
  const clientMutationId = form!.get('clientMutationId')
  if (form!.getAll('clientMutationId').length !== 1 || typeof clientMutationId !== 'string'
    || !/^[A-Za-z0-9_-]{8,120}$/.test(clientMutationId))
    fail(400, 'invalid_mutation_id', 'A unique upload ID is required')
  const files = [...form!.values()].filter((value) => typeof value !== 'string')
  const file = form!.get('file')
  if (!file || typeof file === 'string' || files.length !== 1) fail(400, 'invalid_upload', 'Choose exactly one file')
  if (file.size > MAX_UPLOAD_BYTES) fail(413, 'upload_too_large', 'Images must be at most 12 MiB')
  return { bytes: Buffer.from(await file.arrayBuffer()), mime: file.type, name: file.name, clientMutationId }
}
export function cleanFilename(name: string) {
  return name.replace(/[\\/\u0000-\u001f\u007f]/g, '_').trim().slice(0, 120) || 'Image'
}
function positiveLimit(name: string, fallback: number) {
  const value = Number(process.env[name] ?? fallback)
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${name} must be a positive integer`)
  return value
}

export async function assertMediaQuota(tx: postgres.TransactionSql, ownerId: string, size: number, slots = 1) {
  if (!Number.isSafeInteger(size) || size < 0 || !Number.isSafeInteger(slots) || slots < 0)
    throw new Error('Invalid media reservation')
  const [usage] = await tx`SELECT count(*) FILTER (WHERE deleted_at IS NULL)::int AS count,
    coalesce(sum(size_bytes), 0)::text AS bytes,
    count(*) FILTER (WHERE created_at > now() - interval '1 hour')::int AS recent
    FROM assets WHERE owner_id = ${ownerId} AND purged_at IS NULL`
  const [reserved] = await tx`SELECT coalesce(sum(t.reserved_bytes), 0)::text AS bytes,
    count(*) FILTER (WHERE t.reserved_bytes > 0)::int AS slots
    FROM generation_takes t JOIN generations g ON g.id = t.generation_id WHERE g.owner_id = ${ownerId}`
  if (Number(usage!.count) + Number(reserved!.slots) + slots > positiveLimit('VELA_MAX_ASSETS', 500)
    || Number(usage!.bytes) + Number(reserved!.bytes) + size > positiveLimit('VELA_MAX_STORAGE_BYTES', 1024 * 1024 * 1024))
    fail(413, 'quota_exceeded', 'Your media storage limit has been reached')
  if (Number(usage!.recent) + Number(reserved!.slots) + slots > positiveLimit('VELA_MAX_UPLOADS_PER_HOUR', 120))
    fail(429, 'upload_rate_limited', 'Your hourly upload limit has been reached')
}

// Call inside the owner-locked transaction and track keys for rollback cleanup.
export async function persistImage(tx: postgres.TransactionSql, ownerId: string, name: string,
  image: NormalizedImage, kind: 'upload' | 'sheet', writtenKeys: string[]) {
  const size = image.source.length + image.preview.length
  await assertMediaQuota(tx, ownerId, size)
  const id = randomUUID()
  const sourceKey = `media/${id}/source.webp`
  const previewKey = `media/${id}/preview.webp`
  const [asset] = await tx<AssetRow[]>`INSERT INTO assets
    (id, owner_id, name, kind, size_bytes, width, height, source_key, preview_key, sha256)
    VALUES (${id}, ${ownerId}, ${cleanFilename(name)}, ${kind}, ${size}, ${image.width}, ${image.height},
      ${sourceKey}, ${previewKey}, ${createHash('sha256').update(image.source).digest('hex')}) RETURNING *`
  // The generated keys are recorded before the put, so a failed response also gets cleaned up.
  writtenKeys.push(sourceKey)
  await getStorage().put(sourceKey, image.source)
  writtenKeys.push(previewKey)
  await getStorage().put(previewKey, image.preview)
  return asset!
}
export async function rollbackFiles(ownerId: string, keys: string[]) {
  if (!keys.length) return
  // A lost COMMIT response can leave the original transaction still resolving. Wait
  // for its owner lock before checking visibility; a plain SELECT could run too early
  // and delete files from a commit that succeeds moments later. On DB/storage failure,
  // leave files for the explicit orphan sweep after 24 hours.
  await getDb().begin(async (tx) => {
    await lockOwner(tx, ownerId)
    for (const key of keys) {
      const [known] = await tx`SELECT id FROM assets WHERE source_key = ${key} OR preview_key = ${key}`
      if (!known) await getStorage().remove(key)
    }
  }).catch(() => {})
}
async function storeUpload(ownerId: string, bytes: Buffer, mime: string, name: string, clientMutationId?: string) {
  const image = await normalizeImage(bytes, mime)
  const fingerprint = createHash('sha256').update(JSON.stringify([name, mime])).update(bytes).digest('hex')
  const written: string[] = []
  try {
    return await getDb().begin(async (tx) => {
      await lockOwner(tx, ownerId)
      if (clientMutationId) {
        const [receipt] = await tx`SELECT fingerprint, reply, created_at > now() - interval '7 days' AS replayable FROM mutation_receipts
          WHERE owner_id = ${ownerId} AND scope = 'assets:upload' AND client_mutation_id = ${clientMutationId}`
        if (receipt) {
          if (receipt.fingerprint !== fingerprint) fail(409, 'mutation_id_reused', 'This upload ID was already used for a different file')
          return replayReceipt(receipt.reply, receipt.replayable) as ReturnType<typeof assetDto>
        }
      }
      const response = assetDto(await persistImage(tx, ownerId, name, image, 'upload', written))
      if (clientMutationId) await tx`INSERT INTO mutation_receipts(owner_id, scope, client_mutation_id, fingerprint, reply)
        VALUES (${ownerId}, 'assets:upload', ${clientMutationId}, ${fingerprint}, ${tx.json(response)})`
      return response
    })
  } catch (error) { await rollbackFiles(ownerId, written); throw error }
}
export async function uploadImage(ownerId: string, bytes: Buffer, mime: string, name: string, clientMutationId?: string) {
  return withImageSlot(() => storeUpload(ownerId, bytes, mime, name, clientMutationId))
}
export async function receiveImageUpload(ownerId: string, event: H3Event) {
  return withImageSlot(async () => {
    const file = await readImageUpload(event)
    return storeUpload(ownerId, file.bytes, file.mime, file.name, file.clientMutationId)
  })
}
export async function listAssets(ownerId: string) {
  const assets = await getDb()<AssetRow[]>`SELECT * FROM assets
    WHERE owner_id = ${ownerId} AND deleted_at IS NULL AND kind = 'upload' ORDER BY created_at DESC LIMIT 500`
  return assets.map(assetDto)
}
export async function setAssetFavorite(ownerId: string, id: string, favorite: unknown) {
  if (typeof favorite !== 'boolean') fail(400, 'invalid_favorite', 'Favorite must be true or false')
  return getDb().begin(async (tx) => {
    await lockOwner(tx, ownerId)
    await ownedAsset(tx, ownerId, id)
    const [asset] = await tx<AssetRow[]>`UPDATE assets SET favorite = ${favorite} WHERE id = ${id} AND owner_id = ${ownerId} RETURNING *`
    return assetDto(asset!)
  })
}

export async function assetIsUsed(tx: postgres.TransactionSql, ownerId: string, id: string): Promise<boolean> {
  const [result] = await tx`SELECT
    EXISTS (SELECT 1 FROM projects p, jsonb_array_elements(p.board->'nodes') n
      WHERE p.owner_id = ${ownerId} AND p.deleted_at IS NULL AND n->>'assetId' = ${id})
    OR EXISTS (SELECT 1 FROM characters c WHERE c.owner_id = ${ownerId} AND c.deleted_at IS NULL AND (
      c.document->>'sheetAssetId' = ${id}
      OR EXISTS (SELECT 1 FROM jsonb_each(c.document#>'{face,photos}') p WHERE p.value->>'assetId' = ${id})
      OR EXISTS (SELECT 1 FROM jsonb_each(c.document#>'{body,photos}') p WHERE p.value->>'assetId' = ${id})))
    OR EXISTS (SELECT 1 FROM character_versions v WHERE v.owner_id = ${ownerId} AND v.retired_at IS NULL AND (
      v.sheet_asset_id::text = ${id}
      OR EXISTS (SELECT 1 FROM jsonb_each(v.document#>'{face,photos}') p WHERE p.value->>'assetId' = ${id})
      OR EXISTS (SELECT 1 FROM jsonb_each(v.document#>'{body,photos}') p WHERE p.value->>'assetId' = ${id})))
    OR EXISTS (SELECT 1 FROM generations g, jsonb_array_elements(g.manifest->'references') r
      WHERE g.owner_id = ${ownerId} AND r->>'assetId' = ${id}
      AND EXISTS (SELECT 1 FROM generation_takes t WHERE t.generation_id = g.id
        AND t.status IN ('queued','preparing','submitting','running','ingesting','unknown')))
    OR EXISTS (SELECT 1 FROM generation_takes t JOIN generations g ON g.id = t.generation_id
      WHERE g.owner_id = ${ownerId} AND t.output_asset_id::text = ${id} AND (g.deleted_at IS NULL
        OR EXISTS (SELECT 1 FROM projects p, jsonb_array_elements(p.board->'nodes') n
          WHERE p.owner_id = ${ownerId} AND p.deleted_at IS NULL AND n->>'type' = 'take'
            AND n->>'takeId' = t.id::text AND n->>'generationId' = g.id::text))) AS used`
  return Boolean(result!.used)
}
async function unusedVersions(db: Db, ownerId: string | null, limit: number) {
  return db<{ id: string; owner_id: string; sheet_asset_id: string }[]>`SELECT v.id, v.owner_id, v.sheet_asset_id
    FROM character_versions v WHERE v.retired_at IS NULL
      AND (${ownerId}::text IS NULL OR v.owner_id = ${ownerId})
      AND NOT EXISTS (SELECT 1 FROM characters c WHERE c.owner_id = v.owner_id AND c.deleted_at IS NULL
        AND c.document->>'characterVersionId' = v.id::text)
      AND NOT EXISTS (SELECT 1 FROM projects p, jsonb_array_elements(p.board->'nodes') n
        WHERE p.owner_id = v.owner_id AND p.deleted_at IS NULL AND n->>'characterVersionId' = v.id::text)
      AND NOT EXISTS (SELECT 1 FROM generations g, jsonb_array_elements(g.manifest->'references') r
        WHERE g.owner_id = v.owner_id AND r->>'characterVersionId' = v.id::text
        AND EXISTS (SELECT 1 FROM generation_takes t WHERE t.generation_id = g.id
          AND t.status IN ('queued','preparing','submitting','running','ingesting','unknown')))
    ORDER BY v.created_at, v.id LIMIT ${limit}`
}
/** Caller holds the owner lock shared with every change to project/character pins. */
export async function retireUnusedVersions(tx: postgres.TransactionSql, ownerId: string, limit = 2000) {
  const unused = await unusedVersions(tx, ownerId, limit)
  if (!unused.length) return []
  await tx`UPDATE character_versions SET retired_at = now() WHERE owner_id = ${ownerId} AND id IN ${tx(unused.map((version) => version.id))}`
  for (const sheetId of new Set(unused.map((version) => version.sheet_asset_id))) {
    if (!await assetIsUsed(tx, ownerId, sheetId))
      await tx`UPDATE assets SET deleted_at = coalesce(deleted_at, now()) WHERE id = ${sheetId} AND owner_id = ${ownerId}`
  }
  return unused.map((version) => version.id)
}
export async function deleteAsset(ownerId: string, id: string) {
  return getDb().begin(async (tx) => {
    await lockOwner(tx, ownerId)
    if (!ASSET_ID.test(id)) fail(404, 'not_found', 'Image not found')
    const [asset] = await tx<AssetRow[]>`SELECT * FROM assets WHERE id = ${id} AND owner_id = ${ownerId}`
    if (!asset) fail(404, 'not_found', 'Image not found')
    if (asset.deleted_at) return // Retrying a successful deletion is safe for its owner.
    await retireUnusedVersions(tx, ownerId)
    if (await assetIsUsed(tx, ownerId, id)) fail(409, 'asset_in_use', 'This image is used by a project or character')
    await tx`UPDATE assets SET deleted_at = now() WHERE id = ${id} AND owner_id = ${ownerId}`
  })
}

/** Explicit maintenance only. Dry-run by default; retain deleted files for seven days. */
export async function cleanupMedia({ dryRun = true, limit = 100 }: { dryRun?: boolean; limit?: number } = {}) {
  const db = getDb()
  limit = Number.isSafeInteger(limit) ? Math.min(Math.max(limit, 1), 1000) : 100
  const receipts = await compactMutationReplies({ dryRun, limit })
  const result = { deletedAssets: [] as string[], orphanKeys: [] as string[], retiredVersions: [] as string[], receipts }
  const versions = await unusedVersions(db, null, limit)
  if (dryRun) result.retiredVersions = versions.map((version) => version.id)
  else for (const ownerId of new Set(versions.map((version) => version.owner_id))) {
    const remaining = limit - result.retiredVersions.length
    if (!remaining) break
    result.retiredVersions.push(...await db.begin(async (tx) => {
      await lockOwner(tx, ownerId)
      return retireUnusedVersions(tx, ownerId, remaining)
    }))
  }
  const candidates = await db<AssetRow[]>`SELECT * FROM assets
    WHERE deleted_at < now() - interval '7 days' AND purged_at IS NULL ORDER BY deleted_at LIMIT ${Math.min(Math.max(limit, 1), 1000)}`
  for (const asset of candidates) {
    await db.begin(async (tx) => {
      await lockOwner(tx, asset.owner_id)
      if (await assetIsUsed(tx, asset.owner_id, asset.id)) return
      result.deletedAssets.push(asset.id)
      if (!dryRun) {
        await getStorage().remove(asset.source_key)
        if (asset.preview_key) await getStorage().remove(asset.preview_key)
        await tx`UPDATE assets SET purged_at = now() WHERE id = ${asset.id} AND deleted_at IS NOT NULL`
      }
    })
  }
  for await (const object of getStorage().list()) {
    if (result.orphanKeys.length >= limit) break
    if (Date.now() - object.modifiedAt.getTime() < 24 * 60 * 60 * 1000) continue
    const [known] = await db`SELECT id FROM assets WHERE source_key = ${object.key} OR preview_key = ${object.key}`
    if (known) continue
    result.orphanKeys.push(object.key)
    if (!dryRun) await getStorage().remove(object.key)
  }
  return result
}
