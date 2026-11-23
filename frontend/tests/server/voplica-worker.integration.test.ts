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
import { createProject, deleteProject } from '../../server/services/projects'
import { createGeneration, generationDto } from '../../server/services/generations'
import { runGenerationWorkerOnce } from '../../server/services/generation/worker'
import { ProviderFailure, type GenerationProvider } from '../../server/services/generation/provider'
import { parseProjectCreate } from '../../server/utils/project-validation'
import { uploadImage, ownedAsset } from '../../server/services/media'
import { getStorage } from '../../server/services/storage'
import { createModelArkMediaFixture, createSyntheticMp4 } from '../fixtures/modelark-media'
import { createCheckout, confirmCheckout } from '../../server/services/billing'

const databaseUrl = process.env.VELA_TEST_DATABASE_URL
test('Voplica jobs: immutable Beta7, upload recovery, disable drain, URL refresh, cleanup and uncertain submission', {
  skip: !databaseUrl && 'Set VELA_TEST_DATABASE_URL to a loopback PostgreSQL database',
}, async t => {
  const url = new URL(databaseUrl!)
  assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname))
  const schema = `vela_voplica_test_${randomUUID().replaceAll('-', '')}`
  const admin = postgres(url.toString(), { max: 1, onnotice: () => {} })
  const directory = await mkdtemp(join(tmpdir(), 'vela-voplica-'))
  const env = { ...process.env }
  try {
    await admin`CREATE SCHEMA ${admin(schema)}`
    url.searchParams.set('search_path', schema)
    process.env.DATABASE_URL = url.toString()
    process.env.VELA_STORAGE_DRIVER = 'local'
    process.env.VELA_STORAGE_DIR = directory
    process.env.VOPLICA_API_KEY = 'synthetic-never-sent'
    delete process.env.ARK_API_KEY
    process.env.VELA_GENERATION_ENABLED = 'true'
    process.env.VELA_VOPLICA_ENABLED = 'true'
    await migrate(process.env.DATABASE_URL)
    const db = getDb(), owner = 'voplica-alice'
    await db`INSERT INTO app_users(id, nsfw_enabled) VALUES (${owner}, true)`
    process.env.VELA_DEMO_PAYMENTS_ENABLED = process.env.VELA_ALLOW_DEMO_PROVIDER_SPEND = 'true'
    const checkout = await createCheckout(owner, { packId: 'starter', idempotencyKey: randomUUID() })
    await confirmCheckout(owner, checkout.id)
    const image = await sharp({ create: { width: 400, height: 400, channels: 3, background: '#98b593' } }).png().toBuffer()
    const source = await uploadImage(owner, image, 'image/png', 'synthetic-reference.png')
    const fixture = await createModelArkMediaFixture(t, { '/video.mp4': createSyntheticMp4() })
    async function project(modelId = 'h3-eros-max', durationS = 5, slot?: 'start') {
      return createProject(owner, parseProjectCreate({ title: 'Synthetic Voplica',
        nodes: [{ id: 'ref', type: 'reference', x: 0, y: 0, name: 'Subject', handle: 'subject', assetKind: 'image', assetId: source.id },
          { id: 'gen', type: 'generator', x: 400, y: 0, draft: { mode: 'video', modelId, trial: false, prompt: 'Film @subject walking outdoors',
            count: 1, aspect: '9:16', imageQuality: '1k', videoQuality: '720p', durationS, referenceId: null } }],
        edges: [{ id: 'input', from: 'ref', to: 'gen', ...(slot ? { slot } : {}) }], viewport: { x: 0, y: 0, scale: 1 }, clientMutationId: randomUUID() }))
    }
    async function queue(existing?: Awaited<ReturnType<typeof project>>) {
      const p = existing ?? await project()
      // Synthetic fixture tariff: public admission remains blocked until runtime pricing is verified.
      return createGeneration(owner, p.id, { generatorId: 'gen', expectedRevision: p.revision, clientMutationId: randomUUID() },
        () => ({ version: 'synthetic-test', perTakeTokens: 100, totalTokens: 100, providerCostUsd: 0.05, retailUsd: 0.1, referenceSurchargeTokens: 0, estimated: true }))
    }
    await assert.rejects(queue(await project('h3-eros-max', 6)), { statusCode: 400, data: { code: 'invalid_duration' } })
    await assert.rejects(queue(await project('h3-eros-max', 5, 'start')), { statusCode: 400, data: { code: 'unsupported_reference_mode' } })
    await assert.rejects(queue(await project('seedance-2-5', 5)), { statusCode: 503, data: { code: 'model_disabled' } })
    const unpriced = await project()
    await assert.rejects(createGeneration(owner, unpriced.id, { generatorId: 'gen', expectedRevision: unpriced.revision, clientMutationId: randomUUID() }),
      { statusCode: 503, data: { code: 'pricing_unavailable' } })
    const accepted = await queue()
    const takeId = accepted.generation.takes[0]!.id
    const [snapshot] = await db`SELECT manifest FROM generations WHERE id = ${accepted.generation.id}`
    assert.equal(snapshot!.manifest.provider, 'voplica')
    assert.equal(snapshot!.manifest.providerModel, '01M765CW9DP2X9GD4MG8G54P2V')
    assert.equal(snapshot!.manifest.prompt, 'Film @[ref1](reference:ref1) walking outdoors')
    let prepareCalls = 0, submits = 0, polls = 0, cleanups = 0
    const provider: GenerationProvider = {
      async prepare(_manifest, refs, context) {
        assert.match(refs[0]!, /^data:image\/webp;base64,/)
        prepareCalls++
        if (!context.state.uploads?.length) {
          await context.save({ uploads: ['synthetic-upload'] })
          throw new ProviderFailure('transient', 'lost_chunk_response')
        }
        assert.deepEqual(context.state.uploads, ['synthetic-upload'])
        return { ready: true, references: ['synthetic-upload'] }
      },
      async video(manifest, refs, id) {
        submits++
        assert.equal(id, takeId)
        assert.equal(manifest.providerModel, '01M765CW9DP2X9GD4MG8G54P2V')
        assert.deepEqual(refs, ['synthetic-upload'])
        return 'synthetic-task'
      },
      async image() { throw new Error('Wrong provider method') },
      async poll(task) {
        polls++
        assert.equal(task, 'synthetic-task')
        return { status: 'succeeded', output: { mode: 'video', provider: 'voplica', fileId: 'synthetic-file', url: fixture.url(`/video.mp4?refresh=${polls}`) },
          usage: { chargedMilli: '12345', warningCodes: ['synthetic_warning'] } }
      },
      async cleanup(state, save) { cleanups++; assert.deepEqual(state.uploads, ['synthetic-upload']); await save({ uploads: [] }) },
    }
    // Fixture recognizes the path without dynamic query in the actual test server.
    const originalPoll = provider.poll
    provider.poll = async task => {
      const result = await originalPoll(task)
      if (result.status === 'succeeded') result.output.url = fixture.url('/video.mp4')
      return result
    }
    const due = async () => { await getDb()`UPDATE generation_takes SET next_attempt_at = now() WHERE id = ${takeId}` }
    await runGenerationWorkerOnce(provider)
    assert.equal(submits, 0)
    const [uploading] = await db`SELECT status, provider_state FROM generation_takes WHERE id = ${takeId}`
    assert.equal(uploading!.status, 'queued')
    assert.deepEqual(uploading!.provider_state.uploads, ['synthetic-upload'])
    await closeDb()
    await due()
    await runGenerationWorkerOnce(provider)
    assert.equal(submits, 1)
    assert.equal(prepareCalls, 2)
    process.env.VELA_GENERATION_ENABLED = 'false'
    process.env.VELA_VOPLICA_ENABLED = 'false'
    await assert.rejects(queue(), { statusCode: 503 })
    const storage = getStorage(), originalPut = storage.put
    storage.put = async () => { throw new Error('Synthetic storage outage') }
    try { await due(); await runGenerationWorkerOnce(provider) } finally { storage.put = originalPut }
    const [pending] = await getDb()`SELECT status, provider_usage FROM generation_takes WHERE id = ${takeId}`
    assert.equal(pending!.status, 'ingesting')
    assert.equal(pending!.provider_usage.chargedMilli, '12345')
    await due(); await runGenerationWorkerOnce(provider)
    assert.equal(polls, 2, 'Storage retry must refresh the existing short-lived output URL')
    assert.equal(submits, 1, 'Disabling admission still drains accepted paid work without resubmission')
    const done = await generationDto(getDb(), owner, accepted.generation.id)
    assert.equal(done.takes[0]!.status, 'done')
    const asset = await ownedAsset(getDb(), owner, done.takes[0]!.assetId!)
    assert.deepEqual(await getStorage().get(asset.source_key), createSyntheticMp4())
    await due(); await runGenerationWorkerOnce(provider)
    assert.equal(cleanups, 1)
    assert.equal(await runGenerationWorkerOnce(provider), false)

    process.env.VELA_GENERATION_ENABLED = process.env.VELA_VOPLICA_ENABLED = 'true'
    const uncertain = await queue()
    const unknownProvider: GenerationProvider = { ...provider,
      async prepare(_m, _r, context) { await context.save({ uploads: ['uncertain-upload'] }); return { ready: true, references: ['uncertain-upload'] } },
      async video() { submits++; throw new ProviderFailure('unknown', 'provider_connection_lost') },
    }
    await runGenerationWorkerOnce(unknownProvider)
    assert.equal((await generationDto(getDb(), owner, uncertain.generation.id)).takes[0]!.status, 'unknown')
    assert.equal(await runGenerationWorkerOnce(unknownProvider), false)
    assert.equal(cleanups, 1, 'Unknown paid runs retain their inputs until reconciled')

    const cancelled = await queue()
    await runGenerationWorkerOnce({ ...provider, async prepare(_m, _r, context) {
      await context.save({ uploads: ['synthetic-upload'] })
      await deleteProject(owner, cancelled.project.id, { expectedRevision: cancelled.project.revision!, clientMutationId: randomUUID() })
      return { ready: true, references: ['synthetic-upload'] }
    } })
    assert.equal((await generationDto(getDb(), owner, cancelled.generation.id)).takes[0]!.status, 'failed')
    await runGenerationWorkerOnce(provider)
    assert.equal(cleanups, 2, 'Cancelled preparing tasks still clean provider reference uploads')
    assert.equal(submits, 2)

    const racing = await queue()
    let signalInitStarted!: () => void, releaseInit!: () => void
    let signalCleanupStarted!: () => void, releaseCleanup!: () => void
    const initStarted = new Promise<void>(resolve => { signalInitStarted = resolve })
    const initReply = new Promise<void>(resolve => { releaseInit = resolve })
    const cleanupStarted = new Promise<void>(resolve => { signalCleanupStarted = resolve })
    const deleteReply = new Promise<void>(resolve => { releaseCleanup = resolve })
    let lateSaveError: unknown
    const compensated: string[] = []
    const preparing = runGenerationWorkerOnce({ ...provider, async prepare(_m, _r, context) {
      await context.save({ uploads: ['cleanup-A'] })
      signalInitStarted()
      await initReply // Init(B) finishes after deletion has handed the take to a cleanup worker.
      try { await context.save({ uploads: ['cleanup-A', 'late-B'] }) }
      catch (error) {
        lateSaveError = error
        if (error instanceof ProviderFailure && error.code === 'lease_lost') compensated.push('late-B')
        throw error
      }
      return { ready: true, references: ['cleanup-A', 'late-B'] }
    } })
    let cleaning: Promise<boolean> | undefined
    try {
      await initStarted
      await deleteProject(owner, racing.project.id, { expectedRevision: racing.project.revision!, clientMutationId: randomUUID() })
      cleaning = runGenerationWorkerOnce({ ...provider, async cleanup(state, save) {
        assert.deepEqual(state.uploads, ['cleanup-A'])
        signalCleanupStarted()
        await deleteReply
        await save({ uploads: [] })
      } })
      await cleanupStarted
      releaseInit()
      await preparing
      assert.ok(lateSaveError instanceof ProviderFailure && lateSaveError.code === 'lease_lost',
        'A stale preparing lease cannot replace the cleanup worker\'s checkpoint')
      assert.deepEqual(compensated, ['late-B'], 'Definitive lease loss lets the adapter delete its newly initialized upload')
      const [beforeCleanup] = await getDb()`SELECT provider_state FROM generation_takes WHERE id = ${racing.generation.takes[0]!.id}`
      assert.deepEqual(beforeCleanup!.provider_state.uploads, ['cleanup-A'])
    } finally {
      releaseInit()
      releaseCleanup()
      await Promise.allSettled([preparing, cleaning])
    }
    const [afterCleanup] = await getDb()`SELECT status, provider_state FROM generation_takes WHERE id = ${racing.generation.takes[0]!.id}`
    assert.equal(afterCleanup!.status, 'failed')
    assert.deepEqual(afterCleanup!.provider_state.uploads, [])
    assert.equal(submits, 2, 'The deleted preparing take must never reach paid submission')
  } finally {
    await closeDb()
    await admin`DROP SCHEMA IF EXISTS ${admin(schema)} CASCADE`
    await admin.end()
    await rm(directory, { recursive: true, force: true })
    for (const key of Object.keys(process.env)) if (!(key in env)) delete process.env[key]
    Object.assign(process.env, env)
  }
})
