import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import postgres from 'postgres'
import sharp from 'sharp'
import { migrate } from '../../scripts/migrate.mjs'
import { closeDb, getDb } from '../../server/utils/db'
import { createProject, deleteProject, getProject, updateProject } from '../../server/services/projects'
import { createGeneration, generationDto, favoriteTake } from '../../server/services/generations'
import { runGenerationWorkerOnce } from '../../server/services/generation/worker'
import { ProviderFailure, type GenerationProvider } from '../../server/services/generation/modelark'
import { parseProjectCreate, parseProjectUpdate } from '../../server/utils/project-validation'
import { uploadImage, deleteAsset, ownedAsset } from '../../server/services/media'
import { getStorage } from '../../server/services/storage'
import { generatedMediaReservation } from '../../server/services/generated-media'
import { compactMutationReplies } from '../../server/services/mutation-receipts'
import { createModelArkMediaFixture, createSyntheticMp4 } from '../fixtures/modelark-media'

const databaseUrl = process.env.VELA_TEST_DATABASE_URL
test('durable generations: authorization, atomic canvas placement, safe paid submission, restart and output ingestion', {
  skip: !databaseUrl && 'Set VELA_TEST_DATABASE_URL to a loopback PostgreSQL database',
}, async t => {
  const url = new URL(databaseUrl!)
  assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname))
  const schema = `vela_generation_test_${randomUUID().replaceAll('-', '')}`
  const admin = postgres(url.toString(), { max: 1, onnotice: () => {} })
  const directory = await mkdtemp(join(tmpdir(), 'vela-generation-'))
  const env = { ...process.env }
  try {
    await admin`CREATE SCHEMA ${admin(schema)}`
    url.searchParams.set('search_path', schema)
    process.env.DATABASE_URL = url.toString()
    process.env.VELA_STORAGE_DRIVER = 'local'
    process.env.VELA_STORAGE_DIR = directory
    process.env.ARK_API_KEY = 'synthetic-key-never-sent'
    delete process.env.ARK_BASE_URL
    delete process.env.ARK_IMAGE_MODEL
    delete process.env.ARK_VIDEO_MODEL
    delete process.env.VELA_GENERATION_ENABLED
    await migrate(process.env.DATABASE_URL)
    const db = getDb()
    await db`INSERT INTO app_users(id) VALUES ('generation-alice'), ('generation-bob')`
    const owner = 'generation-alice'
    const image = await sharp({ create: { width: 400, height: 400, channels: 3, background: '#ce2424' } }).png().toBuffer()
    const fixture = await createModelArkMediaFixture(t, { '/image.png': image, '/poster.png': image, '/video.mp4': createSyntheticMp4() })
    let imageCalls = 0, videoCalls = 0, pollCalls = 0
    const provider: GenerationProvider = {
      async image(manifest, references) {
        imageCalls++
        assert.equal(manifest.providerModel, 'dola-seedream-5-0-pro-260628')
        assert.equal(manifest.prompt, 'Paint image 1 in a forest')
        assert.match(references[0]!, /^data:image\/webp;base64,/)
        return { mode: 'image', url: fixture.url('/image.png') }
      },
      async video() { videoCalls++; return 'synthetic-video-task' },
      async poll() { pollCalls++; return { status: 'succeeded', output: { mode: 'video', url: fixture.url('/video.mp4'), posterUrl: fixture.url('/poster.png') } } },
    }
    const source = await uploadImage(owner, image, 'image/png', 'reference.png')
    const reference = { id: 'reference', type: 'reference', x: 0, y: 0, name: 'Subject', handle: 'subject', assetId: source.id, assetKind: 'image' }
    const generator = { id: 'generator', type: 'generator', x: 300, y: 0,
      draft: { modelId: 'seedream-5-pro', trial: false, mode: 'image', prompt: 'Paint @subject in a forest',
        aspect: '1:1', imageQuality: '1k', videoQuality: '720p', durationS: 6, count: 2, referenceId: null } }
    const input = () => parseProjectCreate({ title: 'Synthetic generation', nodes: [reference, generator], edges: [{ id: 'input', from: 'reference', to: 'generator' }],
      viewport: { x: 0, y: 0, scale: 1 }, clientMutationId: randomUUID() })
    const project = await createProject(owner, input())
    const durableNodes = (nodes: typeof project.nodes) => nodes.map(node => {
      if (node.type !== 'reference') return node
      const { url: _deliveryOnly, ...durable } = node
      return durable
    })
    const request = { generatorId: generator.id, expectedRevision: project.revision, clientMutationId: randomUUID() }
    await assert.rejects(createGeneration(owner, project.id, request), { statusCode: 503 })
    assert.equal(await runGenerationWorkerOnce(provider), false)
    process.env.VELA_GENERATION_ENABLED = 'true'
    const [accepted, retry] = await Promise.all([createGeneration(owner, project.id, request), createGeneration(owner, project.id, request)])
    assert.deepEqual(retry, accepted)
    assert.equal(accepted.project.revision, project.revision + 1)
    assert.equal(accepted.project.nodes.filter(node => node.type === 'take').length, 2)
    assert.equal(imageCalls, 0, 'API acceptance must not issue a paid request')
    await assert.rejects(createGeneration(owner, project.id, { ...request, expectedRevision: 999 }), { statusCode: 409 })
    await assert.rejects(generationDto(db, 'generation-bob', accepted.generation.id), { statusCode: 404 })
    await assert.rejects(favoriteTake('generation-bob', accepted.generation.id, accepted.generation.takes[0]!.id, true), { statusCode: 404 })
    await assert.rejects(createProject('generation-bob', parseProjectCreate({ ...input(), nodes: durableNodes(accepted.project.nodes), edges: accepted.project.edges })), { statusCode: 404 })
    await assert.rejects(createProject(owner, parseProjectCreate({ ...input(), nodes: [{ id: 'forged', type: 'take', x: 0, y: 0, takeId: randomUUID(), generationId: randomUUID() }], edges: [] })), { statusCode: 404 })

    await db`UPDATE mutation_receipts SET created_at = now() - interval '8 days'
      WHERE owner_id = ${owner} AND scope = ${`projects:${project.id}:generate`} AND client_mutation_id = ${request.clientMutationId}`
    await assert.rejects(createGeneration(owner, project.id, request), { statusCode: 410, data: { code: 'receipt_expired' } })
    await compactMutationReplies({ dryRun: false })
    await assert.rejects(createGeneration(owner, project.id, request), { statusCode: 410, data: { code: 'receipt_expired' } })
    const [acceptedCount] = await db`SELECT count(*)::int AS count FROM generations`
    assert.equal(acceptedCount!.count, 1, 'Expired or compacted receipt must never enqueue another paid generation')

    // Edits after queueing cannot change the immutable paid request.
    const edited = structuredClone(accepted.project)
    const editGenerator = edited.nodes.find(node => node.type === 'generator')!
    if (editGenerator.type === 'generator') editGenerator.draft.prompt = 'A newer prompt'
    await updateProject(owner, project.id, parseProjectUpdate({ title: edited.title, nodes: durableNodes(edited.nodes), edges: edited.edges,
      viewport: edited.viewport, expectedRevision: edited.revision, clientMutationId: randomUUID() }))
    await Promise.all([runGenerationWorkerOnce(provider), runGenerationWorkerOnce(provider)])
    assert.equal(imageCalls, 2, 'Concurrent workers claim each take only once')
    const complete = await generationDto(db, owner, accepted.generation.id)
    assert.deepEqual(complete.takes.map(take => take.status), ['done', 'done'])
    const firstAsset = await ownedAsset(db, owner, complete.takes[0]!.assetId!)
    assert.equal(firstAsset.mime_type, 'image/png')
    assert.deepEqual(await getStorage().get(firstAsset.source_key), image)
    assert.match(complete.takes[0]!.url!, /^\/api\/assets\/.*\/file\?variant=source$/)
    const favorite = await favoriteTake(owner, complete.id, complete.takes[0]!.id, true)
    assert.equal(favorite.takes[0]!.favorite, true)

    // Copies keep owned results alive after the original project is removed.
    const copy = await createProject(owner, parseProjectCreate({ ...input(), nodes: [accepted.project.nodes.find(node => node.type === 'take')!], edges: [] }))
    const current = await getProject(owner, project.id)
    await deleteProject(owner, project.id, { expectedRevision: current.revision!, clientMutationId: randomUUID() })
    assert.ok(await ownedAsset(db, owner, firstAsset.id))
    await deleteProject(owner, copy.id, { expectedRevision: copy.revision!, clientMutationId: randomUUID() })
    await assert.rejects(ownedAsset(db, owner, firstAsset.id), { statusCode: 404 })
    await assert.rejects(createProject(owner, parseProjectCreate({ ...input(), nodes: [accepted.project.nodes.find(node => node.type === 'take')!], edges: [] })), { statusCode: 404 }, 'Retired results must not be added again from a stale clipboard')

    async function queue(mode: 'image' | 'video' = 'image') {
      const fresh = input()
      const node = fresh.nodes.find(node => node.type === 'generator')!
      if (node.type === 'generator') { node.draft.count = 1; node.draft.mode = mode; node.draft.modelId = mode === 'image' ? 'seedream-5-pro' : 'seedance-2-5' }
      const p = await createProject(owner, fresh)
      const result = await createGeneration(owner, p.id, { generatorId: 'generator', expectedRevision: p.revision, clientMutationId: randomUUID() })
      return { ...result, takeId: result.generation.takes[0]!.id }
    }
    const uncertain = await queue()
    let uncertainCalls = 0
    const uncertainProvider = { ...provider, async image() { uncertainCalls++; throw new ProviderFailure('unknown', 'synthetic_timeout') } }
    await runGenerationWorkerOnce(uncertainProvider)
    assert.equal((await generationDto(db, owner, uncertain.generation.id)).takes[0]!.status, 'unknown')
    assert.equal(await runGenerationWorkerOnce(uncertainProvider), false)
    assert.equal(uncertainCalls, 1)
    await assert.rejects(createGeneration(owner, uncertain.project.id, { generatorId: 'generator', expectedRevision: uncertain.project.revision, clientMutationId: randomUUID() }), { statusCode: 409 })

    const crashed = await queue()
    await db`UPDATE generation_takes SET status = 'submitting', lease_token = ${randomUUID()}, lease_until = now() - interval '1 second' WHERE id = ${crashed.takeId}`
    assert.equal(await runGenerationWorkerOnce(provider), false)
    assert.equal((await generationDto(db, owner, crashed.generation.id)).takes[0]!.status, 'unknown')
    assert.equal(imageCalls, 2, 'An expired submitting lease must never repeat a paid request')

    const rejected = await queue()
    await runGenerationWorkerOnce({ ...provider, async image() { throw new ProviderFailure('rejected', 'ContentPolicy') } })
    assert.equal((await generationDto(db, owner, rejected.generation.id)).takes[0]!.status, 'failed')

    const video = await queue('video')
    await runGenerationWorkerOnce(provider)
    assert.equal(videoCalls, 1)
    await closeDb() // A separate worker process can resume the provider task after restart.
    const resumed = getDb()
    await resumed`UPDATE generation_takes SET next_attempt_at = now() WHERE id = ${video.takeId}`
    await runGenerationWorkerOnce(provider)
    const videoResult = await generationDto(resumed, owner, video.generation.id)
    assert.equal(videoResult.takes[0]!.status, 'done')
    assert.equal(videoCalls, 1)
    assert.equal(pollCalls, 1)
    const videoAsset = await ownedAsset(resumed, owner, videoResult.takes[0]!.assetId!)
    assert.equal(videoAsset.mime_type, 'video/mp4')
    assert.ok(videoResult.takes[0]!.posterUrl)
    assert.deepEqual(await getStorage().get(videoAsset.source_key), createSyntheticMp4())

    const storageRetry = await queue()
    const storage = getStorage(), originalPut = storage.put
    storage.put = async () => { throw new Error('Synthetic unavailable storage') }
    try { await runGenerationWorkerOnce(provider) } finally { storage.put = originalPut }
    assert.equal((await generationDto(resumed, owner, storageRetry.generation.id)).takes[0]!.status, 'running')
    const submittedCount = imageCalls
    await resumed`UPDATE generation_takes SET next_attempt_at = now() WHERE id = ${storageRetry.takeId}`
    await runGenerationWorkerOnce(provider)
    assert.equal(imageCalls, submittedCount, 'Output storage retry must not repeat generation')
    assert.equal((await generationDto(resumed, owner, storageRetry.generation.id)).takes[0]!.status, 'done')
    await assert.rejects(deleteAsset(owner, source.id), { statusCode: 409 }, 'Unknown paid outcomes keep their immutable inputs pinned')
    const [unknownReservation] = await resumed`SELECT reserved_bytes FROM generation_takes WHERE id = ${uncertain.takeId}`
    assert.equal(Number(unknownReservation!.reserved_bytes), generatedMediaReservation('image'))
    const [rejectedReservation] = await resumed`SELECT reserved_bytes FROM generation_takes WHERE id = ${rejected.takeId}`
    assert.equal(Number(rejectedReservation!.reserved_bytes), 0)

    const cancelled = await queue()
    await deleteProject(owner, cancelled.project.id, { expectedRevision: cancelled.project.revision!, clientMutationId: randomUUID() })
    const [cancelledTake] = await resumed`SELECT status, reserved_bytes FROM generation_takes WHERE id = ${cancelled.takeId}`
    assert.equal(cancelledTake!.status, 'failed')
    assert.equal(Number(cancelledTake!.reserved_bytes), 0)

    // Reserve output capacity before accepting paid work; later uploads cannot take it.
    const quotaInput = input()
    quotaInput.nodes = quotaInput.nodes.filter(node => node.type === 'generator')
    quotaInput.edges = []
    if (quotaInput.nodes[0]!.type === 'generator') { quotaInput.nodes[0]!.draft.count = 1; quotaInput.nodes[0]!.draft.prompt = 'A forest' }
    const quotaProject = await createProject('generation-bob', quotaInput)
    const quotaRequest = { generatorId: 'generator', expectedRevision: quotaProject.revision, clientMutationId: randomUUID() }
    process.env.VELA_MAX_STORAGE_BYTES = String(generatedMediaReservation('image') - 1)
    await assert.rejects(createGeneration('generation-bob', quotaProject.id, quotaRequest), { statusCode: 413 })
    const [noPaidWork] = await resumed`SELECT count(*)::int AS count FROM generations WHERE owner_id = 'generation-bob'`
    assert.equal(noPaidWork!.count, 0)
    process.env.VELA_MAX_STORAGE_BYTES = String(generatedMediaReservation('image'))
    const reserved = await createGeneration('generation-bob', quotaProject.id, quotaRequest)
    await assert.rejects(uploadImage('generation-bob', image, 'image/png', 'capacity-steal'), { statusCode: 413 })
    let reservedCalls = 0
    await runGenerationWorkerOnce({ ...provider, async image() { reservedCalls++; return { mode: 'image', url: fixture.url('/image.png') } } })
    assert.equal(reservedCalls, 1)
    assert.equal((await generationDto(resumed, 'generation-bob', reserved.generation.id)).takes[0]!.status, 'done')
    await uploadImage('generation-bob', image, 'image/png', 'after-reservation-consumed')

  } finally {
    await closeDb()
    await admin`DROP SCHEMA IF EXISTS ${admin(schema)} CASCADE`
    await admin.end()
    await rm(directory, { recursive: true, force: true })
    for (const key of Object.keys(process.env)) if (!(key in env)) delete process.env[key]
    Object.assign(process.env, env)
  }
})
