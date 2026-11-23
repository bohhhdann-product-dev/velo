import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import postgres from 'postgres'
import { migrate } from '../../scripts/migrate.mjs'
import { closeDb, getDb } from '../../server/utils/db'
import { createCheckout, confirmCheckout, getCheckout, getWallet, demoCheckoutEnabled } from '../../server/services/billing'
import { createProject, deleteProject } from '../../server/services/projects'
import { createGeneration, quoteSavedGeneration } from '../../server/services/generations'
import { parseProjectCreate } from '../../server/utils/project-validation'
import { runGenerationWorkerOnce } from '../../server/services/generation/worker'
import { ProviderFailure, type GenerationProvider } from '../../server/services/generation/provider'

const databaseUrl = process.env.VELA_TEST_DATABASE_URL
test('token billing: atomic grants, checkout ownership/replay, concurrent spending, releases and uncertain paid outcomes', {
  skip: !databaseUrl && 'Set VELA_TEST_DATABASE_URL to a loopback PostgreSQL database',
}, async () => {
  const url = new URL(databaseUrl!)
  assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname))
  const schema = `vela_billing_test_${randomUUID().replaceAll('-', '')}`
  const admin = postgres(url.toString(), { max: 1, onnotice: () => {} })
  const env = { ...process.env }
  try {
    await admin`CREATE SCHEMA ${admin(schema)}`
    url.searchParams.set('search_path', schema)
    process.env.DATABASE_URL = url.toString()
    process.env.NODE_ENV = 'test'
    process.env.VELA_DEMO_PAYMENTS_ENABLED = 'true'
    delete process.env.VELA_ALLOW_DEMO_PROVIDER_SPEND
    process.env.ARK_API_KEY = 'synthetic-not-sent'
    delete process.env.ARK_BASE_URL
    delete process.env.ARK_IMAGE_MODEL
    delete process.env.ARK_VIDEO_MODEL
    process.env.VELA_GENERATION_ENABLED = 'false'
    await migrate(process.env.DATABASE_URL)
    const db = getDb()
    await db`INSERT INTO app_users(id) VALUES ('wallet-alice'), ('wallet-bob')`
    const wallets = await Promise.all(Array.from({ length: 12 }, () => getWallet('wallet-alice')))
    assert.ok(wallets.every(wallet => wallet.availableTokens === 500 && wallet.ledger.length === 1))
    await assert.rejects(db`UPDATE token_ledger SET amount = 999999 WHERE owner_id = 'wallet-alice'`)
    await assert.rejects(db`DELETE FROM token_ledger WHERE owner_id = 'wallet-alice'`)
    const key = randomUUID()
    const purchases = await Promise.all(Array.from({ length: 6 }, () => createCheckout('wallet-alice', { packId: 'starter', idempotencyKey: key })))
    assert.ok(purchases.every(checkout => checkout.id === purchases[0]!.id))
    const purchase = purchases[0]!
    await assert.rejects(createCheckout('wallet-alice', { packId: 'creator', idempotencyKey: key }), { statusCode: 409 })
    await assert.rejects(createCheckout('wallet-alice', { packId: 'starter', idempotencyKey: randomUUID(), tokens: 1_000_000 }), { statusCode: 400 })
    await assert.rejects(getCheckout('wallet-bob', purchase.id), { statusCode: 404 })
    await assert.rejects(confirmCheckout('wallet-bob', purchase.id), { statusCode: 404 })
    assert.equal((await getWallet('wallet-alice')).availableTokens, 500, 'Pending payments do not grant tokens')
    const paid = await Promise.all(Array.from({ length: 10 }, () => confirmCheckout('wallet-alice', purchase.id)))
    assert.ok(paid.every(result => result.wallet.availableTokens === 10_500))
    assert.equal((await getWallet('wallet-alice')).ledger.filter(entry => entry.kind === 'demo_purchase').length, 1)
    const pending = await createCheckout('wallet-alice', { packId: 'creator', idempotencyKey: randomUUID() })
    process.env.NODE_ENV = 'production'
    assert.equal(demoCheckoutEnabled(), false)
    await assert.rejects(confirmCheckout('wallet-alice', pending.id), { statusCode: 403 })
    await assert.rejects(createCheckout('wallet-alice', { packId: 'starter', idempotencyKey: randomUUID() }), { statusCode: 403 })
    process.env.NODE_ENV = 'test'

    async function project(owner: string, count = 1, quality: '1k' | '2k' = '1k') {
      return createProject(owner, parseProjectCreate({ title: 'Token test', nodes: [{ id: 'gen', type: 'generator', x: 0, y: 0,
        draft: { mode: 'image', modelId: 'seedream-5-pro', prompt: 'A green forest', trial: false, count,
          aspect: '1:1', imageQuality: quality, videoQuality: '720p', durationS: 5, referenceId: null } }],
        edges: [], viewport: { x: 0, y: 0, scale: 1 }, clientMutationId: randomUUID() }))
    }
    const p = await project('wallet-alice')
    const quote = await quoteSavedGeneration('wallet-alice', p.id, { generatorId: 'gen', expectedRevision: p.revision })
    assert.equal(quote.quote.perTakeTokens, 79, 'A paused provider still permits an authoritative quote')
    await assert.rejects(quoteSavedGeneration('wallet-bob', p.id, { generatorId: 'gen', expectedRevision: p.revision }), { statusCode: 404 })
    process.env.VELA_GENERATION_ENABLED = 'true'
    const req = { generatorId: 'gen', expectedRevision: p.revision, clientMutationId: randomUUID() }
    await assert.rejects(createGeneration('wallet-alice', p.id, { ...req, expectedPriceTokens: 1, pricingVersion: quote.quote.version }),
      { statusCode: 409, data: { code: 'price_changed' } })
    const [unchanged] = await db`SELECT revision FROM projects WHERE id = ${p.id}`
    const [noTakes] = await db`SELECT count(*)::int AS count FROM generations WHERE project_id = ${p.id}`
    assert.equal(unchanged!.revision, p.revision)
    assert.equal(noTakes!.count, 0)
    assert.equal((await getWallet('wallet-alice')).reservedTokens, 0)
    await assert.rejects(createGeneration('wallet-alice', p.id, req), { statusCode: 403, data: { code: 'demo_provider_spend_blocked' } })
    process.env.NODE_ENV = 'production'
    process.env.VELA_ALLOW_DEMO_PROVIDER_SPEND = 'true'
    await assert.rejects(createGeneration('wallet-alice', p.id, req), { statusCode: 403, data: { code: 'demo_provider_spend_blocked' } })
    process.env.NODE_ENV = 'test'
    delete process.env.VELA_ALLOW_DEMO_PROVIDER_SPEND

    // A restart with tighter settings must recheck already admitted, unsubmitted work.
    process.env.VELA_ALLOW_DEMO_PROVIDER_SPEND = 'true'
    const devJob = await createGeneration('wallet-alice', p.id, req)
    process.env.NODE_ENV = 'production'
    let forbiddenSubmissions = 0
    const guardedProvider: GenerationProvider = {
      async image() { forbiddenSubmissions++; throw new Error('Must not submit') },
      async video() { forbiddenSubmissions++; throw new Error('Must not submit') },
      async poll() { throw new Error('Must not poll') },
    }
    await runGenerationWorkerOnce(guardedProvider)
    assert.equal(forbiddenSubmissions, 0)
    const [blockedTake] = await db`SELECT status, token_state FROM generation_takes WHERE id = ${devJob.generation.takes[0]!.id}`
    assert.equal(blockedTake!.status, 'failed')
    assert.equal(blockedTake!.token_state, 'released')
    process.env.NODE_ENV = 'test'
    delete process.env.VELA_ALLOW_DEMO_PROVIDER_SPEND

    const tooExpensive = await project('wallet-bob', 4, '2k')
    await assert.rejects(createGeneration('wallet-bob', tooExpensive.id, { generatorId: 'gen', expectedRevision: tooExpensive.revision, clientMutationId: randomUUID() }), { statusCode: 402 })
    assert.equal((await getWallet('wallet-bob')).reservedTokens, 0, 'A failed batch rolls back every hold')
    const [p1, p2] = await Promise.all([project('wallet-bob', 3, '2k'), project('wallet-bob', 3, '2k')])
    const competing = await Promise.allSettled([p1, p2].map(p => createGeneration('wallet-bob', p.id,
      { generatorId: 'gen', expectedRevision: p.revision, clientMutationId: randomUUID() })))
    assert.equal(competing.filter(result => result.status === 'fulfilled').length, 1, 'Concurrent requests cannot spend the same balance')
    assert.equal((await getWallet('wallet-bob')).availableTokens, 26)
    const accepted = competing.find(result => result.status === 'fulfilled')!
    if (accepted.status !== 'fulfilled') throw new Error('Expected an accepted generation')
    await deleteProject('wallet-bob', accepted.value.project.id, { expectedRevision: accepted.value.project.revision!, clientMutationId: randomUUID() })
    assert.equal((await getWallet('wallet-bob')).availableTokens, 500, 'Deleting unsubmitted work releases all holds')

    const waitingProject = await project('wallet-bob')
    const waiting = await createGeneration('wallet-bob', waitingProject.id, { generatorId: 'gen', expectedRevision: waitingProject.revision, clientMutationId: randomUUID() })
    const takeId = waiting.generation.takes[0]!.id
    await db`UPDATE generation_takes SET created_at = now() - interval '10 days' WHERE id = ${takeId}`
    let preparations = 0
    const provider: GenerationProvider = {
      async prepare() { preparations++; return { ready: false, references: [] } },
      async image() { throw new Error('No actual generation expected') },
      async video() { throw new Error('No actual generation expected') },
      async poll() { throw new ProviderFailure('transient', 'temporary_network_error') },
    }
    await runGenerationWorkerOnce(provider)
    assert.equal(preparations, 1, 'Queue age does not expire a fresh reference preparation')
    const [prepared] = await db`SELECT status, preparation_started_at FROM generation_takes WHERE id = ${takeId}`
    assert.equal(prepared!.status, 'queued')
    assert.ok(Date.now() - new Date(prepared!.preparation_started_at).getTime() < 60_000)
    await db`UPDATE generation_takes SET status = 'running', provider_task_id = 'known-paid-task', next_attempt_at = now() WHERE id = ${takeId}`
    await runGenerationWorkerOnce(provider)
    const [running] = await db`SELECT status, token_state FROM generation_takes WHERE id = ${takeId}`
    assert.equal(running!.status, 'running', 'An old task plus polling outage must remain recoverable')
    assert.equal(running!.token_state, 'reserved')
    assert.equal((await getWallet('wallet-bob')).reservedTokens, 79)
    await db`UPDATE generation_takes SET next_attempt_at = now() WHERE id = ${takeId}`
    await runGenerationWorkerOnce({ ...provider, async poll() { return { status: 'failed', code: 'confirmed_failed' } } })
    assert.equal((await getWallet('wallet-bob')).availableTokens, 500)
    assert.equal(await runGenerationWorkerOnce(provider), false, 'Terminal failure cannot release tokens twice')
  } finally {
    await closeDb()
    await admin`DROP SCHEMA IF EXISTS ${admin(schema)} CASCADE`
    await admin.end()
    for (const key of Object.keys(process.env)) if (!(key in env)) delete process.env[key]
    Object.assign(process.env, env)
  }
})
