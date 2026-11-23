import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import postgres from 'postgres'
import sharp from 'sharp'
import { migrate } from '../../scripts/migrate.mjs'
import { getDb, closeDb } from '../../server/utils/db'
import { createProject, updateProject, deleteProject } from '../../server/services/projects'
import { createCharacter, updateCharacter, approveCharacter, buildCharacterSheet, publishCharacter, deleteCharacter } from '../../server/services/characters'
import { uploadImage } from '../../server/services/media'
import { compactMutationReplies } from '../../server/services/mutation-receipts'

const databaseUrl = process.env.VELA_TEST_DATABASE_URL
test('receipts replay for seven days, compact in bounded batches, and reject expired retries without execution', {
  skip: !databaseUrl && 'Set VELA_TEST_DATABASE_URL to a loopback PostgreSQL database',
}, async () => {
  const url = new URL(databaseUrl!)
  assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname))
  const schema = `vela_receipts_test_${randomUUID().replaceAll('-', '')}`
  const admin = postgres(url.toString(), { max: 1, onnotice: () => {} })
  const directory = await mkdtemp(join(tmpdir(), 'vela-receipts-'))
  const env = { ...process.env }
  try {
    await admin`CREATE SCHEMA ${admin(schema)}`
    url.searchParams.set('search_path', schema)
    process.env.DATABASE_URL = url.toString()
    process.env.VELA_STORAGE_DRIVER = 'local'
    process.env.VELA_STORAGE_DIR = directory
    await migrate(process.env.DATABASE_URL)
    const db = getDb()
    await db`INSERT INTO app_users(id) VALUES ('receipt-user')`
    const owner = 'receipt-user'
    const accepted: { replay: () => Promise<unknown>; reply: unknown }[] = []
    async function remember<T>(replay: () => Promise<T>): Promise<T> {
      const reply = await replay()
      accepted.push({ replay, reply })
      return reply
    }
    const image = await sharp({ create: { width: 16, height: 16, channels: 3, background: '#a31c24' } }).png().toBuffer()
    const uploadKey = randomUUID()
    const asset = await remember(() => uploadImage(owner, image, 'image/png', 'receipt-fixture', uploadKey))
    const create = { name: 'Receipt', handle: 'receipt', clientMutationId: randomUUID() }
    let character: any = await remember(() => createCharacter(owner, create))
    const id = character.id
    const edit = { expectedRevision: character.storageRevision, clientMutationId: randomUUID(), character: {
      name: 'Receipt', handle: 'receipt', face: { photos: { front: { assetId: asset.id } }, notes: '' },
      body: { photos: { front: { assetId: asset.id } }, notes: '' },
    } }
    character = await remember(() => updateCharacter(owner, id, edit))
    const face = { stage: 'face', expectedRevision: character.storageRevision, clientMutationId: randomUUID() }
    character = await remember(() => approveCharacter(owner, id, face))
    const body = { stage: 'body', expectedRevision: character.storageRevision, clientMutationId: randomUUID() }
    character = await remember(() => approveCharacter(owner, id, body))
    const sheet = { expectedRevision: character.storageRevision, clientMutationId: randomUUID() }
    character = await remember(() => buildCharacterSheet(owner, id, sheet))
    // Force a duplicate's receipt miss -> another commit -> snapshot read ordering
    // with a table lock in this isolated schema. No production-only test hook needed.
    const [sheetReceipt] = await db`SELECT request_hash, response FROM character_mutations
      WHERE character_id = ${id} AND mutation_id = ${sheet.clientMutationId}`
    await db`DELETE FROM character_mutations WHERE character_id = ${id} AND mutation_id = ${sheet.clientMutationId}`
    await db`UPDATE characters SET storage_revision = ${sheet.expectedRevision} WHERE id = ${id}`
    let locked!: () => void, release!: () => void
    const tableLocked = new Promise<void>((resolve) => { locked = resolve })
    const releaseTable = new Promise<void>((resolve) => { release = resolve })
    const committingDuplicate = db.begin(async (tx) => {
      await tx`LOCK TABLE characters IN ACCESS EXCLUSIVE MODE`
      locked()
      await releaseTable
      await tx`UPDATE characters SET storage_revision = ${character.storageRevision} WHERE id = ${id}`
      await tx`INSERT INTO character_mutations(character_id, owner_id, mutation_id, request_hash, response)
        VALUES (${id}, ${owner}, ${sheet.clientMutationId}, ${sheetReceipt!.request_hash}, ${tx.json(sheetReceipt!.response)})`
    })
    await tableLocked
    const duplicate = buildCharacterSheet(owner, id, sheet).then(value => ({ value }), error => ({ error }))
    try {
      const deadline = Date.now() + 2000
      while (true) {
        const [waiting] = await db`SELECT EXISTS (SELECT 1 FROM pg_locks WHERE relation = 'characters'::regclass AND NOT granted) AS blocked`
        if (waiting!.blocked) break
        assert.ok(Date.now() < deadline, 'Duplicate must pass the receipt miss and wait for its character snapshot')
        await new Promise(resolve => setTimeout(resolve, 5))
      }
    } finally { release(); await committingDuplicate }
    const duplicateResult = await duplicate
    assert.ok('value' in duplicateResult, 'A duplicate commit between precheck and snapshot must replay, not conflict')
    assert.deepEqual(duplicateResult.value, character)
    const publish = { expectedRevision: character.storageRevision, clientMutationId: randomUUID() }
    character = await remember(() => publishCharacter(owner, id, publish))
    const removeCharacter = { expectedRevision: character.storageRevision, clientMutationId: randomUUID() }
    await remember(() => deleteCharacter(owner, id, removeCharacter))

    const projectInput = { title: 'Receipt project', nodes: [], edges: [], viewport: { x: 0, y: 0, scale: 1 }, clientMutationId: randomUUID() }
    let project = await remember(() => createProject(owner, projectInput))
    const projectId = project.id
    const projectEdit = { ...projectInput, title: 'Edited receipt project', expectedRevision: project.revision, clientMutationId: randomUUID() }
    project = await remember(() => updateProject(owner, projectId, projectEdit))
    const removeProject = { expectedRevision: project.revision, clientMutationId: randomUUID() }
    await remember(() => deleteProject(owner, projectId, removeProject))
    for (const request of accepted) assert.deepEqual(await request.replay(), request.reply, 'Accepted requests replay even after the resource is deleted')

    await db`UPDATE mutation_receipts SET created_at = now() - interval '8 days'`
    await db`UPDATE character_mutations SET created_at = now() - interval '8 days'`
    const snapshot = async () => {
      const [counts] = await db`SELECT (SELECT count(*)::int FROM projects) projects,
        (SELECT count(*)::int FROM characters) characters, (SELECT count(*)::int FROM assets) assets,
        (SELECT count(*)::int FROM character_versions) versions,
        (SELECT sum(revision)::int FROM projects) project_revisions,
        (SELECT sum(storage_revision)::int FROM characters) character_revisions`
      return counts
    }
    const before = await snapshot()
    const expired = (error: any) => error.statusCode === 410 && error.data.code === 'receipt_expired'
    for (const request of accepted) await assert.rejects(request.replay(), expired)
    assert.deepEqual(await snapshot(), before)
    await assert.rejects(createCharacter(owner, { ...create, name: 'Changed old key' }), { statusCode: 409 })
    await assert.rejects(uploadImage(owner, image, 'image/png', 'Changed old name', uploadKey), { statusCode: 409 })
    await assert.rejects(updateProject(owner, projectId, { ...projectEdit, title: 'Changed old key' }), { statusCode: 409 })

    const fullReplies = async () => {
      const [counts] = await db`SELECT (SELECT count(*)::int FROM mutation_receipts WHERE reply IS NOT NULL) receipts,
        (SELECT count(*)::int FROM character_mutations WHERE response IS NOT NULL) characters`
      return counts!
    }
    const full = await fullReplies()
    assert.deepEqual(await compactMutationReplies({ limit: 2 }), { mutationReceipts: 2, characterMutations: 2 })
    assert.deepEqual(await fullReplies(), full, 'Dry run must not compact anything')
    assert.deepEqual(await compactMutationReplies({ dryRun: false, limit: 2 }), { mutationReceipts: 2, characterMutations: 2 })
    assert.deepEqual(await fullReplies(), { receipts: full.receipts - 2, characters: full.characters - 2 })
    for (const request of accepted) await assert.rejects(request.replay(), expired)
    assert.deepEqual(await snapshot(), before, 'Compaction must never make expired mutations executable')
    const [keys] = await db`SELECT count(*)::int AS count FROM mutation_receipts WHERE fingerprint <> ''`
    assert.equal(keys!.count, full.receipts, 'Compaction preserves original mutation keys and fingerprints')

    const fresh = { name: 'Fresh', handle: 'fresh', clientMutationId: randomUUID() }
    const freshReply = await createCharacter(owner, fresh)
    await Promise.all([compactMutationReplies({ dryRun: false, limit: 100 }), compactMutationReplies({ dryRun: false, limit: 100 })])
    assert.deepEqual(await createCharacter(owner, fresh), freshReply, 'Fresh replies survive concurrent maintenance')
    assert.deepEqual(await fullReplies(), { receipts: 1, characters: 0 })
    for (const request of accepted) await assert.rejects(request.replay(), expired)
  } finally {
    await closeDb()
    await admin`DROP SCHEMA IF EXISTS ${admin(schema)} CASCADE`
    await admin.end()
    await rm(directory, { recursive: true, force: true })
    for (const key of Object.keys(process.env)) if (!(key in env)) delete process.env[key]
    Object.assign(process.env, env)
  }
})
