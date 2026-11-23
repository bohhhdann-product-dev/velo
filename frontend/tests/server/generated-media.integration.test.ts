import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import postgres from 'postgres'
import sharp from 'sharp'
import { createApp, createRouter, toNodeListener } from 'h3'
import fileHandler from '../../server/api/assets/[id]/file.get'
import { migrate } from '../../scripts/migrate.mjs'
import { getDb, closeDb } from '../../server/utils/db'
import { prepareGeneratedMedia, persistGeneratedMedia, generatedMediaReservation } from '../../server/services/generated-media'
import { assetDto, ownedAsset, assetIsUsed, deleteAsset, lockOwner, uploadImage, normalizeImage, retireUnusedVersions, cleanupMedia } from '../../server/services/media'
import { createCharacter, updateCharacter, approveCharacter, buildCharacterSheet, publishCharacter, deleteCharacter } from '../../server/services/characters'
import { getStorage } from '../../server/services/storage'
import { createModelArkMediaFixture } from '../fixtures/modelark-media'

const databaseUrl = process.env.VELA_TEST_DATABASE_URL
test('generated originals persist privately with correct MIME, ranges, job dependency protection and quotas', {
  skip: !databaseUrl && 'Set VELA_TEST_DATABASE_URL to a loopback PostgreSQL database',
}, async (t) => {
  const url = new URL(databaseUrl!)
  assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname))
  const schema = `vela_generated_media_test_${randomUUID().replaceAll('-', '')}`
  const admin = postgres(url.toString(), { onnotice: () => {} })
  const directory = await mkdtemp(join(tmpdir(), 'vela-generated-media-'))
  const env = { ...process.env }
  const app = createApp().use(createRouter().get('/api/assets/:id/file', fileHandler))
  const server = createServer(toNodeListener(app))
  try {
    await admin`CREATE SCHEMA ${admin(schema)}`
    url.searchParams.set('search_path', schema)
    process.env.DATABASE_URL = url.toString()
    process.env.VELA_STORAGE_DRIVER = 'local'
    process.env.VELA_STORAGE_DIR = directory
    process.env.VELA_AUTH_MODE = 'local'
    process.env.VELA_LOCAL_AUTH_TOKEN = 'local-generated-media-test-token-1234567890'
    process.env.VELA_LOCAL_USER_ID = 'alice'
    process.env.NODE_ENV = 'test'
    await migrate(process.env.DATABASE_URL)
    const db = getDb()
    await db`INSERT INTO app_users(id) VALUES ('alice'), ('bob')`
    await db`INSERT INTO projects(id, owner_id, title, board, viewport) VALUES
      ('original', 'alice', 'Original', ${db.json({ schemaVersion: 1, nodes: [], edges: [] })}, ${db.json({ x: 0, y: 0, scale: 1 })}),
      ('copy', 'alice', 'Copied result', ${db.json({ schemaVersion: 1, nodes: [], edges: [] })}, ${db.json({ x: 0, y: 0, scale: 1 })})`
    const jpeg = await sharp({ create: { width: 80, height: 60, channels: 3, background: '#a82a3a' } }).jpeg().withMetadata().toBuffer()
    const png = await sharp(jpeg).png().toBuffer()
    const mp4 = await readFile(new URL('../../public/demo/flower.mp4', import.meta.url))
    const provider = await createModelArkMediaFixture(t, { '/image.jpg': jpeg, '/video.mp4': mp4, '/poster.png': png })
    const image = await prepareGeneratedMedia({ mode: 'image', url: provider.url('/image.jpg') })
    const video = await prepareGeneratedMedia({ mode: 'video', url: provider.url('/video.mp4'), posterUrl: provider.url('/poster.png') })
    const noPoster = await prepareGeneratedMedia({ mode: 'video', url: provider.url('/video.mp4') })
    const written: string[] = []
    const persist = (name: string, media: typeof image) => db.begin(async (tx) => {
      await lockOwner(tx, 'alice')
      return persistGeneratedMedia(tx, 'alice', name, media, written)
    })
    const imageAsset = await persist('Generated image', image)
    const videoAsset = await persist('Generated video', video)
    const bareVideo = await persist('Video without poster', noPoster)
    assert.deepEqual(await getStorage().get(imageAsset.source_key), jpeg)
    assert.deepEqual(await getStorage().get(videoAsset.source_key), mp4)
    assert.deepEqual(await getStorage().get(videoAsset.preview_key!), png)
    assert.equal(assetDto(bareVideo).posterUrl, null)
    assert.equal(assetDto(videoAsset).mediaType, 'video')
    assert.match(assetDto(videoAsset).url, /variant=source$/)

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`
    process.env.VELA_ALLOWED_ORIGINS = base
    const headers = { authorization: `Bearer ${process.env.VELA_LOCAL_AUTH_TOKEN}`, connection: 'close' }
    const get = (assetId: string, variant: 'source' | 'preview', range?: string) => fetch(`${base}/api/assets/${assetId}/file?variant=${variant}`,
      { headers: { ...headers, ...(range ? { range } : {}) } })
    await t.test('HTTP delivery preserves originals and serves exact authenticated byte ranges', async () => {
      const original = await get(imageAsset.id, 'source')
      assert.equal(original.headers.get('content-type'), 'image/jpeg')
      assert.deepEqual(Buffer.from(await original.arrayBuffer()), jpeg)
      const preview = await get(imageAsset.id, 'preview')
      assert.equal(preview.headers.get('content-type'), 'image/webp')
      assert.equal((await sharp(Buffer.from(await preview.arrayBuffer())).metadata()).format, 'webp')
      const poster = await get(videoAsset.id, 'preview')
      assert.equal(poster.headers.get('content-type'), 'image/png')
      assert.deepEqual(Buffer.from(await poster.arrayBuffer()), png)
      for (const [range, start, end] of [['bytes=0-7', 0, 7], ['bytes=-12', mp4.length - 12, mp4.length - 1],
        [`bytes=${mp4.length - 5}-`, mp4.length - 5, mp4.length - 1]] as const) {
        const response = await get(videoAsset.id, 'source', range)
        assert.equal(response.status, 206)
        assert.equal(response.headers.get('content-type'), 'video/mp4')
        assert.equal(response.headers.get('accept-ranges'), 'bytes')
        assert.equal(response.headers.get('content-range'), `bytes ${start}-${end}/${mp4.length}`)
        assert.equal(response.headers.get('content-length'), String(end - start + 1))
        assert.deepEqual(Buffer.from(await response.arrayBuffer()), mp4.subarray(start, end + 1))
      }
      const full = await get(videoAsset.id, 'source')
      assert.equal(full.status, 200)
      assert.deepEqual(Buffer.from(await full.arrayBuffer()), mp4)
      for (const range of [`bytes=${mp4.length}-`, 'bytes=0-1,4-5', 'bytes=-0']) {
        const response = await get(videoAsset.id, 'source', range)
        assert.equal(response.status, 416)
        assert.equal(response.headers.get('content-range'), `bytes */${mp4.length}`)
        await response.arrayBuffer()
      }
      assert.equal((await get(bareVideo.id, 'preview')).status, 404)
      assert.equal((await fetch(`${base}${assetDto(videoAsset).url}`, { headers: { connection: 'close' } })).status, 401)
      process.env.VELA_LOCAL_USER_ID = 'bob'
      assert.equal((await get(videoAsset.id, 'source', 'bytes=0-7')).status, 404)
      process.env.VELA_LOCAL_USER_ID = 'alice'
    })

    await t.test('live generation outputs and copied take nodes both prevent premature media deletion', async () => {
      const generationId = randomUUID(), takeId = randomUUID()
      await db`INSERT INTO generations(id, owner_id, project_id, generator_id, draft, manifest)
        VALUES (${generationId}, 'alice', 'original', 'generator', ${db.json({ mode: 'video' })}, ${db.json({ references: [] })})`
      await db`INSERT INTO generation_takes(id, generation_id, status, output_asset_id)
        VALUES (${takeId}, ${generationId}, 'done', ${videoAsset.id})`
      await assert.rejects(deleteAsset('alice', videoAsset.id), { statusCode: 409 })
      const node = { id: 'copied', type: 'take', takeId, generationId, x: 0, y: 0 }
      await db`UPDATE projects SET board = ${db.json({ schemaVersion: 1, nodes: [node], edges: [] })} WHERE id = 'copy'`
      await db`UPDATE generations SET deleted_at = now() WHERE id = ${generationId}`
      await assert.rejects(deleteAsset('alice', videoAsset.id), { statusCode: 409 })
      await db`UPDATE projects SET board = ${db.json({ schemaVersion: 1, nodes: [], edges: [] })} WHERE id = 'copy'`
      await deleteAsset('alice', videoAsset.id)
      await assert.rejects(ownedAsset(db, 'alice', videoAsset.id), { statusCode: 404 })
      await db`UPDATE assets SET deleted_at = now() - interval '8 days' WHERE id = ${videoAsset.id}`
      await cleanupMedia({ dryRun: false })
      await assert.rejects(getStorage().get(videoAsset.source_key), { code: 'ENOENT' })
      await assert.rejects(getStorage().get(videoAsset.preview_key!), { code: 'ENOENT' })
    })

    await t.test('active and unknown jobs retain immutable character inputs even after both owners of the references are deleted', async () => {
      const source = await uploadImage('alice', png, 'image/png', 'Character source')
      let character: any = await createCharacter('alice', { name: 'Input', handle: 'input', clientMutationId: randomUUID() })
      character = await updateCharacter('alice', character.id, { expectedRevision: character.storageRevision, clientMutationId: randomUUID(), character: {
        name: 'Input', handle: 'input', face: { photos: { front: { assetId: source.id } }, notes: '' },
        body: { photos: { front: { assetId: source.id } }, notes: '' },
      } })
      for (const stage of ['face', 'body']) character = await approveCharacter('alice', character.id, { stage, expectedRevision: character.storageRevision })
      character = await buildCharacterSheet('alice', character.id, { expectedRevision: character.storageRevision })
      character = await publishCharacter('alice', character.id, { expectedRevision: character.storageRevision })
      const generationId = randomUUID(), takeId = randomUUID()
      await db`INSERT INTO generations(id, owner_id, project_id, generator_id, draft, manifest)
        VALUES (${generationId}, 'alice', 'original', 'generator', ${db.json({ mode: 'video' })}, ${db.json({ references: [
          { nodeId: 'input', assetId: character.sheetAssetId, characterVersionId: character.characterVersionId, role: 'reference_image' },
          { nodeId: 'photo', assetId: source.id, role: 'reference_image' },
        ] })})`
      await db`INSERT INTO generation_takes(id, generation_id, status) VALUES (${takeId}, ${generationId}, 'queued')`
      await deleteCharacter('alice', character.id, { expectedRevision: character.storageRevision, clientMutationId: randomUUID() })
      await db`UPDATE generations SET deleted_at = now() WHERE id = ${generationId}`
      for (const status of ['queued', 'preparing', 'submitting', 'running', 'ingesting', 'unknown']) {
        await db`UPDATE generation_takes SET status = ${status} WHERE id = ${takeId}`
        await assert.rejects(deleteAsset('alice', source.id), { statusCode: 409 })
        await db.begin(async (tx) => { await lockOwner(tx, 'alice'); await retireUnusedVersions(tx, 'alice') })
        const [version] = await db`SELECT retired_at FROM character_versions WHERE id = ${character.characterVersionId}`
        assert.equal(version!.retired_at, null)
      }
      await db`UPDATE generation_takes SET status = 'failed' WHERE id = ${takeId}`
      await db.begin(async (tx) => { await lockOwner(tx, 'alice'); await retireUnusedVersions(tx, 'alice') })
      await deleteAsset('alice', source.id)
      await assert.rejects(ownedAsset(db, 'alice', source.id), { statusCode: 404 })
    })

    await t.test('generated originals and posters count toward the same owner quota before any file is written', async () => {
      const [usage] = await db`SELECT coalesce(sum(size_bytes), 0)::text AS bytes FROM assets WHERE owner_id = 'alice' AND purged_at IS NULL`
      process.env.VELA_MAX_STORAGE_BYTES = String(Number(usage!.bytes) + video.source.length + video.preview!.bytes.length - 1)
      const before = written.length
      await assert.rejects(persist('Over quota', video), { data: { code: 'quota_exceeded' } })
      assert.equal(written.length, before)
      assert.equal(await db.begin(async (tx) => { await lockOwner(tx, 'alice'); return assetIsUsed(tx, 'alice', imageAsset.id) }), false)
    })
    await t.test('concurrent uploads cannot consume the storage reserved for a paid generation', async () => {
      const reservedBytes = generatedMediaReservation('image')
      const generationId = randomUUID(), takeId = randomUUID()
      await db`INSERT INTO generations(id, owner_id, project_id, generator_id, draft, manifest)
        VALUES (${generationId}, 'alice', 'original', 'reserved', ${db.json({ mode: 'image' })}, ${db.json({ references: [] })})`
      await db`INSERT INTO generation_takes(id, generation_id, status, reserved_bytes)
        VALUES (${takeId}, ${generationId}, 'unknown', ${reservedBytes})`
      const [usage] = await db`SELECT coalesce(sum(size_bytes), 0)::text AS bytes FROM assets WHERE owner_id = 'alice' AND purged_at IS NULL`
      const normalized = await normalizeImage(png, 'image/png')
      const uploadBytes = normalized.source.length + normalized.preview.length
      process.env.VELA_MAX_STORAGE_BYTES = String(Number(usage!.bytes) + reservedBytes + uploadBytes)
      const results = await Promise.allSettled([
        uploadImage('alice', png, 'image/png', 'Concurrent A'), uploadImage('alice', png, 'image/png', 'Concurrent B'),
      ])
      assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1)
      assert.equal((results.find((result) => result.status === 'rejected') as PromiseRejectedResult).reason.data.code, 'quota_exceeded')
      const [pending] = await db`SELECT reserved_bytes FROM generation_takes WHERE id = ${takeId}`
      assert.equal(Number(pending!.reserved_bytes), reservedBytes, 'An unknown paid outcome keeps its reservation')
      // Once a result is known, consuming its reservation and inserting the asset are atomic.
      await db.begin(async (tx) => {
        await lockOwner(tx, 'alice')
        await tx`UPDATE generation_takes SET status = 'ingesting', reserved_bytes = 0 WHERE id = ${takeId}`
        const asset = await persistGeneratedMedia(tx, 'alice', 'Reserved output', image, written)
        await tx`UPDATE generation_takes SET status = 'done', output_asset_id = ${asset.id} WHERE id = ${takeId}`
      })
      const [completed] = await db`SELECT reserved_bytes, output_asset_id FROM generation_takes WHERE id = ${takeId}`
      assert.equal(Number(completed!.reserved_bytes), 0)
      assert.ok(await ownedAsset(db, 'alice', completed!.output_asset_id))
    })
  } finally {
    server.closeAllConnections()
    if (server.listening) await new Promise<void>((resolve) => server.close(() => resolve()))
    await closeDb()
    await admin`DROP SCHEMA IF EXISTS ${admin(schema)} CASCADE`
    await admin.end()
    await rm(directory, { recursive: true, force: true })
    for (const key of Object.keys(process.env)) if (!(key in env)) delete process.env[key]
    Object.assign(process.env, env)
  }
})
