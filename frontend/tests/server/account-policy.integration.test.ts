import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import postgres from 'postgres'
import type { Draft } from '../../app/entities/studio/types'
import { quoteGeneration } from '../../app/entities/studio/pricing'
import { migrate } from '../../scripts/migrate.mjs'
import { closeDb, getDb } from '../../server/utils/db'
import { parseProjectCreate } from '../../server/utils/project-validation'
import { assertGenerationPolicy } from '../../server/services/generation/account-policy'
import { cancelUnsubmittedForAccount } from '../../server/services/generation/lifecycle'
import { runGenerationWorkerOnce } from '../../server/services/generation/worker'
import type { GenerationManifest, GenerationProvider } from '../../server/services/generation/provider'
import { createGeneration, quoteSavedGeneration } from '../../server/services/generations'
import { createProject } from '../../server/services/projects'
import { lockOwner } from '../../server/services/media'
import { confirmCheckout, createCheckout, getCheckout, getWallet, reserveTakeTokens, settleTakeTokens } from '../../server/services/billing'

const imageDraft: Draft = { mode: 'image', modelId: 'seedream-5-pro', prompt: 'A forest in the morning',
  aspect: '1:1', count: 1, imageQuality: '1k', videoQuality: '720p', durationS: 5, trial: false, referenceId: null }

test('account discount rounds each output, preserves reference cost and allows a free generation', () => {
  const base = quoteGeneration(imageDraft)!
  const discounted = quoteGeneration(imageDraft, 0, 25)!
  assert.equal(base.perTakeTokens, 79)
  assert.equal(discounted.perTakeTokens, 60)
  assert.equal(discounted.providerCostUsd, base.providerCostUsd)
  assert.notEqual(discounted.version, base.version, 'Changing the discount invalidates stale quotes')
  const references = quoteGeneration({ ...imageDraft, count: 2 }, 3, 25)!
  assert.equal(references.totalTokens, 136, 'Round each output before multiplying the batch')
  assert.equal(references.referenceSurchargeTokens, 8)
  assert.equal(references.providerCostUsd, 0.102)
  assert.equal(quoteGeneration(imageDraft, 3, 100)!.totalTokens, 0)
  assert.equal(quoteGeneration(imageDraft, 3, 100)!.retailUsd, 0)
  for (const invalid of [-1, 101, 0.5, Number.NaN]) assert.equal(quoteGeneration(imageDraft, 0, invalid), null)
})

const databaseUrl = process.env.VELA_TEST_DATABASE_URL
test('account policy: authoritative discounts, safe cancellation, worker recheck and accepted-job recovery', {
  skip: !databaseUrl && 'Set VELA_TEST_DATABASE_URL to a loopback PostgreSQL database',
}, async t => {
  const url = new URL(databaseUrl!)
  assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname))
  const schema = `vela_account_policy_test_${randomUUID().replaceAll('-', '')}`
  const admin = postgres(url.toString(), { max: 1, onnotice: () => {} })
  const env = { ...process.env }
  try {
    await admin`CREATE SCHEMA ${admin(schema)}`
    url.searchParams.set('search_path', schema)
    process.env.DATABASE_URL = url.toString()
    process.env.NODE_ENV = 'test'
    process.env.ARK_API_KEY = 'synthetic-never-sent'
    process.env.VOPLICA_API_KEY = 'synthetic-never-sent'
    process.env.VELA_GENERATION_ENABLED = 'true'
    process.env.VELA_VOPLICA_ENABLED = 'true'
    process.env.VELA_DEMO_PAYMENTS_ENABLED = 'true'
    process.env.VELA_ADMIN_USER_IDS = 'policy-admin'
    delete process.env.ARK_BASE_URL
    delete process.env.ARK_IMAGE_MODEL
    delete process.env.ARK_VIDEO_MODEL
    delete process.env.VELA_ALLOW_DEMO_PROVIDER_SPEND
    await migrate(process.env.DATABASE_URL)
    const db = getDb()
    await db`INSERT INTO app_users(id) VALUES ('policy-admin'), ('policy-discount'), ('policy-cancel'), ('policy-other'), ('policy-worker')`
    const project = async (owner: string) => createProject(owner, parseProjectCreate({ title: 'Policy isolation',
      nodes: [{ id: 'generator', type: 'generator', x: 0, y: 0, draft: imageDraft }], edges: [],
      viewport: { x: 0, y: 0, scale: 1 }, clientMutationId: randomUUID() }))

    await t.test('the server recalculates price and never settles a live checkout through the test endpoint', async () => {
      const owner = 'policy-discount', p = await project(owner)
      const original = await quoteSavedGeneration(owner, p.id, { generatorId: 'generator', expectedRevision: p.revision })
      await db`UPDATE app_users SET discount_percent = 25, nsfw_enabled = true WHERE id = ${owner}`
      const wallet = await getWallet(owner)
      assert.equal(wallet.discountPercent, 25)
      assert.equal(wallet.nsfwEnabled, true)
      assert.equal(wallet.isAdmin, false)
      assert.equal((await getWallet('policy-admin')).isAdmin, true)
      const discounted = await quoteSavedGeneration(owner, p.id, { generatorId: 'generator', expectedRevision: p.revision })
      assert.equal(discounted.quote.totalTokens, 60)
      await assert.rejects(createGeneration(owner, p.id, { generatorId: 'generator', expectedRevision: p.revision,
        clientMutationId: randomUUID(), expectedPriceTokens: original.quote.totalTokens, pricingVersion: original.quote.version }),
      { statusCode: 409, data: { code: 'price_changed' } })
      assert.equal((await getWallet(owner)).reservedTokens, 0)

      await db`UPDATE app_users SET discount_percent = 100 WHERE id = ${owner}`
      const free = await quoteSavedGeneration(owner, p.id, { generatorId: 'generator', expectedRevision: p.revision })
      assert.equal(free.quote.totalTokens, 0)
      const accepted = await createGeneration(owner, p.id, { generatorId: 'generator', expectedRevision: p.revision,
        clientMutationId: randomUUID(), expectedPriceTokens: 0, pricingVersion: free.quote.version })
      const takeId = accepted.generation.takes[0]!.id
      await db.begin(async tx => {
        await lockOwner(tx, owner)
        await settleTakeTokens(tx, owner, takeId, 'spend')
        await settleTakeTokens(tx, owner, takeId, 'spend')
        await tx`UPDATE generation_takes SET status = 'done', reserved_bytes = 0 WHERE id = ${takeId}`
      })
      const [take] = await db`SELECT token_state, price_tokens FROM generation_takes WHERE id = ${takeId}`
      assert.equal(take!.token_state, 'spent')
      assert.equal(take!.price_tokens, 0)
      const after = await getWallet(owner)
      assert.equal(after.availableTokens, 500)
      assert.equal(after.ledger.filter(entry => entry.kind === 'spend').length, 1)
      const checkout = await createCheckout(owner, { packId: 'starter', idempotencyKey: randomUUID() })
      await db`UPDATE token_checkouts SET payment_mode = 'live' WHERE id = ${checkout.id}`
      assert.equal((await getCheckout(owner, checkout.id)).demo, false)
      await assert.rejects(confirmCheckout(owner, checkout.id), { statusCode: 403, data: { code: 'live_payment_required' } })
      assert.equal((await getWallet(owner)).availableTokens, 500)
      assert.equal((await getCheckout(owner, checkout.id)).status, 'pending')
    })

    // Synthetic stored jobs exercise recovery states without issuing any provider or storage request.
    const projects = new Map<string, string>()
    async function seedHeldTake(owner: string, modelId: string, status: string) {
      if (!projects.has(owner)) projects.set(owner, (await project(owner)).id)
      const generationId = randomUUID(), takeId = randomUUID()
      const draft: Draft = { ...imageDraft, mode: modelId === 'h3-eros-max' ? 'video' : 'image', modelId }
      const manifest: GenerationManifest = { draft, prompt: draft.prompt, references: [], providerModel: 'synthetic-model',
        provider: modelId === 'h3-eros-max' ? 'voplica' : 'modelark' }
      await db.begin(async tx => {
        await lockOwner(tx, owner)
        await tx`INSERT INTO generations(id, owner_id, project_id, generator_id, draft, manifest)
          VALUES (${generationId}, ${owner}, ${projects.get(owner)!}, ${`g-${generationId}`},
            ${tx.json(draft as unknown as postgres.JSONValue)}, ${tx.json(manifest as unknown as postgres.JSONValue)})`
        await tx`INSERT INTO generation_takes(id, generation_id, status, reserved_bytes, lease_token, lease_until, next_attempt_at)
          VALUES (${takeId}, ${generationId}, ${status}, 100, ${status === 'preparing' ? randomUUID() : null},
            ${status === 'preparing' ? new Date(Date.now() + 60_000) : null}, now() + interval '1 day')`
        await reserveTakeTokens(tx, owner, takeId, 10)
      })
      return takeId
    }
    async function takeState(id: string) {
      const [take] = await db`SELECT status, token_state, reserved_bytes, lease_token, lease_until FROM generation_takes WHERE id = ${id}`
      return take!
    }
    await t.test('revoking 18+ cancels only unsubmitted adult-model jobs; blocking cancels the remaining queue', async () => {
      const owner = 'policy-cancel'
      await db`UPDATE app_users SET nsfw_enabled = true WHERE id = ${owner}`
      const adultQueued = await seedHeldTake(owner, 'h3-eros-max', 'queued')
      const adultPreparing = await seedHeldTake(owner, 'h3-eros-max', 'preparing')
      const regularQueued = await seedHeldTake(owner, 'seedream-5-pro', 'queued')
      const inFlight = await Promise.all(['submitting', 'running', 'ingesting', 'unknown'].map(async status =>
        ({ status, id: await seedHeldTake(owner, 'h3-eros-max', status) })))
      const otherUser = await seedHeldTake('policy-other', 'seedream-5-pro', 'queued')
      await db.begin(async tx => {
        await lockOwner(tx, owner)
        await tx`UPDATE app_users SET nsfw_enabled = false WHERE id = ${owner}`
        await cancelUnsubmittedForAccount(tx, owner, 'nsfw_disabled')
        await cancelUnsubmittedForAccount(tx, owner, 'nsfw_disabled')
      })
      for (const id of [adultQueued, adultPreparing]) {
        const state = await takeState(id)
        assert.equal(state.status, 'failed')
        assert.equal(state.token_state, 'released')
        assert.equal(Number(state.reserved_bytes), 0)
        assert.equal(state.lease_token, null)
        assert.equal(state.lease_until, null)
      }
      assert.equal((await takeState(regularQueued)).status, 'queued')
      assert.equal((await getWallet(owner)).reservedTokens, 50)
      await assert.rejects(assertGenerationPolicy(db, owner, 'h3-eros-max'), { statusCode: 403, data: { code: 'nsfw_disabled' } })
      await assertGenerationPolicy(db, owner, 'seedream-5-pro')
      await db.begin(async tx => {
        await lockOwner(tx, owner)
        await tx`UPDATE app_users SET blocked_at = now() WHERE id = ${owner}`
        await cancelUnsubmittedForAccount(tx, owner, 'account_blocked')
        await cancelUnsubmittedForAccount(tx, owner, 'account_blocked')
      })
      assert.equal((await takeState(regularQueued)).token_state, 'released')
      for (const accepted of inFlight) {
        const state = await takeState(accepted.id)
        assert.equal(state.status, accepted.status)
        assert.equal(state.token_state, 'reserved', 'Possible paid work must retain its reservation')
      }
      assert.equal((await takeState(otherUser)).status, 'queued', 'Policies affect only the target owner')
      await assert.rejects(assertGenerationPolicy(db, owner, 'seedream-5-pro'), { statusCode: 403, data: { code: 'account_blocked' } })
      const [balance] = await db`SELECT sum(reserved_delta)::int AS reserved,
        count(*) FILTER (WHERE kind = 'release')::int AS releases FROM token_ledger WHERE owner_id = ${owner}`
      assert.equal(balance!.reserved, 40)
      assert.equal(balance!.releases, 3, 'Repeated cancellation releases each hold once')

      // Keep these recovery fixtures out of the worker concurrency budget in subsequent scenarios.
      await db`UPDATE generation_takes SET status = 'unknown' WHERE id IN ${db(inFlight.map(take => take.id))}`
    })

    await t.test('worker rechecks a block or 18+ revocation after reference preparation and still drains accepted work', async () => {
      const owner = 'policy-worker'
      let submissions = 0, polls = 0
      const provider: GenerationProvider = {
        async image() { submissions++; throw new Error('A forbidden submission escaped the policy check') },
        async video() { submissions++; throw new Error('A forbidden submission escaped the policy check') },
        async poll() { polls++; return { status: 'failed', code: 'synthetic_confirmed_failure' } },
      }
      const blocked = await seedHeldTake(owner, 'seedream-5-pro', 'queued')
      await db`UPDATE generation_takes SET next_attempt_at = now() WHERE id = ${blocked}`
      assert.equal(await runGenerationWorkerOnce({ ...provider, async prepare() {
        await db`UPDATE app_users SET blocked_at = now() WHERE id = ${owner}`
        return { ready: true, references: [] }
      } }), true)
      assert.equal(submissions, 0)
      assert.equal((await takeState(blocked)).status, 'failed')
      assert.equal((await takeState(blocked)).token_state, 'released')

      await db`UPDATE app_users SET blocked_at = NULL, nsfw_enabled = true WHERE id = ${owner}`
      const restricted = await seedHeldTake(owner, 'h3-eros-max', 'queued')
      await db`UPDATE generation_takes SET next_attempt_at = now() WHERE id = ${restricted}`
      assert.equal(await runGenerationWorkerOnce({ ...provider, async prepare() {
        await db`UPDATE app_users SET nsfw_enabled = false WHERE id = ${owner}`
        return { ready: true, references: [] }
      } }), true)
      assert.equal(submissions, 0)
      assert.equal((await takeState(restricted)).status, 'failed')
      assert.equal((await takeState(restricted)).token_state, 'released')

      const accepted = await seedHeldTake(owner, 'h3-eros-max', 'running')
      await db`UPDATE app_users SET blocked_at = now(), nsfw_enabled = false WHERE id = ${owner}`
      await db`UPDATE generation_takes SET next_attempt_at = now(), provider_task_id = 'already-accepted-task' WHERE id = ${accepted}`
      assert.equal(await runGenerationWorkerOnce(provider), true)
      assert.equal(polls, 1, 'Blocking a user must not strand an already accepted provider task')
      assert.equal((await takeState(accepted)).status, 'failed')
      assert.equal((await takeState(accepted)).token_state, 'released')
      assert.equal(submissions, 0)
    })
  } finally {
    await closeDb()
    await admin`DROP SCHEMA IF EXISTS ${admin(schema)} CASCADE`
    await admin.end()
    for (const key of Object.keys(process.env)) if (!(key in env)) delete process.env[key]
    Object.assign(process.env, env)
  }
})
