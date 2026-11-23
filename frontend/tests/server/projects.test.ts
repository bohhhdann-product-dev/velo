import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { generateKeyPairSync, randomUUID, sign } from 'node:crypto'
import test from 'node:test'
import postgres from 'postgres'
import { createApp, createRouter, toNodeListener } from 'h3'
import { migrate } from '../../scripts/migrate.mjs'
import { getDb, closeDb } from '../../server/utils/db'
import bootstrap from '../../server/api/bootstrap.get'
import indexGet from '../../server/api/projects/index.get'
import indexPost from '../../server/api/projects/index.post'
import itemGet from '../../server/api/projects/[id].get'
import itemPut from '../../server/api/projects/[id].put'
import itemDelete from '../../server/api/projects/[id].delete'

const databaseUrl = process.env.VELA_TEST_DATABASE_URL

test('PostgreSQL project API: auth, isolation, persistence, concurrency and receipts', { skip: !databaseUrl && 'Set VELA_TEST_DATABASE_URL to an isolated local PostgreSQL database' }, async (t) => {
  // These tests only create/drop their random schema, and refuse a remote database.
  const url = new URL(databaseUrl!)
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname), 'Tests require a loopback database')
  const schema = `vela_api_test_${randomUUID().replaceAll('-', '')}`
  const admin = postgres(databaseUrl!, { max: 1, onnotice: () => {} })
  const originalEnv = { ...process.env }
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
  const issuer = 'https://fixture.clerk.accounts.dev'
  const origin = 'http://localhost:3000'
  const ownerA = 'user_fixture_a'
  const ownerB = 'user_fixture_b'
  let base = ''
  const router = createRouter()
    .get('/api/bootstrap', bootstrap)
    .get('/api/projects', indexGet)
    .post('/api/projects', indexPost)
    .get('/api/projects/:id', itemGet)
    .put('/api/projects/:id', itemPut)
    .delete('/api/projects/:id', itemDelete)
  const app = createApp({ debug: false })
  app.use(router)
  const server = createServer(toNodeListener(app))

  function token(owner: string, overrides: Record<string, unknown> = {}, corrupt = false) {
    const now = Math.floor(Date.now() / 1000)
    const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: 'fixture', cat: 'cl_B7d4PD111AAA' })).toString('base64url')
    const payload = Buffer.from(JSON.stringify({ sub: owner, sid: 'sess_fixture', iss: issuer, azp: origin, iat: now, nbf: now - 1, exp: now + 300, ...overrides })).toString('base64url')
    const signed = sign('RSA-SHA256', Buffer.from(`${header}.${payload}`), privateKey).toString('base64url')
    return `${header}.${payload}.${corrupt ? `AAAA${signed.slice(4)}` : signed}`
  }
  async function call(method: string, path: string, body?: unknown, owner = ownerA, extraHeaders: Record<string, string> = {}) {
    const response = await fetch(`${base}${path}`, {
      method,
      headers: { authorization: `Bearer ${token(owner)}`, origin, ...(body ? { 'content-type': 'application/json' } : {}), ...extraHeaders },
      ...(body ? { body: JSON.stringify(body) } : {}),
    })
    return { status: response.status, body: await response.json(), headers: response.headers }
  }
  const generator = { id: 'gen_1', type: 'generator', x: 20, y: 40, draft: { modelId: 'seedream-5-pro', trial: false, mode: 'image', prompt: 'A persistent prompt', aspect: '1:1', imageQuality: '1k', videoQuality: '720p', durationS: 6, count: 2, referenceId: null } }
  const document = { title: 'Persistent board', nodes: [generator], edges: [], viewport: { x: 100, y: -50, scale: 0.8 }, clientMutationId: 'create_1' }
  let id = ''
  let assetId = ''
  let versionId = ''
  let versionAssetId = ''

  try {
    await admin`CREATE SCHEMA ${admin(schema)}`
    url.searchParams.set('search_path', schema)
    process.env.DATABASE_URL = url.toString()
    process.env.VELA_ALLOWED_ORIGINS = origin
    process.env.VELA_AUTH_MODE = 'clerk'
    process.env.CLERK_SECRET_KEY = 'sk_test_fixture_not_a_real_secret'
    process.env.CLERK_PUBLISHABLE_KEY = `pk_test_${Buffer.from('fixture.clerk.accounts.dev$').toString('base64')}`
    process.env.CLERK_ISSUER_URL = issuer
    process.env.CLERK_JWT_KEY = publicKey.export({ type: 'spki', format: 'pem' }).toString()
    await migrate(process.env.DATABASE_URL)
    await migrate(process.env.DATABASE_URL)
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}`

    await t.test('requires valid Clerk signature, issuer, expiry and authorized party', async () => {
      assert.equal((await fetch(`${base}/api/bootstrap`)).status, 401)
      for (const invalid of [
        token(ownerA, { exp: 1 }), token(ownerA, { iss: 'https://another.clerk.accounts.dev' }),
        token(ownerA, { azp: 'https://evil.example' }), token(ownerA, { azp: undefined }), token(ownerA, {}, true), 'not-a-jwt',
      ]) {
        const response = await call('GET', '/api/bootstrap', undefined, ownerA, { authorization: `Bearer ${invalid}` })
        assert.equal(response.status, 401)
      }
      const valid = await call('GET', '/api/bootstrap')
      assert.equal(valid.status, 200)
      assert.deepEqual(valid.body.user, { id: ownerA })
      assert.deepEqual(valid.body.projects, [])
      assert.deepEqual(valid.body.generations, [])
      assert.equal(valid.body.generationEnabled, false)
      assert.equal(valid.body.generation.enabled, false)
      assert.match(valid.headers.get('cache-control')!, /no-store/)
      assert.equal((await call('GET', '/api/bootstrap', undefined, ownerB)).status, 200)
    })

    await t.test('supports verified session cookies and rejects cross-site writes', async () => {
      const response = await fetch(`${base}/api/bootstrap`, { headers: {
        cookie: `__session=${token(ownerA)}; __client_uat=${Math.floor(Date.now() / 1000) - 1}; __clerk_db_jwt=fixture-browser`,
      } })
      assert.equal(response.status, 200)
      assert.equal((await call('POST', '/api/projects', document, ownerA, { origin: 'https://evil.example' })).status, 403)
      assert.equal((await call('POST', '/api/projects', { ...document, ownerId: ownerB })).status, 400)
    })

    await t.test('creates a durable project and replays simultaneous create retries exactly once', async () => {
      const [first, retry] = await Promise.all([call('POST', '/api/projects', document), call('POST', '/api/projects', document)])
      assert.equal(first.status, 201)
      assert.equal(retry.status, 201)
      assert.deepEqual(retry.body, first.body)
      id = first.body.project.id
      assert.equal(first.body.project.revision, 1)
      assert.deepEqual(first.body.project.nodes, document.nodes)
      assert.deepEqual(first.body.project.viewport, document.viewport)
      const [{ count }] = await getDb()`SELECT count(*)::int AS count FROM projects WHERE owner_id = ${ownerA}`
      assert.equal(count, 1)
      const reused = await call('POST', '/api/projects', { ...document, title: 'Changed payload' })
      assert.equal(reused.status, 409)
      assert.equal(reused.body.data.code, 'mutation_reused')
    })

    await t.test('denies other owners read/update/delete and omits their projects from lists', async () => {
      assert.equal((await call('GET', `/api/projects/${id}`, undefined, ownerB)).status, 404)
      assert.equal((await call('PUT', `/api/projects/${id}`, { ...document, expectedRevision: 1, clientMutationId: 'attack_update' }, ownerB)).status, 404)
      assert.equal((await call('DELETE', `/api/projects/${id}`, { expectedRevision: 1, clientMutationId: 'attack_delete' }, ownerB)).status, 404)
      assert.deepEqual((await call('GET', '/api/projects', undefined, ownerB)).body.projects, [])
      assert.equal((await call('GET', `/api/projects/${id}`)).body.project.revision, 1)
    })

    await t.test('persists edits across a new database pool and rejects stale concurrent saves', async () => {
      const update = { ...document, title: 'Edited', expectedRevision: 1, clientMutationId: 'update_1' }
      const first = await call('PUT', `/api/projects/${id}`, update)
      assert.equal(first.status, 200)
      assert.equal(first.body.project.revision, 2)
      assert.deepEqual((await call('PUT', `/api/projects/${id}`, update)).body, first.body)
      const conflict = await call('PUT', `/api/projects/${id}`, { ...update, clientMutationId: 'stale' })
      assert.equal(conflict.status, 409)
      assert.equal(conflict.body.data.code, 'revision_conflict')
      assert.equal(conflict.body.data.currentRevision, 2)
      const concurrent = await Promise.all(['a', 'b'].map((suffix) => call('PUT', `/api/projects/${id}`, { ...update, title: suffix, expectedRevision: 2, clientMutationId: `concurrent_${suffix}` })))
      assert.deepEqual(concurrent.map((result) => result.status).sort(), [200, 409])
      await closeDb()
      const restored = await call('GET', `/api/projects/${id}`)
      assert.equal(restored.body.project.revision, 3)
      assert.deepEqual(restored.body.project.nodes, document.nodes)
      // Replaying an older accepted mutation returns its result without writing over revision 3.
      assert.deepEqual((await call('PUT', `/api/projects/${id}`, update)).body, first.body)
      assert.equal((await call('GET', `/api/projects/${id}`)).body.project.revision, 3)
    })

    await t.test('checks asset ownership and immutable character version pins in the transaction', async () => {
      const sql = getDb()
      async function asset(owner: string, kind = 'upload') {
        const value = randomUUID()
        await sql`INSERT INTO assets(id, owner_id, name, kind, size_bytes, width, height, source_key, preview_key, sha256)
          VALUES (${value}, ${owner}, 'Fixture', ${kind}, 10, 1, 1, ${`${value}/source`}, ${`${value}/preview`}, 'fixture')`
        return value
      }
      assetId = await asset(ownerA)
      const otherAsset = await asset(ownerB)
      versionAssetId = await asset(ownerA, 'sheet')
      versionId = randomUUID()
      await sql`INSERT INTO characters(id, owner_id, document) VALUES ('char_fixture', ${ownerA}, ${sql.json({ characterVersionId: versionId, sheetAssetId: versionAssetId })})`
      await sql`INSERT INTO character_versions(id, character_id, owner_id, sheet_asset_id, document)
        VALUES (${versionId}, 'char_fixture', ${ownerA}, ${versionAssetId}, ${sql.json({})})`
      const reference = { id: 'ref', type: 'reference', x: 0, y: 0, name: 'Private image', assetId, assetKind: 'image' }
      const update = { ...document, nodes: [generator, reference], expectedRevision: 3, clientMutationId: 'with_asset' }
      const foreign = await call('PUT', `/api/projects/${id}`, { ...update, nodes: [generator, { ...reference, assetId: otherAsset }] })
      assert.equal(foreign.status, 404)
      assert.equal((await call('GET', `/api/projects/${id}`)).body.project.revision, 3)
      const mismatched = await call('PUT', `/api/projects/${id}`, { ...update, nodes: [{ ...reference, assetKind: 'character', characterVersionId: versionId }] })
      assert.equal(mismatched.status, 404)
      const accepted = await call('PUT', `/api/projects/${id}`, update)
      assert.equal(accepted.status, 200)
      assert.match(accepted.body.project.nodes[1].url, /^\/api\/assets\//)
      const [stored] = await sql`SELECT board FROM projects WHERE id = ${id}`
      assert.equal('url' in stored.board.nodes[1], false)
      const [receipt] = await sql`SELECT reply FROM mutation_receipts WHERE client_mutation_id = 'with_asset' AND owner_id = ${ownerA}`
      assert.equal('url' in receipt.reply.nodes[1], false)
      const pinned = await call('PUT', `/api/projects/${id}`, { ...update, expectedRevision: 4, clientMutationId: 'pin_character', nodes: [{ ...reference, assetId: versionAssetId, assetKind: 'character', characterVersionId: versionId }] })
      assert.equal(pinned.status, 200)
      assert.equal(pinned.body.project.nodes[0].characterVersionId, versionId)
      // The newer board removed the original image. Its old receipt must still replay
      // after that owned image is deleted; media delivery separately denies its bytes.
      await sql`UPDATE assets SET deleted_at = now() WHERE id = ${assetId}`
      const oldReceipt = await call('PUT', `/api/projects/${id}`, update)
      assert.equal(oldReceipt.status, 200)
      assert.deepEqual(oldReceipt.body, accepted.body)
      assert.equal((await call('GET', `/api/projects/${id}`)).body.project.revision, 5)
    })

    await t.test('requires the latest revision to delete and makes lost-delete-response retries safe', async () => {
      assert.equal((await call('DELETE', `/api/projects/${id}`, { clientMutationId: 'missing_revision' })).status, 400)
      assert.equal((await call('DELETE', `/api/projects/${id}`, { expectedRevision: 1, clientMutationId: 'stale_delete' })).status, 409)
      const payload = { expectedRevision: 5, clientMutationId: 'delete_1' }
      const deleted = await call('DELETE', `/api/projects/${id}`, payload)
      assert.equal(deleted.status, 200)
      assert.deepEqual(deleted.body, { deleted: true, id })
      assert.deepEqual((await call('DELETE', `/api/projects/${id}`, payload)).body, deleted.body)
      assert.equal((await call('GET', `/api/projects/${id}`)).status, 404)
      assert.deepEqual((await call('GET', '/api/projects')).body.projects, [])
      assert.equal((await call('POST', '/api/projects', { ...document, id, clientMutationId: 'recreate_deleted' })).status, 409)
    })
  } finally {
    if (server.listening) { server.close(); await once(server, 'close') }
    await closeDb()
    await admin`DROP SCHEMA ${admin(schema)} CASCADE`
    await admin.end()
    for (const key of Object.keys(process.env)) if (!(key in originalEnv)) delete process.env[key]
    Object.assign(process.env, originalEnv)
  }
})
