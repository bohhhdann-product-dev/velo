import { registerHooks } from 'node:module'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import assert from 'node:assert/strict'

registerHooks({
  resolve(specifier, context, next) {
    if (specifier.startsWith('.') && context.parentURL?.endsWith('.ts') && !specifier.endsWith('.ts'))
      return next(specifier + '.ts', context)
    return next(specifier, context)
  },
  load(url, context, next) {
    if (!url.endsWith('.ts')) return next(url, context)
    return { format: 'module', shortCircuit: true,
      source: ts.transpileModule(readFileSync(fileURLToPath(url), 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
      }).outputText }
  },
})
const { createAdminClient } = await import('../app/features/admin/adminClient.ts')
const { ApiError } = await import('../app/shared/api/workspace.ts')
const user = (id, revision = 0, balance = 20) => ({
  id, name: id, email: `${id}@example.test`, joinedAt: 1, nsfwEnabled: false,
  discountPercent: 0, blocked: false, blockReason: '', revision, isAdmin: false,
  balance, reservedTokens: 0, depositedCents: 0, testDepositedCents: 100,
})
const detail = (id, revision = 0, balance = 20) => ({ user: user(id, revision, balance), transactions: [], activity: [], historyTruncated: false })
const listing = (id) => ({ users: [user(id)], total: 1, page: 1, pageSize: 30,
  stats: { totalUsers: 1, activeUsers: 1, totalDepositedCents: 0 }, actorId: 'admin' })
const query = { q: '', filter: 'all', sort: 'newest', page: 1 }
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r }); return { promise, resolve } }

// A slow earlier read cannot put the previous selected user's data in the panel.
const reads = new Map()
const client = createAdminClient(path => { const d = deferred(); reads.set(path, d); return d.promise }, () => 1)
const first = client.loadUser('first')
const second = client.loadUser('second')
reads.get('/api/admin/users/second').resolve(detail('second'))
await second
reads.get('/api/admin/users/first').resolve(detail('first'))
await first
assert.equal(client.detail.value.user.id, 'second')
assert.equal(client.selectedId.value, 'second')

// Search results also follow latest query, independent of network arrival order.
const oldList = client.loadUsers(query)
const newList = client.loadUsers({ ...query, q: 'new' })
reads.get('/api/admin/users?q=new&filter=all&sort=newest&page=1').resolve(listing('new'))
await newList
reads.get('/api/admin/users?q=&filter=all&sort=newest&page=1').resolve(listing('old'))
await oldList
assert.equal(client.directory.value.users[0].id, 'new')

// A session change clears everything and late writes/reads cannot rehydrate it.
let session = 1
const response = deferred()
const owned = createAdminClient(() => response.promise, () => session)
const loading = owned.loadUser('private')
session++; owned.clear(); response.resolve(detail('private')); await loading
assert.equal(owned.detail.value, null)
assert.equal(owned.selectedId.value, null)

// A grant that committed but lost its ACK is retried exactly, without optimistic credit.
const calls = []
let loseResponse = true
const grants = createAdminClient(async (path, options) => {
  if (!options) return detail('member', 8)
  calls.push({ path, body: structuredClone(options.body), method: options.method })
  if (loseResponse) throw new Error('Connection lost after commit')
  return detail('member', 9, 520)
}, () => 1)
await grants.loadUser('member')
assert.equal(await grants.mutate({ kind: 'grants', payload: { amount: 500, note: 'Welcome' } }), false)
assert.equal(grants.detail.value.user.balance, 20, 'never show tokens before server confirmation')
assert.equal(grants.locked.value, true)
await grants.loadUser('other')
assert.equal(grants.selectedId.value, 'member', 'unknown grant locks account selection')
await grants.mutate({ kind: 'grants', payload: { amount: 900, note: 'Changed draft' } })
assert.equal(calls.length, 1, 'a new payload cannot replace the unconfirmed grant')
loseResponse = false
assert.equal(await grants.retry(), true)
assert.deepEqual(calls[0], calls[1], 'retry retains the exact payload, revision and mutation ID')
assert.equal(calls[0].body.expectedRevision, 8)
assert.match(calls[0].body.mutationId, /^[0-9a-f-]{36}$/i)
assert.equal(grants.detail.value.user.balance, 520)
assert.equal(grants.locked.value, false)
assert.equal(grants.confirmed.value.kind, 'grants')

// Revision conflicts need an explicit refresh before accepting a new operation.
let revision = 2, conflict = true, attempts = 0
const revisions = createAdminClient(async (_path, options) => {
  if (!options) return detail('member', revision)
  attempts++
  if (conflict) throw new ApiError(409, 'Changed', 'revision_conflict')
  assert.equal(options.body.expectedRevision, 3)
  return detail('member', 4)
}, () => 1)
await revisions.loadUser('member')
await revisions.mutate({ kind: 'settings', payload: { nsfwEnabled: true, discountPercent: 25 } })
assert.equal(revisions.action.value.conflict, true)
assert.equal(revisions.detail.value.user.revision, 2, 'keep current detail for preserving form drafts')
await revisions.mutate({ kind: 'settings', payload: { nsfwEnabled: true, discountPercent: 25 } })
assert.equal(attempts, 1)
revision = 3; conflict = false
await revisions.loadUser('member', true)
assert.equal(revisions.action.value.conflict, false)
assert.equal(await revisions.mutate({ kind: 'settings', payload: { nsfwEnabled: true, discountPercent: 25 } }), true)

// Revoked admin access must clear previously displayed private records immediately.
let forbidden = false
const restricted = createAdminClient(async (path) => {
  if (forbidden) throw new ApiError(403, 'Forbidden', 'not_admin')
  return path.includes('?') ? listing('private') : detail('private')
}, () => 1)
await restricted.loadUsers(query); await restricted.loadUser('private')
forbidden = true
await restricted.mutate({ kind: 'grants', payload: { amount: 1, note: '' } })
assert.equal(restricted.directory.value, null)
assert.equal(restricted.detail.value, null)
assert.equal(restricted.selectedId.value, null)
assert.match(restricted.accessError.value, /administrator access/)
assert.equal(restricted.confirmed.value, null)

// Concurrent submit/retry cannot issue two requests, including an in-flight response after logout.
const mutationResponse = deferred()
let mutations = 0, owner = 1
const inFlight = createAdminClient(async (_path, options) => {
  if (!options) return detail('private')
  mutations++; return mutationResponse.promise
}, () => owner)
await inFlight.loadUser('private')
const saving = inFlight.mutate({ kind: 'grants', payload: { amount: 500, note: '' } })
await inFlight.mutate({ kind: 'grants', payload: { amount: 500, note: '' } })
assert.equal(mutations, 1)
owner++; inFlight.clear(); mutationResponse.resolve(detail('private', 1, 520))
assert.equal(await saving, false)
assert.equal(inFlight.detail.value, null)
assert.equal(inFlight.confirmed.value, null)
console.log('Admin client checks passed: stale reads, session isolation, exact grant retries, revision conflicts, revoked access, duplicate submissions.')
