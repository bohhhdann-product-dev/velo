import { createHash, randomUUID } from 'node:crypto'
import sharp, { type OverlayOptions } from 'sharp'
import type postgres from 'postgres'
import { getDb } from '../utils/db'
import { ASSET_ID, MAX_IMAGE_PIXELS, assetIsUsed, assetUrl, fail, lockOwner, ownedAsset, persistImage,
  rollbackFiles, withImageSlot, type Db, type NormalizedImage } from './media'
import { getStorage } from './storage'

const ANGLES = ['front', 'left', 'right', 'extra'] as const
type Angle = typeof ANGLES[number]
type Stage = 'face' | 'body'
type Photos = Partial<Record<Angle, { assetId: string }>>
interface PhotoStage { photos: Photos; notes: string; approved: boolean }
interface CharacterDocument {
  name: string; handle: string; face: PhotoStage; body: PhotoStage; revision: number
  sheetAssetId: string | null; characterVersionId: string | null; savedAt: number | null
}
interface CharacterRow extends Record<string, unknown> {
  id: string; owner_id: string; document: CharacterDocument; storage_revision: number; created_at: Date | string
}
const CHARACTER_ID = /^[A-Za-z0-9_-]{1,100}$/
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(400, 'invalid_character', 'Invalid character document')
  return value as Record<string, unknown>
}
function string(value: unknown, max: number): string {
  if (typeof value !== 'string' || value.length > max) fail(400, 'invalid_character', 'Invalid character text')
  return value
}
function identity(input: Record<string, unknown>) {
  const name = string(input.name ?? '', 60).trim()
  const handle = string(input.handle ?? '', 48).trim().replace(/^@/, '').toLowerCase()
  if (handle && !/^[\p{L}\p{N}_-]{1,48}$/u.test(handle)) fail(400, 'invalid_handle', 'Use letters, numbers, underscores or hyphens for the handle')
  return { name, handle }
}
function requireIdentity(document: CharacterDocument) {
  if (!document.name || !document.handle) fail(400, 'incomplete_character', 'Give your character a name and handle first')
}
function photoStage(input: unknown): Pick<PhotoStage, 'photos' | 'notes'> {
  const value = record(input)
  const photosInput = record(value.photos)
  if (Object.keys(photosInput).some((angle) => !ANGLES.includes(angle as Angle)))
    fail(400, 'invalid_character', 'Unknown photo angle')
  const photos: Photos = {}
  for (const angle of ANGLES) {
    if (photosInput[angle] == null) continue
    const photo = record(photosInput[angle])
    const id = photo.assetId ?? photo.id
    if (typeof id !== 'string' || !ASSET_ID.test(id)) fail(400, 'invalid_photo', 'Choose an uploaded image')
    photos[angle] = { assetId: id }
  }
  return { photos, notes: string(value.notes ?? '', 1000) }
}

// Only editable inputs enter the document; approval, sheet and published IDs are server-owned.
export function editCharacterDocument(current: CharacterDocument, input: unknown): CharacterDocument {
  const value = record(input)
  const nextIdentity = identity(value)
  const face = photoStage(value.face)
  const body = photoStage(value.body)
  const faceChanged = JSON.stringify(face) !== JSON.stringify({ photos: current.face.photos, notes: current.face.notes })
  const bodyChanged = JSON.stringify(body) !== JSON.stringify({ photos: current.body.photos, notes: current.body.notes })
  const changed = faceChanged || bodyChanged || nextIdentity.name !== current.name || nextIdentity.handle !== current.handle
  return { ...current, ...nextIdentity,
    face: { ...face, approved: current.face.approved && !faceChanged },
    body: { ...body, approved: current.body.approved && !faceChanged && !bodyChanged },
    revision: current.revision + (changed ? 1 : 0),
    ...(changed ? { sheetAssetId: null, characterVersionId: null, savedAt: null } : {}),
  }
}
export function assertCharacterRevision(row: { storage_revision: number }, expected: unknown) {
  if (!Number.isSafeInteger(expected) || Number(expected) < 0) fail(400, 'invalid_revision', 'A character revision is required')
  if (row.storage_revision !== expected) fail(409, 'revision_conflict', 'This character changed. Reload it before saving.')
}
async function ownedCharacter(db: Db, ownerId: string, id: string): Promise<CharacterRow> {
  if (!CHARACTER_ID.test(id)) fail(404, 'not_found', 'Character not found')
  const [row] = await db<CharacterRow[]>`SELECT * FROM characters WHERE id = ${id} AND owner_id = ${ownerId} AND deleted_at IS NULL`
  if (!row) fail(404, 'not_found', 'Character not found')
  return row
}
async function validatePhotos(db: Db, ownerId: string, document: CharacterDocument) {
  const ids = new Set([...Object.values(document.face.photos), ...Object.values(document.body.photos)].map((photo) => photo.assetId))
  for (const id of ids) {
    const asset = await ownedAsset(db, ownerId, id)
    if (asset.kind !== 'upload') fail(400, 'invalid_photo', 'Choose an uploaded source photo')
  }
}
async function characterDto(db: Db, row: CharacterRow) {
  const doc = row.document
  const hydrateStage = async (stage: PhotoStage) => {
    const photos: Partial<Record<Angle, { id: string; assetId: string; name: string; url: string }>> = {}
    for (const angle of ANGLES) {
      const photo = stage.photos[angle]
      if (!photo) continue
      const asset = await ownedAsset(db, row.owner_id, photo.assetId)
      photos[angle] = { id: asset.id, assetId: asset.id, name: asset.name, url: assetUrl(asset.id) }
    }
    return { ...stage, photos }
  }
  return { ...doc, id: row.id, face: await hydrateStage(doc.face), body: await hydrateStage(doc.body),
    storageRevision: row.storage_revision, createdAt: new Date(row.created_at).getTime(),
    sheetUrl: doc.sheetAssetId ? assetUrl(doc.sheetAssetId) : null }
}
function hash(value: unknown): string {
  const stable = (input: unknown): unknown => Array.isArray(input) ? input.map(stable)
    : input && typeof input === 'object' ? Object.fromEntries(Object.entries(input).sort(([a], [b]) => a.localeCompare(b)).map(([key, val]) => [key, stable(val)])) : input
  return createHash('sha256').update(JSON.stringify(stable(value))).digest('hex')
}
function mutationKey(value: unknown, required = false): string | null {
  if (value === undefined && !required) return null
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{8,120}$/.test(value)) fail(400, 'invalid_mutation_id', 'A unique mutation ID is required')
  return value
}
function uniqueHandleError(error: unknown): never {
  if (error && typeof error === 'object' && 'code' in error && error.code === '23505'
    && 'constraint_name' in error && error.constraint_name === 'characters_owner_handle')
    fail(409, 'handle_in_use', 'This handle is already in use')
  throw error
}
type Mutation = { expectedRevision: unknown; clientMutationId?: unknown }
async function mutateCharacter(ownerId: string, id: string, request: Mutation, payload: unknown,
  work: (tx: postgres.TransactionSql, row: CharacterRow) => Promise<CharacterDocument>) {
  const key = mutationKey(request.clientMutationId)
  const requestHash = hash({ expectedRevision: request.expectedRevision, payload })
  try {
    return await getDb().begin(async (tx) => {
      await lockOwner(tx, ownerId)
      const row = await ownedCharacter(tx, ownerId, id)
      if (key) {
        const [receipt] = await tx`SELECT request_hash, response FROM character_mutations
          WHERE owner_id = ${ownerId} AND character_id = ${id} AND mutation_id = ${key}`
        if (receipt) {
          if (receipt.request_hash !== requestHash) fail(409, 'mutation_id_reused', 'This mutation ID was already used for a different request')
          return receipt.response
        }
      }
      assertCharacterRevision(row, request.expectedRevision)
      const document = await work(tx, row)
      const [updated] = await tx<CharacterRow[]>`UPDATE characters SET document = ${tx.json(document as unknown as postgres.JSONValue)},
        handle = ${document.handle}, storage_revision = storage_revision + 1, updated_at = now()
        WHERE id = ${id} AND owner_id = ${ownerId} RETURNING *`
      const oldSheet = row.document.sheetAssetId
      if (oldSheet && oldSheet !== document.sheetAssetId && !await assetIsUsed(tx, ownerId, oldSheet))
        await tx`UPDATE assets SET deleted_at = now() WHERE id = ${oldSheet} AND owner_id = ${ownerId}`
      const response = await characterDto(tx, updated!)
      if (key) await tx`INSERT INTO character_mutations (character_id, owner_id, mutation_id, request_hash, response)
        VALUES (${id}, ${ownerId}, ${key}, ${requestHash}, ${tx.json(response as unknown as postgres.JSONValue)})`
      return response
    })
  } catch (error) { uniqueHandleError(error) }
}

export async function listCharacters(ownerId: string) {
  const db = getDb()
  const rows = await db<CharacterRow[]>`SELECT * FROM characters WHERE owner_id = ${ownerId} AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 200`
  const result = []
  for (const row of rows) result.push(await characterDto(db, row))
  return result
}
export async function getCharacter(ownerId: string, id: string) {
  return characterDto(getDb(), await ownedCharacter(getDb(), ownerId, id))
}
export async function createCharacter(ownerId: string, input: unknown) {
  const value = record(input)
  const key = mutationKey(value.clientMutationId, true)!
  const requestHash = hash(value)
  const id = value.id === undefined ? `character_${randomUUID()}` : value.id
  if (typeof id !== 'string' || !CHARACTER_ID.test(id)) fail(400, 'invalid_character', 'Invalid character ID')
  const document: CharacterDocument = { ...identity(value), face: { photos: {}, notes: '', approved: false },
    body: { photos: {}, notes: '', approved: false }, revision: 0, sheetAssetId: null, characterVersionId: null, savedAt: null }
  try {
    return await getDb().begin(async (tx) => {
      await lockOwner(tx, ownerId)
      const [receipt] = await tx`SELECT fingerprint, reply FROM mutation_receipts
        WHERE owner_id = ${ownerId} AND scope = 'characters:create' AND client_mutation_id = ${key}`
      if (receipt) {
        if (receipt.fingerprint !== requestHash) fail(409, 'mutation_id_reused', 'This mutation ID was already used for a different request')
        return receipt.reply
      }
      const [existing] = await tx<CharacterRow[]>`SELECT * FROM characters WHERE id = ${id}`
      if (existing) fail(409, 'character_exists', 'This character ID is unavailable')
      const [count] = await tx`SELECT count(*)::int AS count FROM characters WHERE owner_id = ${ownerId} AND deleted_at IS NULL`
      if (Number(count!.count) >= 200) fail(413, 'quota_exceeded', 'Your character limit has been reached')
      const [row] = await tx<CharacterRow[]>`INSERT INTO characters (id, owner_id, handle, document)
        VALUES (${id}, ${ownerId}, ${document.handle}, ${tx.json(document as unknown as postgres.JSONValue)}) RETURNING *`
      const response = await characterDto(tx, row!)
      await tx`INSERT INTO mutation_receipts (owner_id, scope, client_mutation_id, fingerprint, reply)
        VALUES (${ownerId}, 'characters:create', ${key}, ${requestHash}, ${tx.json(response as unknown as postgres.JSONValue)})`
      return response
    })
  } catch (error) { uniqueHandleError(error) }
}
export async function updateCharacter(ownerId: string, id: string, input: unknown) {
  const value = record(input)
  mutationKey(value.clientMutationId, true)
  return mutateCharacter(ownerId, id, { expectedRevision: value.expectedRevision, clientMutationId: value.clientMutationId },
    { operation: 'edit', character: value.character }, async (tx, row) => {
      const document = editCharacterDocument(row.document, value.character)
      await validatePhotos(tx, ownerId, document)
      return document
    })
}
export async function approveCharacter(ownerId: string, id: string, input: unknown) {
  const value = record(input)
  const stage = value.stage
  if (stage !== 'face' && stage !== 'body') fail(400, 'invalid_stage', 'Choose face or body')
  return mutateCharacter(ownerId, id, { expectedRevision: value.expectedRevision, clientMutationId: value.clientMutationId },
    { operation: 'approve', stage }, async (tx, row) => {
      const document = structuredClone(row.document)
      requireIdentity(document)
      await validatePhotos(tx, ownerId, document)
      if (!document[stage].photos.front || (stage === 'body' && !document.face.approved))
        fail(400, 'incomplete_character', 'Add a front photo and approve the face before the body')
      document[stage].approved = true
      return document
    })
}

async function composeSheet(ownerId: string, document: CharacterDocument): Promise<NormalizedImage> {
  const overlays: OverlayOptions[] = []
  for (const [rowIndex, stage] of (['face', 'body'] as const).entries()) {
    for (const [column, angle] of ANGLES.entries()) {
      const photo = document[stage].photos[angle]
      if (!photo) continue
      const asset = await ownedAsset(getDb(), ownerId, photo.assetId)
      const bytes = await getStorage().get(asset.source_key)
      const tile = await sharp(bytes, { limitInputPixels: MAX_IMAGE_PIXELS, failOn: 'error' })
        .resize(496, 496, { fit: 'contain', background: '#ececea' }).webp({ quality: 90 }).toBuffer()
      overlays.push({ input: tile, left: column * 512 + 8, top: rowIndex * 544 + 48 })
    }
  }
  // Static labels only; user text never enters SVG or a remote URL fetch.
  const labels = `<svg width="2048" height="1088" xmlns="http://www.w3.org/2000/svg"><g fill="#30302e" font-family="sans-serif" font-size="22">${['FACE', 'BODY'].flatMap((stage, row) => ANGLES.map((angle, col) => `<text x="${col * 512 + 16}" y="${row * 544 + 32}">${stage} · ${angle.toUpperCase()}</text>`)).join('')}</g></svg>`
  const source = await sharp({ create: { width: 2048, height: 1088, channels: 3, background: '#f7f7f4' } })
    .composite([...overlays, { input: Buffer.from(labels), left: 0, top: 0 }]).webp({ quality: 90 }).toBuffer()
  const preview = await sharp(source).resize(1024).webp({ quality: 82 }).toBuffer()
  return { source, preview, width: 2048, height: 1088 }
}
export async function buildCharacterSheet(ownerId: string, id: string, input: unknown) {
  const value = record(input)
  const request = { expectedRevision: value.expectedRevision, clientMutationId: value.clientMutationId }
  mutationKey(request.clientMutationId)
  // The expensive composition happens outside the transaction. The final mutation checks
  // the same storage revision again before writing any files or adopting its result.
  const snapshot = await ownedCharacter(getDb(), ownerId, id)
  if (snapshot.storage_revision !== value.expectedRevision && value.clientMutationId) {
    // Permit an exact retry after a lost response without composing again.
    return mutateCharacter(ownerId, id, request, { operation: 'sheet' }, async () => {
      fail(409, 'revision_conflict', 'This character changed. Reload it before building a sheet.')
    })
  }
  assertCharacterRevision(snapshot, value.expectedRevision)
  requireIdentity(snapshot.document)
  if (!snapshot.document.face.approved || !snapshot.document.body.approved)
    fail(400, 'incomplete_character', 'Approve the face and body first')
  return withImageSlot(async () => {
    const image = await composeSheet(ownerId, snapshot.document)
    const written: string[] = []
    try {
      return await mutateCharacter(ownerId, id, request, { operation: 'sheet' }, async (tx, row) => {
        if (row.document.revision !== snapshot.document.revision || !row.document.face.approved || !row.document.body.approved)
          fail(409, 'stale_character_revision', 'The photos changed while building the sheet')
        await validatePhotos(tx, ownerId, row.document)
        const asset = await persistImage(tx, ownerId, `${row.document.name} reference sheet`, image, 'sheet', written)
        return { ...row.document, sheetAssetId: asset.id, characterVersionId: null, savedAt: null }
      })
    } catch (error) { await rollbackFiles(ownerId, written); throw error }
  })
}
export async function publishCharacter(ownerId: string, id: string, input: unknown) {
  const value = record(input)
  return mutateCharacter(ownerId, id, { expectedRevision: value.expectedRevision, clientMutationId: value.clientMutationId },
    { operation: 'publish' }, async (tx, row) => {
      const document = structuredClone(row.document)
      requireIdentity(document)
      if (!document.face.approved || !document.body.approved || !document.sheetAssetId)
        fail(400, 'incomplete_character', 'Approve the photos and build a current reference sheet first')
      await validatePhotos(tx, ownerId, document)
      await ownedAsset(tx, ownerId, document.sheetAssetId)
      if (document.characterVersionId && document.savedAt) return document
      const [count] = await tx`SELECT count(*)::int AS count FROM character_versions WHERE owner_id = ${ownerId}`
      if (Number(count!.count) >= 2000) fail(413, 'quota_exceeded', 'Your published character version limit has been reached')
      document.characterVersionId = randomUUID()
      document.savedAt = Date.now()
      await tx`INSERT INTO character_versions (id, character_id, owner_id, sheet_asset_id, document)
        VALUES (${document.characterVersionId}, ${id}, ${ownerId}, ${document.sheetAssetId}, ${tx.json(document as unknown as postgres.JSONValue)})`
      return document
    })
}
export async function deleteCharacter(ownerId: string, id: string, input: unknown) {
  const value = record(input)
  const key = mutationKey(value.clientMutationId, true)!
  const requestHash = hash(value)
  const scope = `characters:${id}:delete`
  return getDb().begin(async (tx) => {
    await lockOwner(tx, ownerId)
    const [receipt] = await tx`SELECT fingerprint, reply FROM mutation_receipts
      WHERE owner_id = ${ownerId} AND scope = ${scope} AND client_mutation_id = ${key}`
    if (receipt) {
      if (receipt.fingerprint !== requestHash) fail(409, 'mutation_id_reused', 'This mutation ID was already used for a different request')
      return receipt.reply
    }
    const row = await ownedCharacter(tx, ownerId, id)
    assertCharacterRevision(row, value.expectedRevision)
    await tx`UPDATE characters SET deleted_at = now(), storage_revision = storage_revision + 1 WHERE id = ${id} AND owner_id = ${ownerId}`
    // Published versions and their sources remain available to existing pinned references.
    if (row.document.sheetAssetId && !await assetIsUsed(tx, ownerId, row.document.sheetAssetId))
      await tx`UPDATE assets SET deleted_at = now() WHERE id = ${row.document.sheetAssetId} AND owner_id = ${ownerId}`
    const response = { deleted: true }
    await tx`INSERT INTO mutation_receipts (owner_id, scope, client_mutation_id, fingerprint, reply)
      VALUES (${ownerId}, ${scope}, ${key}, ${requestHash}, ${tx.json(response)})`
    return response
  })
}
