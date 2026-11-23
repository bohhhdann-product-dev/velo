import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { once } from 'node:events'
import { createServer } from 'node:http'
import test from 'node:test'
import postgres from 'postgres'
import { createApp, createRouter, defineEventHandler, toNodeListener } from 'h3'
import { migrate } from '../../scripts/migrate.mjs'
import { closeDb, getDb } from '../../server/utils/db'
import { requireUser } from '../../server/utils/auth'
import { getAccountPolicy, isAdminUser } from '../../server/services/account-policy'
import { getAdminUser, grantAdminTokens, listAdminUsers, updateAdminSettings, updateAdminStatus } from '../../server/services/admin'
import { confirmCheckout, createCheckout, getWallet } from '../../server/services/billing'
import usersRoute from '../../server/api/admin/users/index.get'
import userRoute from '../../server/api/admin/users/[id].get'
import settingsRoute from '../../server/api/admin/users/[id]/settings.patch'
import grantsRoute from '../../server/api/admin/users/[id]/grants.post'
import statusRoute from '../../server/api/admin/users/[id]/status.patch'

const databaseUrl = process.env.VELA_TEST_DATABASE_URL
test('admin accounts: authorization, atomic grants, revisions, immutable audit and accurate deposits', {
  skip: !databaseUrl && 'Set VELA_TEST_DATABASE_URL to a loopback PostgreSQL database',
}, async t => {
  const url = new URL(databaseUrl!)
  assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname))
  const schema = `vela_admin_test_${randomUUID().replaceAll('-', '')}`
  const dbAdmin = postgres(url.toString(), { max: 1, onnotice: () => {} })
  const env = { ...process.env }
  const app = createApp({ debug: false })
  const router = createRouter()
  router.get('/api/admin/users', usersRoute)
  router.get('/api/admin/users/:id', userRoute)
  router.patch('/api/admin/users/:id/settings', settingsRoute)
  router.post('/api/admin/users/:id/grants', grantsRoute)
  router.patch('/api/admin/users/:id/status', statusRoute)
  router.get('/api/private', defineEventHandler(event => requireUser(event)))
  app.use(router)
  const server = createServer(toNodeListener(app))
  try {
    await dbAdmin`CREATE SCHEMA ${dbAdmin(schema)}`
    url.searchParams.set('search_path', schema)
    process.env.DATABASE_URL = url.toString()
    process.env.NODE_ENV = 'test'
    process.env.VELA_ALLOWED_ORIGINS = 'http://localhost:3000'
    process.env.VELA_AUTH_MODE = 'local'
    process.env.VELA_LOCAL_AUTH_TOKEN = 'synthetic-admin-test-token-never-used-outside-tests'
    process.env.VELA_LOCAL_USER_ID = 'admin-one'
    process.env.VELA_ADMIN_USER_IDS = 'admin-one, admin-two'
    process.env.VELA_DEMO_PAYMENTS_ENABLED = 'true'
    await migrate(process.env.DATABASE_URL)
    const db = getDb()
    await db`INSERT INTO app_users(id, display_name, email) VALUES
      ('admin-one', 'Admin One', 'admin@example.test'), ('admin-two', '', ''),
      ('alice', 'Alice', 'alice@example.test'), ('bob', 'Bob', 'bob@example.test'),
      ('untouched', '', '')`
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`
    const headers = { authorization: `Bearer ${process.env.VELA_LOCAL_AUTH_TOKEN}`, 'content-type': 'application/json' }
    const request = (path: string, method = 'GET', body?: unknown) => fetch(`${base}${path}`, {
      method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })

    await t.test('admin access is server allowlisted, ordinary users and forged identities cannot read or mutate', async () => {
      assert.equal((await fetch(`${base}/api/admin/users`)).status, 401)
      process.env.VELA_LOCAL_USER_ID = 'alice'
      for (const path of ['/api/admin/users', '/api/admin/users/bob']) {
        const response = await request(path)
        assert.equal(response.status, 403)
        assert.equal((await response.json()).data.code, 'not_admin')
        assert.equal(response.headers.get('cache-control'), 'private, no-store')
      }
      assert.equal((await request('/api/admin/users/bob/grants', 'POST', {
        actorId: 'admin-one', amount: 200, note: 'forged admin', expectedRevision: 1, mutationId: randomUUID(),
      })).status, 403)
      await assert.rejects(listAdminUsers('alice'), { statusCode: 403 })
      await assert.rejects(getAdminUser('alice', 'bob'), { statusCode: 403 })
      await assert.rejects(grantAdminTokens('alice', 'bob', { amount: 100, note: 'forged', expectedRevision: 1, mutationId: randomUUID() }), { statusCode: 403 })
      process.env.VELA_LOCAL_USER_ID = 'admin-one'
      assert.equal((await request('/api/admin/users')).status, 200)
      assert.equal((await fetch(`${base}/api/admin/users/bob/settings`, {
        method: 'PATCH', headers: { ...headers, origin: 'https://evil.example' }, body: '{}',
      })).status, 403)
      process.env.VELA_ADMIN_USER_IDS = ''
      assert.equal(isAdminUser('admin-one'), false)
      assert.equal((await request('/api/admin/users')).status, 403)
      process.env.VELA_ADMIN_USER_IDS = 'admin-one, admin-two'
    })

    await t.test('strict validation rejects privilege fields, nonintegral discounts, unsafe grants and missing reasons', async () => {
      const settings = { nsfwEnabled: true, discountPercent: 20, expectedRevision: 1, mutationId: randomUUID() }
      for (const changes of [{ isAdmin: true }, { discountPercent: 101 }, { discountPercent: -1 }, { discountPercent: 1.5 }, { nsfwEnabled: 'true' }, { expectedRevision: 0 }])
        assert.equal((await request('/api/admin/users/alice/settings', 'PATCH', { ...settings, ...changes })).status, 400)
      for (const amount of [-1, 0, 1.5, 1_000_001])
        assert.equal((await request('/api/admin/users/alice/grants', 'POST', { amount, note: 'test', expectedRevision: 1, mutationId: randomUUID() })).status, 400)
      assert.equal((await request('/api/admin/users/alice/status', 'PATCH', { blocked: true, reason: ' ', expectedRevision: 1, mutationId: randomUUID() })).status, 400)
      assert.equal((await request('/api/admin/users?pageSize=101')).status, 400)
      assert.equal((await request('/api/admin/users?sort=owner_id')).status, 400)
      assert.equal((await request('/api/admin/users/no-such-user')).status, 404)
      assert.equal((await getAdminUser('admin-one', 'alice')).user.revision, 1)
    })

    await t.test('concurrent retries grant once, stale edits cannot overwrite and idempotency is actor scoped', async () => {
      await getWallet('alice')
      const grant = { amount: 1250, note: 'Support credit', expectedRevision: 1, mutationId: randomUUID() }
      const results = await Promise.all(Array.from({ length: 12 }, () => grantAdminTokens('admin-one', 'alice', grant)))
      assert.ok(results.every(result => result.user.balance === 1750 && result.user.revision === 2))
      const [count] = await db`SELECT count(*)::int AS count FROM admin_audit WHERE target_id = 'alice'`
      assert.equal(count!.count, 1)
      assert.equal((await getWallet('alice')).availableTokens, 1750)
      await assert.rejects(grantAdminTokens('admin-one', 'alice', { ...grant, amount: 1251 }), { statusCode: 409, data: { code: 'mutation_id_reused' } })
      await assert.rejects(grantAdminTokens('admin-one', 'bob', grant), { statusCode: 409, data: { code: 'mutation_id_reused' } })
      await assert.rejects(updateAdminSettings('admin-one', 'alice', { nsfwEnabled: true, discountPercent: 50, expectedRevision: 1, mutationId: randomUUID() }), { statusCode: 409, data: { code: 'revision_conflict' } })
      const edited = await updateAdminSettings('admin-one', 'alice', { nsfwEnabled: true, discountPercent: 25, expectedRevision: 2, mutationId: randomUUID() })
      assert.equal(edited.user.revision, 3)
      assert.equal(edited.user.discountPercent, 25)
      assert.equal(edited.user.nsfwEnabled, true)
      const replay = await grantAdminTokens('admin-one', 'alice', grant)
      assert.equal(replay.user.revision, 3, 'Idempotent replay returns current state, not stale response')
      const updated = await grantAdminTokens('admin-two', 'alice', { ...grant, amount: 50, expectedRevision: 3 })
      assert.equal(updated.user.balance, 1800, 'Same request UUID from another admin is independent')
      const noop = { nsfwEnabled: true, discountPercent: 25, expectedRevision: updated.user.revision, mutationId: randomUUID() }
      assert.equal((await updateAdminSettings('admin-one', 'alice', noop)).user.revision, updated.user.revision)
      await updateAdminSettings('admin-one', 'alice', noop)
      const [noops] = await db`SELECT count(*)::int AS count FROM admin_audit WHERE request_id = ${noop.mutationId}`
      assert.equal(noops!.count, 1)
      const policy = await getAccountPolicy(db, 'alice')
      assert.deepEqual(policy, { nsfwEnabled: true, discountPercent: 25, blocked: false, revision: 4 })
    })

    await t.test('same actor request racing across targets cannot grant twice', async () => {
      const input = { amount: 5, note: 'Concurrent targets', expectedRevision: 1, mutationId: randomUUID() }
      const results = await Promise.allSettled(['bob', 'untouched'].map(id => grantAdminTokens('admin-one', id, input)))
      assert.equal(results.filter(result => result.status === 'fulfilled').length, 1)
      const rejected = results.find(result => result.status === 'rejected') as PromiseRejectedResult
      assert.equal(rejected.reason.data.code, 'mutation_id_reused')
      const [count] = await db`SELECT count(*)::int AS count FROM token_ledger WHERE kind = 'admin_grant' AND label = 'Concurrent targets'`
      assert.equal(count!.count, 1)
    })

    await t.test('successful HTTP mutations persist and replay through the same guarded routes', async () => {
      const before = await getAdminUser('admin-one', 'bob')
      const body = { amount: 75, note: 'HTTP support grant', expectedRevision: before.user.revision, mutationId: randomUUID() }
      const response = await request('/api/admin/users/bob/grants', 'POST', body)
      assert.equal(response.status, 200)
      const granted = await response.json()
      assert.equal(granted.user.balance, before.user.balance + 75)
      const replay = await request('/api/admin/users/bob/grants', 'POST', body)
      assert.equal((await replay.json()).user.balance, granted.user.balance)
      const updated = await request('/api/admin/users/bob/settings', 'PATCH', {
        nsfwEnabled: true, discountPercent: 0, expectedRevision: granted.user.revision, mutationId: randomUUID(),
      })
      assert.equal(updated.status, 200)
      assert.equal((await updated.json()).user.nsfwEnabled, true)
    })

    await t.test('true deposits exclude grants, pending checkouts and simulated purchases', async () => {
      const checkout = await createCheckout('alice', { packId: 'starter', idempotencyKey: randomUUID() })
      await confirmCheckout('alice', checkout.id)
      await createCheckout('alice', { packId: 'creator', idempotencyKey: randomUUID() })
      let alice = await getAdminUser('admin-one', 'alice')
      assert.equal(alice.user.depositedCents, 0)
      assert.equal(alice.user.testDepositedCents, 1000)
      assert.equal(alice.transactions.filter(entry => entry.kind === 'test_purchase').length, 1)
      assert.equal(alice.transactions.filter(entry => entry.kind === 'grant').length, 3, 'Welcome and two admin grants are separate from purchases')
      // Synthetic isolated database fixture only: production has no live payment callback yet.
      await db`INSERT INTO token_checkouts(id, owner_id, idempotency_key, pack_id, tokens, price_cents, status, payment_mode, paid_at)
        VALUES (${randomUUID()}, 'alice', ${randomUUID()}, 'fixture', 7000, 700, 'paid', 'live', now())`
      alice = await getAdminUser('admin-one', 'alice')
      assert.equal(alice.user.depositedCents, 700)
      assert.equal(alice.transactions.filter(entry => entry.kind === 'deposit').length, 1)
      const list = await listAdminUsers('admin-one', { sort: 'deposits', pageSize: 1 })
      assert.equal(list.users[0]!.id, 'alice')
      assert.equal(list.total, 5)
      assert.equal(list.stats.totalDepositedCents, 700)
      assert.equal((await listAdminUsers('admin-one', { q: 'alice@' })).total, 1)
      assert.equal((await listAdminUsers('admin-one', { q: '%' })).total, 0)
      assert.equal((await listAdminUsers('admin-one', { filter: 'discounted' })).total, 1)
      assert.equal((await listAdminUsers('admin-one', { page: 2, pageSize: 3 })).users.length, 2)
      assert.equal((await getAdminUser('admin-one', 'untouched')).user.name, 'untouched')
    })

    await t.test('blocking takes effect on the next authenticated request, preserves funds, protects admins', async () => {
      const before = await getAdminUser('admin-one', 'alice')
      const blocked = await updateAdminStatus('admin-one', 'alice', { blocked: true, reason: 'Manual review', expectedRevision: before.user.revision, mutationId: randomUUID() })
      assert.equal(blocked.user.blocked, true)
      assert.equal(blocked.user.balance, before.user.balance)
      process.env.VELA_LOCAL_USER_ID = 'alice'
      const response = await request('/api/private')
      assert.equal(response.status, 403)
      assert.equal((await response.json()).data.code, 'account_blocked')
      assert.equal((await request('/api/admin/users')).status, 403)
      process.env.VELA_LOCAL_USER_ID = 'admin-one'
      const filtered = await listAdminUsers('admin-one', { filter: 'blocked' })
      assert.equal(filtered.total, 1)
      assert.equal(filtered.stats.activeUsers, 4)
      await updateAdminStatus('admin-one', 'alice', { blocked: false, reason: '', expectedRevision: blocked.user.revision, mutationId: randomUUID() })
      process.env.VELA_LOCAL_USER_ID = 'alice'
      assert.equal((await request('/api/private')).status, 200)
      process.env.VELA_LOCAL_USER_ID = 'admin-one'
      for (const id of ['admin-one', 'admin-two'])
        await assert.rejects(updateAdminStatus('admin-one', id, { blocked: true, reason: 'Forbidden', expectedRevision: 1, mutationId: randomUUID() }), { statusCode: 409, data: { code: 'protected_admin' } })
      await db`UPDATE app_users SET blocked_at = now() WHERE id = 'admin-two'`
      await assert.rejects(listAdminUsers('admin-two'), { statusCode: 403, data: { code: 'account_blocked' } })
      await assert.rejects(grantAdminTokens('admin-two', 'alice', { amount: 1, note: 'Denied', expectedRevision: 6, mutationId: randomUUID() }), { statusCode: 403, data: { code: 'account_blocked' } })
    })

    await t.test('audit and money ledger remain immutable and bounded history signals truncation', async () => {
      await assert.rejects(db`UPDATE admin_audit SET reason = 'tampered' WHERE target_id = 'alice'`)
      await assert.rejects(db`DELETE FROM admin_audit WHERE target_id = 'alice'`)
      await assert.rejects(db`UPDATE token_ledger SET amount = 999999 WHERE owner_id = 'alice'`)
      const detail = await getAdminUser('admin-one', 'alice')
      assert.ok(detail.activity.every(entry => entry.actorId === 'admin-one' || entry.actorId === 'admin-two'))
      assert.equal(detail.historyTruncated, false)
      await db`INSERT INTO token_ledger(id, owner_id, kind, amount, idempotency_key, label)
        SELECT gen_random_uuid(), 'untouched', 'admin_grant', 1, 'fixture:' || s, 'Bounded history fixture'
        FROM generate_series(1, 101) s`
      const truncated = await getAdminUser('admin-one', 'untouched')
      assert.equal(truncated.transactions.length, 100)
      assert.equal(truncated.historyTruncated, true)
    })
  } finally {
    if (server.listening) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
    await closeDb()
    await dbAdmin`DROP SCHEMA IF EXISTS ${dbAdmin(schema)} CASCADE`
    await dbAdmin.end()
    for (const key of Object.keys(process.env)) if (!(key in env)) delete process.env[key]
    Object.assign(process.env, env)
  }
})
