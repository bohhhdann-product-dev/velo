import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import { mkdtemp, readFile, rm, utimes } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import postgres from 'postgres'
import sharp from 'sharp'
import { createApp, createRouter, toNodeListener } from 'h3'
import uploadHandler from '../../server/api/assets/index.post'
import fileHandler from '../../server/api/assets/[id]/file.get'
import { getDb, closeDb } from '../../server/utils/db'
import { uploadImage, listAssets, ownedAsset, deleteAsset, cleanupMedia, setAssetFavorite, MAX_UPLOAD_BYTES,
  lockOwner, persistImage, normalizeImage, rollbackFiles, retireUnusedVersions, assetUrl } from '../../server/services/media'
import { createCharacter, getCharacter, updateCharacter, approveCharacter, buildCharacterSheet, publishCharacter, deleteCharacter } from '../../server/services/characters'
import { validateProjectReferences, hydrateProjectReferences } from '../../server/services/project-media'
import { getStorage } from '../../server/services/storage'
import { deleteProject } from '../../server/services/projects'

const databaseUrl = process.env.VELA_TEST_DATABASE_URL
test('private media and character lifecycle against PostgreSQL', {
  skip: !databaseUrl && 'Set VELA_TEST_DATABASE_URL to a local PostgreSQL database',
}, async (t) => {
  const url = new URL(databaseUrl!)
  assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname), 'Refusing a remote test database')
  const schema = `vela_media_test_${randomUUID().replaceAll('-', '')}`
  const admin = postgres(url.toString(), { onnotice: () => {} })
  const directory = await mkdtemp(join(tmpdir(), 'vela-media-integration-'))
  const originalEnv = { ...process.env }
  const app = createApp()
  const router = createRouter().post('/api/assets', uploadHandler).get('/api/assets/:id/file', fileHandler)
  app.use(router)
  const server = createServer(toNodeListener(app))
  try {
    await admin`CREATE SCHEMA ${admin(schema)}`
    url.searchParams.set('search_path', schema)
    process.env.DATABASE_URL = url.toString()
    process.env.VELA_STORAGE_DRIVER = 'local'
    process.env.VELA_STORAGE_DIR = directory
    process.env.VELA_AUTH_MODE = 'local'
    process.env.VELA_LOCAL_AUTH_TOKEN = 'local-media-test-token-1234567890'
    process.env.VELA_LOCAL_USER_ID = 'alice'
    process.env.NODE_ENV = 'test'
    const db = getDb()
    for (const file of ['001_foundation.sql', '002_media.sql', '003_project_tombstones.sql', '004_review_hardening.sql', '005_generation_jobs.sql']) {
      await db.unsafe(await readFile(new URL(`../../server/db/migrations/${file}`, import.meta.url), 'utf8'))
    }
    await db`INSERT INTO app_users (id) VALUES ('alice'), ('bob')`
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address() as { port: number }
    const origin = `http://127.0.0.1:${address.port}`
    process.env.VELA_ALLOWED_ORIGINS = origin
    // Deliberately aborted oversize streams must not contaminate later delivery assertions through the client socket pool.
    const auth = { authorization: `Bearer ${process.env.VELA_LOCAL_AUTH_TOKEN}`, connection: 'close' }
    const bytes = await sharp({ create: { width: 128, height: 96, channels: 3, background: '#a34534' } }).png().toBuffer()
    let first: Awaited<ReturnType<typeof uploadImage>>
    await t.test('authenticated multipart upload returns only private application URLs', async () => {
      const anonymous = await fetch(`${origin}/api/assets`, { method: 'POST', headers: { origin } })
      assert.equal(anonymous.status, 401)
      const body = new FormData()
      body.set('file', new Blob([bytes], { type: 'image/png' }), 'portrait.png')
      body.set('clientMutationId', randomUUID())
      const response = await fetch(`${origin}/api/assets`, { method: 'POST', headers: auth, body })
      assert.equal(response.status, 201)
      first = (await response.json()).asset
      assert.match(first.url, /^\/api\/assets\/[^/]+\/file\?variant=preview$/)
      assert.equal('source_key' in first, false)
      const retries = await Promise.all([1, 2].map(async () => {
        const retried = await fetch(`${origin}/api/assets`, { method: 'POST', headers: auth, body })
        assert.equal(retried.status, 201)
        return (await retried.json()).asset
      }))
      assert.deepEqual(retries, [first, first], 'Concurrent lost-response retries must not create duplicate stored assets')
      const changedUpload = new FormData()
      changedUpload.set('file', new Blob([bytes], { type: 'image/png' }), 'different-name.png')
      changedUpload.set('clientMutationId', body.get('clientMutationId')!)
      const reused = await fetch(`${origin}/api/assets`, { method: 'POST', headers: auth, body: changedUpload })
      assert.equal(reused.status, 409)
      assert.equal((await reused.json()).data.code, 'mutation_id_reused')
      changedUpload.delete('clientMutationId')
      assert.equal((await fetch(`${origin}/api/assets`, { method: 'POST', headers: auth, body: changedUpload })).status, 400)
      const download = await fetch(origin + first.url, { headers: auth })
      assert.equal(download.status, 200)
      assert.equal(download.headers.get('cache-control'), 'private, no-store')
      assert.equal(download.headers.get('content-type'), 'image/webp')
      assert.equal((await sharp(Buffer.from(await download.arrayBuffer())).metadata()).format, 'webp')
      assert.equal((await fetch(origin + first.url)).status, 401)
      process.env.VELA_LOCAL_USER_ID = 'bob'
      assert.equal((await fetch(origin + first.url, { headers: auth })).status, 404)
      process.env.VELA_LOCAL_USER_ID = 'alice'
      const bad = new FormData()
      bad.set('file', new Blob(['<html>not a photo</html>'], { type: 'image/png' }), 'bad.png')
      bad.set('clientMutationId', randomUUID())
      assert.equal((await fetch(`${origin}/api/assets`, { method: 'POST', headers: auth, body: bad })).status, 415)
      const oversized = new FormData()
      oversized.set('file', new Blob([Buffer.alloc(MAX_UPLOAD_BYTES + 1)], { type: 'image/png' }), 'too-large.png')
      oversized.set('clientMutationId', randomUUID())
      assert.equal((await fetch(`${origin}/api/assets`, { method: 'POST', headers: auth, body: oversized })).status, 413)
      // No Content-Length: the body must also be capped while streaming.
      async function* chunks() {
        for (let index = 0; index < 14; index++) yield Buffer.alloc(1024 * 1024)
      }
      const streamed = await fetch(`${origin}/api/assets`, { method: 'POST',
        headers: { ...auth, 'content-type': 'multipart/form-data; boundary=test' },
        body: chunks() as unknown as BodyInit, duplex: 'half',
      } as RequestInit)
      assert.equal(streamed.status, 413)
      assert.equal((await listAssets('alice')).length, 1)
      assert.equal((await listAssets('bob')).length, 0)
      await assert.rejects(deleteAsset('bob', first.id), { statusCode: 404 })
      await assert.rejects(setAssetFavorite('bob', first.id, true), { statusCode: 404 })
    })
    const other = await uploadImage('bob', bytes, 'image/png', 'other.png')
    const unused = await uploadImage('alice', bytes, 'image/png', 'unused.png')
    const createRequest = { name: 'Mira', handle: 'mira', clientMutationId: randomUUID() }
    let character: any = await createCharacter('alice', createRequest)
    await t.test('create receipt returns the same character after a lost success response', async () => {
      assert.deepEqual(await createCharacter('alice', createRequest), character)
      const [count] = await db`SELECT count(*)::int AS count FROM characters WHERE owner_id = 'alice'`
      assert.equal(count!.count, 1)
      await assert.rejects(createCharacter('alice', { ...createRequest, name: 'Changed' }), { statusCode: 409 })
      await assert.rejects(createCharacter('alice', { name: 'No receipt' }), { statusCode: 400 })
      // Receipt identity is owner scoped, even when a mutation ID is copied.
      const bob: any = await createCharacter('bob', createRequest)
      assert.notEqual(bob.id, character.id)
    })
    const edit = (photoId = first.id) => ({ name: 'Mira', handle: 'mira',
      face: { photos: { front: { assetId: photoId } }, notes: '', approved: true },
      body: { photos: { front: { assetId: first.id } }, notes: '', approved: true },
      sheetAssetId: other.id, savedAt: Date.now(), characterVersionId: randomUUID() })
    await t.test('foreign photos and browser-owned approval/sheet fields cannot enter a draft', async () => {
      await assert.rejects(getCharacter('bob', character.id), { statusCode: 404 })
      await assert.rejects(updateCharacter('alice', character.id, {
        character: edit(other.id), expectedRevision: character.storageRevision, clientMutationId: randomUUID(),
      }), { statusCode: 404 })
      const request = { character: edit(), expectedRevision: character.storageRevision, clientMutationId: randomUUID() }
      character = await updateCharacter('alice', character.id, request)
      assert.equal(character.face.approved, false)
      assert.equal(character.body.approved, false)
      assert.equal(character.sheetAssetId, null)
      assert.equal(character.characterVersionId, null)
      assert.deepEqual(await updateCharacter('alice', character.id, request), character)
      await assert.rejects(updateCharacter('alice', character.id, { ...request, character: { ...request.character, name: 'Different' } }), { statusCode: 409 })
      await assert.rejects(deleteAsset('alice', first.id), { statusCode: 409 })
      await assert.rejects(publishCharacter('alice', character.id, { expectedRevision: character.storageRevision }), { statusCode: 400 })
      await assert.rejects(approveCharacter('alice', character.id, { stage: 'body', expectedRevision: character.storageRevision }), { statusCode: 400 })
      character = await approveCharacter('alice', character.id, { stage: 'face', expectedRevision: character.storageRevision })
      character = await approveCharacter('alice', character.id, { stage: 'body', expectedRevision: character.storageRevision })
    })
    await t.test('a photo edit during asynchronous composition prevents adopting a stale sheet', async () => {
      const storage = getStorage()
      const originalGet = storage.get
      let started!: () => void
      let release!: () => void
      const began = new Promise<void>((resolve) => { started = resolve })
      const gate = new Promise<void>((resolve) => { release = resolve })
      storage.get = async (key) => { started(); await gate; return originalGet(key) }
      const pending = buildCharacterSheet('alice', character.id, { expectedRevision: character.storageRevision })
      await began
      try {
        const changed = edit()
        changed.face.notes = 'A changed description'
        character = await updateCharacter('alice', character.id, {
          character: changed, expectedRevision: character.storageRevision, clientMutationId: randomUUID(),
        })
        release()
        await assert.rejects(pending, { statusCode: 409 })
        assert.equal(character.face.approved, false)
        assert.equal(character.body.approved, false)
        assert.equal(character.sheetAssetId, null)
        const [count] = await db`SELECT count(*)::int AS count FROM assets WHERE kind = 'sheet'`
        assert.equal(count!.count, 0)
      } finally { release(); storage.get = originalGet }
    })
    let pin: any
    await t.test('published sheets use real photos and references pin an immutable owned version', async () => {
      character = await approveCharacter('alice', character.id, { stage: 'face', expectedRevision: character.storageRevision })
      character = await approveCharacter('alice', character.id, { stage: 'body', expectedRevision: character.storageRevision })
      const sheetRequest = { expectedRevision: character.storageRevision, clientMutationId: randomUUID() }
      character = await buildCharacterSheet('alice', character.id, sheetRequest)
      assert.deepEqual(await buildCharacterSheet('alice', character.id, sheetRequest), character)
      const asset = await ownedAsset(db, 'alice', character.sheetAssetId)
      for (const [variant, width, height] of [['source', 2048, 1088], ['preview', 1024, 544]] as const) {
        const response = await fetch(origin + assetUrl(asset.id, variant), { headers: auth })
        assert.equal(response.status, 200)
        const metadata = await sharp(Buffer.from(await response.arrayBuffer())).metadata()
        assert.equal(metadata.width, width)
        assert.equal(metadata.height, height)
      }
      process.env.VELA_LOCAL_USER_ID = 'bob'
      assert.equal((await fetch(origin + assetUrl(asset.id, 'source'), { headers: auth })).status, 404)
      process.env.VELA_LOCAL_USER_ID = 'alice'
      const pixels = await sharp(await getStorage().get(asset.source_key)).extract({ left: 100, top: 200, width: 1, height: 1 }).raw().toBuffer()
      assert.ok(pixels[0]! > pixels[1]! * 1.5, 'Sheet contains the supplied red source photo')
      character = await publishCharacter('alice', character.id, { expectedRevision: character.storageRevision })
      const versionId = character.characterVersionId
      pin = { id: 'reference_1', type: 'reference', assetId: character.sheetAssetId,
        assetKind: 'character', characterVersionId: versionId, x: 0, y: 0, name: 'Mira', handle: 'mira' }
      await db.begin((tx) => validateProjectReferences(tx, 'alice', [pin]))
      await assert.rejects(db.begin((tx) => validateProjectReferences(tx, 'bob', [pin])), { statusCode: 404 })
      await assert.rejects(db.begin((tx) => validateProjectReferences(tx, 'alice', [{ ...pin, assetId: first.id }])), { statusCode: 404 })
      await assert.rejects(db.begin((tx) => validateProjectReferences(tx, 'alice', [{ ...pin, characterVersionId: undefined }])), { statusCode: 400 })
      await db`INSERT INTO projects (id, owner_id, title, board, viewport) VALUES ('pinned', 'alice', 'Pinned',
        ${db.json({ schemaVersion: 1, nodes: [pin], edges: [] })}, ${db.json({ x: 0, y: 0, scale: 1 })})`
      character = await updateCharacter('alice', character.id, {
        character: edit(unused.id), expectedRevision: character.storageRevision, clientMutationId: randomUUID(),
      })
      assert.equal(character.sheetAssetId, null)
      assert.equal(character.characterVersionId, null)
      const [version] = await db`SELECT * FROM character_versions WHERE id = ${versionId}`
      assert.equal(version!.sheet_asset_id, pin.assetId)
      assert.equal(version!.document.face.photos.front.assetId, first.id)
      assert.equal((await hydrateProjectReferences('alice', [pin]))[0]!.assetId, pin.assetId)
      await assert.rejects(deleteAsset('alice', first.id), { statusCode: 409 })
      await assert.rejects(deleteAsset('alice', pin.assetId), { statusCode: 409 })
      const deleteRequest = { expectedRevision: character.storageRevision, clientMutationId: randomUUID() }
      const deleted = await deleteCharacter('alice', character.id, deleteRequest)
      assert.deepEqual(await deleteCharacter('alice', character.id, deleteRequest), deleted)
      await assert.rejects(deleteCharacter('alice', character.id, { ...deleteRequest, expectedRevision: 0 }), { statusCode: 409 })
      await assert.rejects(deleteCharacter('bob', character.id, deleteRequest), { statusCode: 404 })
      await assert.rejects(getCharacter('alice', character.id), { statusCode: 404 })
      await db.begin((tx) => validateProjectReferences(tx, 'alice', [pin]))
    })
    await t.test('soft deletion denies reads, preserves old receipts, and cleanup protects pinned files', async () => {
      const oldReference = { type: 'reference', assetKind: 'image', assetId: unused.id }
      await deleteAsset('alice', unused.id)
      await deleteAsset('alice', unused.id) // A lost successful delete can be retried.
      await assert.rejects(deleteAsset('bob', unused.id), { statusCode: 404 })
      await assert.rejects(ownedAsset(db, 'alice', unused.id), { statusCode: 404 })
      assert.equal((await hydrateProjectReferences('alice', [oldReference])).length, 1)
      await db`UPDATE assets SET deleted_at = now() - interval '8 days' WHERE id = ${unused.id}`
      const orphanKey = `media/${randomUUID()}/source.webp`
      await getStorage().put(orphanKey, bytes)
      await utimes(join(directory, orphanKey), new Date(Date.now() - 48 * 3600_000), new Date(Date.now() - 48 * 3600_000))
      const dryRun = await cleanupMedia()
      assert.ok(dryRun.deletedAssets.includes(unused.id))
      assert.ok(dryRun.orphanKeys.includes(orphanKey))
      assert.ok((await getStorage().get(orphanKey)).length)
      await cleanupMedia({ dryRun: false })
      await assert.rejects(getStorage().get(orphanKey), { code: 'ENOENT' })
      const sheet = await ownedAsset(db, 'alice', pin.assetId)
      assert.ok((await getStorage().get(sheet.source_key)).length)
      const [purged] = await db`SELECT purged_at FROM assets WHERE id = ${unused.id}`
      assert.ok(purged!.purged_at)
    })
    await t.test('multi-angle no-op saves survive JSONB ordering and only real edits invalidate approvals', async () => {
      const source = await uploadImage('alice', bytes, 'image/png', 'multi-angle.png')
      let multi: any = await createCharacter('alice', { name: 'Multi', handle: 'multi', clientMutationId: randomUUID() })
      const editable = { name: 'Multi', handle: 'multi',
        face: { photos: { front: { assetId: source.id }, left: { assetId: first.id } }, notes: '' },
        body: { photos: { front: { assetId: source.id }, left: { assetId: first.id } }, notes: '' } }
      const save = async () => multi = await updateCharacter('alice', multi.id, {
        character: editable, expectedRevision: multi.storageRevision, clientMutationId: randomUUID(),
      })
      const approve = async () => {
        for (const stage of ['face', 'body']) multi = await approveCharacter('alice', multi.id, { stage, expectedRevision: multi.storageRevision })
        multi = await buildCharacterSheet('alice', multi.id, { expectedRevision: multi.storageRevision })
        multi = await publishCharacter('alice', multi.id, { expectedRevision: multi.storageRevision })
      }
      await save()
      await approve()
      const published = structuredClone(multi)
      const [stored] = await db`SELECT document FROM characters WHERE id = ${multi.id}`
      assert.deepEqual(Object.keys(stored!.document.face.photos), ['left', 'front'], 'Fixture must exercise PostgreSQL key reordering')
      await save()
      for (const field of ['revision', 'sheetAssetId', 'characterVersionId', 'savedAt']) assert.equal(multi[field], published[field])
      assert.equal(multi.storageRevision, published.storageRevision + 1)
      assert.equal(multi.face.approved, true)
      assert.equal(multi.body.approved, true)

      editable.body.notes = 'New body detail'
      await save()
      assert.equal(multi.face.approved, true)
      assert.equal(multi.body.approved, false)
      assert.equal(multi.revision, published.revision + 1)
      assert.equal(multi.sheetAssetId, null)
      const [retired] = await db`SELECT retired_at FROM character_versions WHERE id = ${published.characterVersionId}`
      assert.ok(retired!.retired_at, 'Replacing the last current reference retires the unused version')
      editable.face.notes = 'New face detail'
      await save()
      assert.equal(multi.face.approved, false)
      assert.equal(multi.body.approved, false)
      await approve()

      // Legacy unused versions can share a sheet with a current published revision.
      // Maintenance is bounded and must not remove that still-current sheet.
      const legacyIds = [randomUUID(), randomUUID(), randomUUID()]
      for (const id of legacyIds) await db`INSERT INTO character_versions(id, character_id, owner_id, sheet_asset_id, document)
        SELECT ${id}, character_id, owner_id, sheet_asset_id, document FROM character_versions WHERE id = ${multi.characterVersionId}`
      const activeLegacy = async () => {
        const [count] = await db`SELECT count(*)::int AS count FROM character_versions WHERE id IN ${db(legacyIds)} AND retired_at IS NULL`
        return count!.count
      }
      const dry = await cleanupMedia({ limit: 1 })
      assert.equal(dry.retiredVersions.length, 1)
      assert.equal(await activeLegacy(), 3, 'Dry-run must leave version rows unchanged')
      const applied = await cleanupMedia({ dryRun: false, limit: 1 })
      assert.equal(applied.retiredVersions.length, 1)
      assert.equal(await activeLegacy(), 2, 'Version retirement respects the maintenance batch bound')
      await db.begin(async (tx) => { await lockOwner(tx, 'alice'); await retireUnusedVersions(tx, 'alice') })
      assert.equal(await activeLegacy(), 0)
      assert.ok(await ownedAsset(db, 'alice', multi.sheetAssetId), 'A shared current sheet survives unused version retirement')
      const [current] = await db`SELECT retired_at FROM character_versions WHERE id = ${multi.characterVersionId}`
      assert.equal(current!.retired_at, null)
      await assert.rejects(db.begin((tx) => validateProjectReferences(tx, 'alice', [{
        type: 'reference', assetKind: 'character', assetId: multi.sheetAssetId, characterVersionId: legacyIds[0],
      }])), { statusCode: 404 }, 'A retired version cannot be pinned even when its shared sheet is still live')
      await assert.rejects(deleteAsset('alice', source.id), { statusCode: 409 })
      await deleteCharacter('alice', multi.id, { expectedRevision: multi.storageRevision, clientMutationId: randomUUID() })
      await assert.rejects(ownedAsset(db, 'alice', multi.sheetAssetId), { statusCode: 404 })
      await deleteAsset('alice', source.id)
      await assert.rejects(ownedAsset(db, 'alice', source.id), { statusCode: 404 }, 'Deleting an unpinned published character releases its source photos')
    })
    await t.test('deleting the last project pin retires its version and releases its source photos', async () => {
      await deleteProject('alice', 'pinned', { expectedRevision: 1, clientMutationId: randomUUID() })
      const [version] = await db`SELECT retired_at FROM character_versions WHERE id = ${pin.characterVersionId}`
      assert.ok(version!.retired_at)
      await assert.rejects(db.begin((tx) => validateProjectReferences(tx, 'alice', [pin])), { statusCode: 404 })
      await deleteAsset('alice', first.id)
      await assert.rejects(ownedAsset(db, 'alice', first.id), { statusCode: 404 })
    })
    await t.test('failed storage writes leave no upload receipt or partial asset and allow a safe retry', async () => {
      const storage = getStorage()
      const originalPut = storage.put
      const key = randomUUID()
      const written: string[] = []
      storage.put = async (objectKey, contents) => {
        written.push(objectKey)
        if (objectKey.endsWith('/preview.webp')) throw new Error('Synthetic storage failure')
        return originalPut(objectKey, contents)
      }
      try {
        await assert.rejects(uploadImage('alice', bytes, 'image/png', 'retry-after-storage-failure', key), /Synthetic storage failure/)
      } finally { storage.put = originalPut }
      const [receipt] = await db`SELECT 1 FROM mutation_receipts WHERE owner_id = 'alice' AND scope = 'assets:upload' AND client_mutation_id = ${key}`
      assert.equal(receipt, undefined)
      for (const objectKey of written) {
        await assert.rejects(storage.get(objectKey), { code: 'ENOENT' })
        const [asset] = await db`SELECT 1 FROM assets WHERE source_key = ${objectKey} OR preview_key = ${objectKey}`
        assert.equal(asset, undefined)
      }
      const uploaded = await uploadImage('alice', bytes, 'image/png', 'retry-after-storage-failure', key)
      assert.deepEqual(await uploadImage('alice', bytes, 'image/png', 'retry-after-storage-failure', key), uploaded)
      const otherOwner = await uploadImage('bob', bytes, 'image/png', 'retry-after-storage-failure', key)
      assert.notEqual(otherOwner.id, uploaded.id, 'Upload receipts must belong to the verified owner')
    })
    await t.test('rollback cleanup waits for uncertain transactions and preserves successful commits', async () => {
      const image = await normalizeImage(bytes, 'image/png')
      const written: string[] = []
      let ready!: () => void
      let release!: () => void
      const inserted = new Promise<void>((resolve) => { ready = resolve })
      const gate = new Promise<void>((resolve) => { release = resolve })
      const transaction = db.begin(async (tx) => {
        await lockOwner(tx, 'alice')
        const asset = await persistImage(tx, 'alice', 'uncertain-commit.png', image, 'upload', written)
        ready()
        await gate
        return asset.id
      })
      await inserted
      let cleanupFinished = false
      const cleanup = rollbackFiles('alice', written).then(() => { cleanupFinished = true })
      try {
        await new Promise((resolve) => setTimeout(resolve, 30))
        assert.equal(cleanupFinished, false, 'Cleanup must wait until the original transaction resolves')
        assert.ok((await getStorage().get(written[0]!)).length)
      } finally { release() }
      const id = await transaction
      await cleanup
      const committed = await ownedAsset(db, 'alice', id)
      assert.ok((await getStorage().get(committed.source_key)).length)
      assert.ok((await getStorage().get(committed.preview_key!)).length)

      const rolledBack: string[] = []
      await assert.rejects(db.begin(async (tx) => {
        await lockOwner(tx, 'alice')
        await persistImage(tx, 'alice', 'rolled-back.png', image, 'upload', rolledBack)
        throw new Error('Forced rollback')
      }), /Forced rollback/)
      await rollbackFiles('alice', rolledBack)
      for (const key of rolledBack) await assert.rejects(getStorage().get(key), { code: 'ENOENT' })
    })
    await t.test('quota checks serialize concurrent uploads without exceeding the configured limit', async () => {
      const [usage] = await db`SELECT count(*)::int AS count FROM assets WHERE owner_id = 'alice' AND deleted_at IS NULL`
      process.env.VELA_MAX_ASSETS = String(usage!.count + 1)
      const results = await Promise.allSettled([
        uploadImage('alice', bytes, 'image/png', 'quota-a.png'),
        uploadImage('alice', bytes, 'image/png', 'quota-b.png'),
      ])
      assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1)
      const failed = results.find((result) => result.status === 'rejected') as PromiseRejectedResult
      assert.equal(failed.reason.data.code, 'quota_exceeded')
    })
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
    await closeDb()
    await admin`DROP SCHEMA IF EXISTS ${admin(schema)} CASCADE`
    await admin.end()
    await rm(directory, { recursive: true, force: true })
    for (const key of Object.keys(process.env)) if (!(key in originalEnv)) delete process.env[key]
    Object.assign(process.env, originalEnv)
  }
})
