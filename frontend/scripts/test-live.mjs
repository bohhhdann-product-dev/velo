import { registerHooks } from 'node:module'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import assert from 'node:assert/strict'
registerHooks({
  resolve(specifier, context, next) {
    if (specifier.startsWith('~/'))
      return {
        url: new URL(`../app/${specifier.slice(2)}.ts`, import.meta.url).href,
        shortCircuit: true,
      }
    if (
      specifier.startsWith('.') &&
      context.parentURL?.endsWith('.ts') &&
      !specifier.endsWith('.ts')
    )
      return next(specifier + '.ts', context)
    return next(specifier, context)
  },
  load(url, context, next) {
    if (!url.endsWith('.ts')) return next(url, context)
    return {
      format: 'module',
      source: ts.transpileModule(readFileSync(fileURLToPath(url), 'utf8'), {
        compilerOptions: {
          module: ts.ModuleKind.ESNext,
          target: ts.ScriptTarget.ES2022,
        },
      }).outputText,
      shortCircuit: true,
    }
  },
})
const { createSaveQueue } = await import('../app/shared/persistence/saveQueue.ts')
const { projectPayload } = await import('../app/shared/persistence/projectPayload.ts')
const { createWorkspaceApi, ApiError } = await import('../app/shared/api/workspace.ts')
const deferred = () => {
  let resolve
  const promise = new Promise((r) => {
    resolve = r
  })
  return { promise, resolve }
}
const calls = [],
  saved = [],
  states = []
const first = deferred()
const queue = createSaveQueue({
  write: async (id, value, revision, mutationId) => {
    calls.push({ id, value, revision, mutationId })
    if (calls.length === 1) await first.promise
    return { revision: revision + 1 }
  },
  revision: (r) => r.revision,
  saved: (id, result, sent, unchanged) => saved.push({ id, sent, unchanged }),
  state: (id, state) => states.push(state),
})
queue.register('project', { title: 'Original' }, 3)
queue.update('project', { title: 'First edit' })
const writing = queue.flush('project')
queue.update('project', { title: 'Typed during save' })
assert.equal(calls.length, 1, 'only one mutation can be in flight')
first.resolve()
await writing
assert.deepEqual(
  calls.map((c) => [c.value.title, c.revision]),
  [
    ['First edit', 3],
    ['Typed during save', 4],
  ],
)
assert.equal(saved[0].unchanged, false, 'earlier response cannot overwrite later edits')
assert.equal(saved[1].unchanged, true)
queue.dispose()

const retryCalls = []
let fail = true
const retry = createSaveQueue({
  write: async (id, value, revision, mutationId) => {
    retryCalls.push({ value, revision, mutationId })
    if (fail) throw new Error('Response lost')
    return { revision: revision + 1 }
  },
  revision: (r) => r.revision,
  saved() {},
  state() {},
})
retry.register('p', { title: 'old' }, 1)
retry.update('p', { title: 'attempt' })
await assert.rejects(retry.flush('p'))
retry.update('p', { title: 'newer' })
fail = false
await retry.retry('p')
assert.deepEqual(
  retryCalls[0],
  retryCalls[1],
  'retry replays the same ID, revision and body after an uncertain result',
)
assert.equal(retryCalls[2].value.title, 'newer')
assert.equal(retryCalls[2].revision, 2)
retry.dispose()

let attempts = 0
const conflictStates = []
const conflict = createSaveQueue({
  write: async () => {
    attempts++
    throw new ApiError(409, 'Conflict', 'revision_conflict')
  },
  revision: (r) => r.revision,
  saved() {},
  state: (_, state) => conflictStates.push(state),
})
conflict.register('p', { text: '' }, 1)
conflict.update('p', { text: 'mine' })
await assert.rejects(conflict.flush('p'))
conflict.update('p', { text: 'keep editing' })
await assert.rejects(conflict.flush('p'))
assert.equal(attempts, 1, 'conflicts pause autosave')
assert.equal(conflictStates.at(-1).status, 'conflict')
conflict.dispose()

const abandoned = deferred()
let applied = 0
const sessionQueue = createSaveQueue({
  write: () => abandoned.promise,
  revision: () => 2,
  saved() {
    applied++
  },
  state() {},
})
sessionQueue.register('p', { text: '' }, 1)
sessionQueue.update('p', { text: 'private' })
const inFlight = sessionQueue.flush('p')
sessionQueue.dispose()
abandoned.resolve({})
await inFlight
assert.equal(applied, 0, 'old account response is discarded')

const originalFetch = globalThis.fetch
const pendingFetch = deferred()
globalThis.fetch = async () => {
  await pendingFetch.promise
  return new Response(JSON.stringify({ secret: 'old account' }))
}
const api = createWorkspaceApi(async () => 'token')
const response = api.request('/api/bootstrap')
await Promise.resolve()
api.cancel()
pendingFetch.resolve()
await assert.rejects(response, { name: 'AbortError' })
globalThis.fetch = originalFetch

const { createPinia, setActivePinia } = await import('pinia')
const { useWorkspaceStore } = await import('../app/stores/workspace.ts')
const { useStudioStore } = await import('../app/stores/studio.ts')
const { useCharactersStore } = await import('../app/stores/characters.ts')
setActivePinia(createPinia())
const workspace = useWorkspaceStore()
workspace.live = true
const studio = useStudioStore()
studio.seed()
assert.equal(studio.credits, 0)
assert.equal(studio.projects.length, 0)
assert.equal(studio.library.length, 0)
assert.equal(studio.generateFromNode('missing', 'missing').ok, false)
const project = {
  id: 'p',
  title: 'Board',
  createdAt: 1,
  revision: 2,
  nodes: [
    {
      id: 'ref',
      type: 'reference',
      assetId: 'asset-1',
      assetKind: 'character',
      characterVersionId: 'version-1',
      url: 'blob:temporary',
      name: 'Person',
      x: 0,
      y: 0,
    },
  ],
  edges: [],
  viewport: { x: 39, y: 81, scale: 0.7 },
}
const payload = projectPayload(project)
assert.equal('url' in payload.nodes[0], false)
assert.equal(payload.nodes[0].assetId, 'asset-1')
assert.equal(payload.nodes[0].characterVersionId, 'version-1')
assert.deepEqual(payload.viewport, project.viewport)
assert.throws(
  () =>
    projectPayload({
      ...project,
      nodes: [{ ...project.nodes[0], assetId: undefined }],
    }),
  /Upload/,
)
studio.hydrateLive([project], [])
studio.checkpoint('p')
studio.resetPrivate()
assert.equal(studio.projects.length, 0)
assert.deepEqual(studio.history, {})
assert.equal(studio.credits, 0)
useCharactersStore().resetPrivate()
console.log(
  'PASS: serialized saves, pending edits, exact retries, conflict stop, account cancellation, durable assets, live no-mock state and private history reset',
)

// Character approval must drain edits arriving during a pending PUT, then hold
// further autosaves until the authoritative action response has been reconciled.
setActivePinia(createPinia())
const actorWorkspace = useWorkspaceStore()
actorWorkspace.live = true
const actors = useCharactersStore()
const actor = {
  id: 'actor',
  name: 'Initial',
  handle: 'person',
  face: {
    photos: {
      front: { id: 'asset', assetId: 'asset', url: '/api/assets/asset/file', name: 'Portrait' },
    },
    notes: '',
    approved: false,
  },
  body: { photos: {}, notes: '', approved: false },
  sheetUrl: null,
  savedAt: null,
  revision: 1,
  storageRevision: 1,
  createdAt: 1,
}
let serverActor = structuredClone(actor)
const delayPut = deferred()
const delayAction = deferred()
let putCalls = 0
let actionStarted = false
actorWorkspace.request = async (_path, options) => {
  const sent = structuredClone(options.body.character)
  putCalls++
  if (putCalls === 1) await delayPut.promise
  serverActor = {
    ...serverActor,
    ...sent,
    face: { ...sent.face, approved: false },
    body: { ...sent.body, approved: false },
    storageRevision: serverActor.storageRevision + 1,
  }
  return { character: structuredClone(serverActor) }
}
actorWorkspace.mutate = async (_key, _path, options) => {
  actionStarted = true
  assert.equal(options.body.expectedRevision, serverActor.storageRevision)
  const canonical = structuredClone(serverActor)
  await delayAction.promise
  canonical.face.approved = true
  canonical.storageRevision++
  serverActor = canonical
  return { character: canonical }
}
actors.hydrateLive([actor])
actors.updateIdentity('actor', { name: 'Submitted' })
const approval = actors.approveAsync('actor', 'face')
actors.updateIdentity('actor', { name: 'Typed during flush' })
delayPut.resolve()
for (let i = 0; i < 20 && !actionStarted; i++) await Promise.resolve()
assert.equal(actionStarted, true)
assert.equal(
  serverActor.name,
  'Typed during flush',
  'approval flush must include edits made while PUT waits',
)
actors.updateIdentity('actor', { name: 'Typed during action' })
const beforeAction = putCalls
await new Promise((resolve) => setTimeout(resolve, 650))
assert.equal(putCalls, beforeAction, 'action owns the write lock')
delayAction.resolve()
await approval
assert.equal(
  actors.find('actor').name,
  'Typed during action',
  'canonical action response cannot erase later input',
)
await actors.flush('actor')
assert.equal(serverActor.name, 'Typed during action')
actors.resetPrivate()

const { createMutationRequests } = await import('../app/shared/persistence/mutationRequests.ts')
const operationCalls = []
let loseResponse = true
const mutations = createMutationRequests(async (path, options) => {
  operationCalls.push({ path, options })
  if (loseResponse) throw new Error('Connection closed after commit')
  return { id: 'created-once' }
})
await assert.rejects(
  mutations.run('create', '/api/projects', {
    method: 'POST',
    body: { title: 'First', clientMutationId: 'stable' },
  }),
)
loseResponse = false
await mutations.run('create', '/api/projects', {
  method: 'POST',
  body: { title: 'Later click', clientMutationId: 'different' },
})
assert.deepEqual(
  operationCalls[0],
  operationCalls[1],
  'create/delete/action retries replay the original operation',
)
assert.equal(mutations.has('create'), false)
console.log(
  'PASS: character edits during flush/action survive, action writes serialize, uncertain create/delete/action retries remain idempotent',
)

// Durable recovery follows the latest local payload until that same payload is acknowledged.
const storage = new Map()
globalThis.window = {
  localStorage: {
    get length() {
      return storage.size
    },
    key: (index) => [...storage.keys()][index] ?? null,
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value),
    removeItem: (key) => storage.delete(key),
  },
}
const { createDraftRecovery } = await import('../app/shared/persistence/recovery.ts')
const journal = createDraftRecovery()
setActivePinia(createPinia())
const recoveryWorkspace = useWorkspaceStore()
recoveryWorkspace.live = true
recoveryWorkspace.userId = 'user-a'
const recoveredStudio = useStudioStore()
recoveredStudio.hydrateLive([structuredClone(project)], [])
const firstSave = deferred(),
  secondSave = deferred()
let saveCount = 0
recoveryWorkspace.request = async (_path, options) => {
  const body = structuredClone(options.body)
  saveCount++
  await (saveCount === 1 ? firstSave.promise : secondSave.promise)
  return { project: { ...project, ...body, revision: body.expectedRevision + 1 } }
}
recoveredStudio.renameProject('p', 'First unsent title')
assert.equal(journal.list('user-a')[0].payload.title, 'First unsent title')
assert.equal(journal.list('user-b').length, 0)
const recoveringSave = recoveredStudio.retryProjectSave('p')
recoveredStudio.renameProject('p', 'Latest unsent title')
firstSave.resolve()
for (let i = 0; i < 20 && saveCount < 2; i++) await Promise.resolve()
assert.equal(
  journal.list('user-a')[0].payload.title,
  'Latest unsent title',
  'an earlier acknowledgement must not erase a newer recovery copy',
)
secondSave.resolve()
await recoveringSave
assert.equal(journal.list('user-a').length, 0)
recoveredStudio.renameProject('p', 'Keep across refresh')
recoveredStudio.resetPrivate()
assert.equal(
  journal.list('user-a')[0].payload.title,
  'Keep across refresh',
  'store disposal must retain the recovery candidate',
)
journal.clearUser('user-a')
assert.equal(journal.list('user-a').length, 0)
delete globalThis.window
console.log(
  'PASS: newest recovery copy survives earlier acknowledgements and store disposal; current acknowledgement and explicit sign-out cleanup remove it',
)

setActivePinia(createPinia())
const switchedWorkspace = useWorkspaceStore()
switchedWorkspace.live = true
const switchedStudio = useStudioStore()
const lateCreate = deferred()
let creationKey
switchedWorkspace.mutate = async (key) => {
  creationKey = key
  await lateCreate.promise
  return { project: structuredClone(project) }
}
const creating = switchedStudio.createProjectAsync()
switchedWorkspace.disconnect()
switchedStudio.resetPrivate()
lateCreate.resolve()
await assert.rejects(creating, { name: 'AbortError' })
assert.equal(creationKey, 'project:create')
assert.equal(
  switchedStudio.projects.length,
  0,
  'late mutation continuations must not repopulate a switched account',
)
console.log(
  'PASS: project create uses retained mutation workflow and late account responses cannot repopulate the store',
)

actors.hydrateLive([structuredClone(actor)])
actorWorkspace.mutate = async () => {
  throw new ApiError(409, 'Revision conflict', 'stale_character_revision')
}
await assert.rejects(actors.approveAsync('actor', 'face'))
assert.equal(actors.saveStates.actor.status, 'conflict')
actors.updateIdentity('actor', { name: 'Keep this local edit' })
await assert.rejects(actors.flush('actor'), /paused/)
assert.equal(actors.find('actor').name, 'Keep this local edit')
actors.resetPrivate()
console.log(
  'PASS: approval conflicts pause writes and expose reload while retaining local input',
)

const { computed, effectScope } = await import('vue')
const { useCanvasSelection } = await import(
  '../app/features/canvas/composables/useCanvasSelection.ts'
)
setActivePinia(createPinia())
const teardownWorkspace = useWorkspaceStore()
teardownWorkspace.live = true
const teardownStudio = useStudioStore()
teardownStudio.hydrateLive([structuredClone(project)], [])
const selectionScope = effectScope()
const mountedSelection = selectionScope.run(() =>
  useCanvasSelection(
    computed(() => teardownStudio.project('p')),
    (node) => ({ x: node.x, y: node.y, w: 100, h: 100 }),
  ),
)
mountedSelection.select(['ref'])
mountedSelection.selectedEdge.value = 'old-edge'
assert.doesNotThrow(
  () => teardownStudio.resetPrivate(),
  'sign-out/HMR clears the store before the mounted canvas is unmounted',
)
assert.equal(mountedSelection.selectedIds.value.size, 0)
assert.equal(mountedSelection.selectedNodes.value.length, 0)
assert.equal(mountedSelection.selectedEdge.value, null)
assert.deepEqual(mountedSelection.groups.value, [])
selectionScope.stop()
console.log(
  'PASS: active canvas selection safely clears when its project disappears before component teardown',
)

// Real API + mutation registry + store: unreadable success bodies cannot lose a create ID.
for (const bodyFailure of ['truncated-json', 'broken-stream']) {
  setActivePinia(createPinia())
  const owner = useWorkspaceStore()
  owner.live = true
  owner.connect('response-owner', async () => 'test-token')
  const boards = useStudioStore()
  boards.hydrateLive([], [])
  const bodies = []
  globalThis.fetch = async (_path, options) => {
    bodies.push(JSON.parse(options.body))
    if (bodies.length === 1) {
      const body = bodyFailure === 'truncated-json' ? '{"project":' : new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('{"project":'))
          controller.error(new Error('Connection closed while reading response'))
        },
      })
      return new Response(body, { status: 201 })
    }
    return Response.json({ project: { ...project, ...bodies[0], id: 'created-once' } }, { status: 201 })
  }
  await assert.rejects(boards.createProjectAsync('First create'))
  assert.equal(owner.hasPendingMutation('project:create'), true)
  await boards.createProjectAsync('Later click')
  assert.deepEqual(bodies[1], bodies[0], `${bodyFailure}: replay must keep body and mutation ID`)
  assert.equal(boards.projects.length, 1)
  boards.resetPrivate()
  owner.disconnect()
}

// Expired replay is a reconciliation boundary, including when its error body is unreadable.
for (const body of ['{', JSON.stringify({ data: { code: 'receipt_expired' } })]) {
  setActivePinia(createPinia())
  const owner = useWorkspaceStore()
  owner.live = true
  owner.connect('expired-owner', async () => 'test-token')
  const boards = useStudioStore()
  boards.hydrateLive([], [])
  const bodies = []
  globalThis.fetch = async (_path, options) => {
    bodies.push(JSON.parse(options.body))
    if (bodies.length === 1) throw new Error('Original response lost')
    return new Response(body, { status: 410 })
  }
  await assert.rejects(boards.createProjectAsync())
  await assert.rejects(boards.createProjectAsync(), /Reload to check the saved result/)
  await assert.rejects(boards.createProjectAsync(), /Reload to check the saved result/)
  assert.deepEqual(bodies, [bodies[0], bodies[0], bodies[0]], '410 must never generate a new create identity')
  assert.equal(owner.hasPendingMutation('project:create'), true)
  assert.equal(boards.projects.length, 0)
  boards.resetPrivate()
  owner.disconnect()
}
globalThis.fetch = originalFetch
console.log('PASS: truncated/streamed 201 retries keep original create identity; expired replay never creates a fresh operation')

// Validate the actual error boundary, then exercise corrected character input through its store.
globalThis.fetch = async () => Response.json({ message: 'Choose another handle.', data: { code: 'handle_in_use' } }, { status: 409 })
const codedApi = createWorkspaceApi(async () => 'test-token')
await assert.rejects(codedApi.request('/api/characters/c', { method: 'PUT', body: {} }), { status: 409, code: 'handle_in_use' })
codedApi.cancel()
globalThis.fetch = originalFetch
for (const [status, code] of [[400, 'invalid_character'], [409, 'handle_in_use']]) {
  setActivePinia(createPinia())
  const owner = useWorkspaceStore()
  owner.live = true
  const people = useCharactersStore()
  people.hydrateLive([structuredClone(actor)])
  const writes = []
  owner.request = async (_path, options) => {
    writes.push(structuredClone(options.body))
    if (writes.length === 1) throw new ApiError(status, 'Choose another handle.', code)
    return { character: { ...actor, ...options.body.character, storageRevision: 2 } }
  }
  people.updateIdentity('actor', { handle: 'invalid handle' })
  await assert.rejects(people.flush('actor'))
  assert.equal(people.saveStates.actor.status, 'error', 'handle collision is not a revision conflict')
  assert.equal(people.saveStates.actor.code, code)
  people.updateIdentity('actor', { handle: 'corrected_handle' })
  await people.retrySave('actor')
  assert.equal(writes.length, 2)
  assert.equal(writes[1].character.handle, 'corrected_handle')
  assert.notEqual(writes[1].clientMutationId, writes[0].clientMutationId)
  assert.equal(writes[1].expectedRevision, writes[0].expectedRevision)
  assert.equal(people.saveStates.actor.status, 'saved')
  people.resetPrivate()
}

const expiredWrites = [], expiredStates = []
const expiredQueue = createSaveQueue({
  write: async (_id, value, revision, mutationId) => {
    expiredWrites.push({ value, revision, mutationId })
    throw new ApiError(410, 'Reload to reconcile this request.', 'receipt_expired')
  },
  revision: (result) => result.revision,
  saved() {},
  state: (_id, state) => expiredStates.push(state),
})
expiredQueue.register('p', { title: 'Saved' }, 1)
expiredQueue.update('p', { title: 'Old pending' })
await assert.rejects(expiredQueue.flush('p'))
assert.equal(expiredStates.at(-1).status, 'conflict')
expiredQueue.update('p', { title: 'Later edit' })
await assert.rejects(expiredQueue.retry('p'))
assert.deepEqual(expiredWrites[1], expiredWrites[0], 'expired autosave retains original identity until explicit reconciliation')
expiredQueue.dispose()
console.log('PASS: rejected validation retries corrected input with a new ID; handle collision codes survive; expired saves require reconciliation')

function liveEditor(kind) {
  setActivePinia(createPinia())
  const owner = useWorkspaceStore()
  owner.live = true
  owner.connect('shared-editor', async () => 'test-token')
  const store = kind === 'project' ? useStudioStore() : useCharactersStore()
  const id = kind === 'project' ? 'p' : 'actor'
  const hydrate = () => kind === 'project'
    ? store.hydrateLive([structuredClone(project)], [])
    : store.hydrateLive([structuredClone(actor)])
  hydrate()
  return {
    owner, store, id, hydrate,
    edit: (value) => kind === 'project' ? store.renameProject(id, value) : store.updateIdentity(id, { name: value }),
    flush: () => kind === 'project' ? store.retryProjectSave(id) : store.retrySave(id),
    remove: () => kind === 'project' ? store.deleteProjectAsync(id) : store.removeAsync(id),
    exists: () => kind === 'project' ? store.project(id) : store.find(id),
    reset: () => { store.resetPrivate(); owner.disconnect() },
  }
}
// A retained expired action unlocks only after the user explicitly reloads server state.
const expiredActor = liveEditor('character')
const expiredActions = []
let reloadedAction = false
globalThis.fetch = async (_path, options) => {
  if (options.method === 'GET') return Response.json({ character: { ...actor, storageRevision: 8 } })
  expiredActions.push(JSON.parse(options.body))
  if (!reloadedAction) return Response.json({ data: { code: 'receipt_expired' } }, { status: 410 })
  return Response.json({ character: { ...actor, storageRevision: 9, face: { ...actor.face, approved: true } } })
}
await assert.rejects(expiredActor.store.approveAsync('actor', 'face'), /Reload/)
assert.equal(expiredActor.store.saveStates.actor.status, 'conflict')
await assert.rejects(expiredActor.store.retrySave('actor'), /Reload/)
assert.deepEqual(expiredActions[0], expiredActions[1])
await expiredActor.store.reload('actor')
assert.equal(expiredActor.owner.hasPendingMutation('character:action:actor'), false)
reloadedAction = true
await expiredActor.store.approveAsync('actor', 'face')
assert.equal(expiredActions[2].expectedRevision, 8)
assert.notEqual(expiredActions[2].clientMutationId, expiredActions[0].clientMutationId)
expiredActor.reset()

// Delete holds the same queue as autosave, including after an ambiguous outcome.
for (const kind of ['project', 'character']) {
  const editor = liveEditor(kind)
  const deleteStarted = deferred(), deleteResult = deferred()
  const deletes = [], puts = []
  globalThis.fetch = async (_path, options) => {
    const body = JSON.parse(options.body)
    if (options.method === 'DELETE') {
      deletes.push(body)
      if (deletes.length === 1) {
        deleteStarted.resolve()
        await deleteResult.promise
        throw new Error('Delete committed; response lost')
      }
      return Response.json({ deleted: true })
    }
    puts.push(body)
    return new Response('{}', { status: 404 })
  }
  const deleting = assert.rejects(editor.remove(), /response lost/)
  await deleteStarted.promise
  editor.edit('Typed while delete is pending')
  await new Promise((resolve) => setTimeout(resolve, 650))
  assert.equal(puts.length, 0, `${kind}: delayed delete freezes autosave`)
  deleteResult.resolve()
  await deleting
  editor.edit('Typed after losing the response')
  if (kind === 'character') await assert.rejects(editor.store.approveAsync(editor.id, 'face'), /paused/)
  await assert.rejects(editor.flush(), /paused/)
  await new Promise((resolve) => setTimeout(resolve, 650))
  assert.equal(puts.length, 0, `${kind}: unresolved delete stays held even after another action attempt`)
  await editor.remove()
  assert.deepEqual(deletes[1], deletes[0], `${kind}: Retry Delete replays without flushing`)
  assert.equal(editor.exists(), undefined)
  editor.reset()
}

// A definite refusal releases the queue and saves edits typed during the failed delete.
for (const kind of ['project', 'character']) {
  const editor = liveEditor(kind)
  const deleteStarted = deferred(), deleteResult = deferred()
  const puts = []
  globalThis.fetch = async (_path, options) => {
    if (options.method === 'DELETE') {
      deleteStarted.resolve()
      await deleteResult.promise
      return Response.json({ message: 'Delete rejected.', data: { code: 'invalid_request' } }, { status: 400 })
    }
    const body = JSON.parse(options.body)
    puts.push(body)
    return Response.json(kind === 'project'
      ? { project: { ...project, ...body, revision: 3 } }
      : { character: { ...actor, ...body.character, storageRevision: 2 } })
  }
  const deleting = assert.rejects(editor.remove(), /Delete rejected/)
  await deleteStarted.promise
  editor.edit('Save after definite rejection')
  deleteResult.resolve()
  await deleting
  await editor.flush()
  assert.equal(puts.length, 1)
  assert.equal(kind === 'project' ? puts[0].title : puts[0].character.name, 'Save after definite rejection')
  assert.equal(editor.store.saveStates[editor.id].status, 'saved')
  editor.reset()
}
globalThis.fetch = originalFetch
console.log('PASS: project/character deletes pause autosave, replay exact pending deletes, and resume saves after definitive rejection')

// Two actual Pinia editors share one origin's storage, but never acknowledge each other's journal.
storage.clear()
globalThis.window = {
  localStorage: {
    get length() { return storage.size },
    key: (index) => [...storage.keys()][index] ?? null,
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value),
    removeItem: (key) => storage.delete(key),
  },
}
const sharedJournal = createDraftRecovery()
// Reloading after an expired committed delete removes the server ghost while preserving newer edits.
for (const kind of ['project', 'character']) {
  const editor = liveEditor(kind)
  const deletes = []
  globalThis.fetch = async (_path, options) => {
    assert.equal(options.method, 'DELETE', 'expired delete must keep autosave held')
    deletes.push(JSON.parse(options.body))
    if (deletes.length === 1) throw new Error('Committed delete response lost')
    return new Response('{', { status: 410 })
  }
  await assert.rejects(editor.remove(), /response lost/)
  editor.edit('Recover edits made after an uncertain delete')
  await assert.rejects(editor.remove(), /Reload to check the saved result/)
  await assert.rejects(editor.remove(), /Reload to check the saved result/)
  await assert.rejects(editor.flush(), /paused/)
  assert.deepEqual(deletes, [deletes[0], deletes[0], deletes[0]])
  const candidate = sharedJournal.list('shared-editor')[0]
  assert.equal(kind === 'project' ? candidate.payload.title : candidate.payload.name, 'Recover edits made after an uncertain delete')
  editor.reset()
  // The Reload workspace action reboots stores from bootstrap, which omits the deleted item.
  if (kind === 'project') editor.store.hydrateLive([], [])
  else editor.store.hydrateLive([])
  assert.equal(editor.exists(), undefined)
  assert.deepEqual(sharedJournal.list('shared-editor'), [candidate], 'reconciliation preserves recovery as a copy candidate')
  editor.reset()
  sharedJournal.clearUser('shared-editor')
}
globalThis.fetch = originalFetch
for (const kind of ['project', 'character']) {
  const firstEditor = liveEditor(kind)
  const secondEditor = liveEditor(kind)
  const acknowledge = async (_path, options) => kind === 'project'
    ? { project: { ...project, ...options.body, revision: 3 } }
    : { character: { ...actor, ...options.body.character, storageRevision: 2 } }
  firstEditor.owner.request = acknowledge
  secondEditor.owner.request = acknowledge
  firstEditor.edit('First editor unsaved')
  const firstCandidate = sharedJournal.list('shared-editor')[0]
  secondEditor.edit('Second editor saved')
  assert.equal(sharedJournal.list('shared-editor').length, 2)
  await secondEditor.flush()
  assert.deepEqual(sharedJournal.list('shared-editor'), [firstCandidate])

  // Reusing a mounted store after refresh/auth hydration is a new editing session too.
  firstEditor.hydrate()
  firstEditor.edit('New session after dismissing recovery')
  await firstEditor.flush()
  assert.deepEqual(sharedJournal.list('shared-editor'), [firstCandidate], 'new session ACK preserves dismissed candidate')
  assert.equal(sharedJournal.discard(firstCandidate), true)
  firstEditor.reset()
  secondEditor.reset()
  assert.equal(sharedJournal.list('shared-editor').length, 0)
}

// Keeping a conflict as a copy resolves only the snapshot that was actually copied.
for (const editDuring of ['none', 'copy', 'reload', 'lost-copy-response', 'reload-failure']) {
  sharedJournal.clearUser('shared-editor')
  const editor = liveEditor('project')
  const otherWriter = createDraftRecovery()
  otherWriter.save('shared-editor', 'project', 'p', { title: 'Other editor draft' }, 2)
  const otherCandidate = sharedJournal.list('shared-editor')[0]
  const copyStarted = deferred(), copyResult = deferred()
  const reloadStarted = deferred(), reloadResult = deferred()
  const copies = []
  let reloadCount = 0
  globalThis.fetch = async (path, options) => {
    if (options.method === 'PUT')
      return Response.json({ data: { code: 'revision_conflict' } }, { status: 409 })
    if (options.method === 'POST') {
      assert.equal(path, '/api/projects')
      const body = JSON.parse(options.body)
      copies.push(body)
      copyStarted.resolve()
      await copyResult.promise
      if (editDuring === 'lost-copy-response' && copies.length === 1)
        throw new TypeError('Failed to fetch')
      return Response.json({ project: { ...project, ...body, id: 'kept-copy', revision: 1 } })
    }
    assert.equal(path, '/api/projects/p')
    reloadCount++
    reloadStarted.resolve()
    await reloadResult.promise
    if (editDuring === 'reload-failure') throw new TypeError('Failed to fetch')
    return Response.json({ project: { ...project, title: 'Remote saved canvas', revision: 8 } })
  }
  editor.edit('Draft saved as copy')
  editor.store.checkpoint('p')
  await assert.rejects(editor.flush())
  assert.equal(editor.store.saveStates.p.status, 'conflict')
  let copying = editor.store.keepProjectCopy('p')
  await copyStarted.promise
  if (editDuring === 'copy') editor.edit('Newer edit during copy')
  copyResult.resolve()
  if (editDuring === 'lost-copy-response') {
    await assert.rejects(copying, /Couldn’t reach Vela/)
    editor.edit('Newer edit after lost response')
    copying = editor.store.keepProjectCopy('p')
  } else if (['none', 'reload', 'reload-failure'].includes(editDuring)) {
    await reloadStarted.promise
    if (editDuring === 'reload') editor.edit('Newer edit during reload')
    reloadResult.resolve()
  }
  const copy = await copying
  assert.equal(copy.title, 'Draft saved as copy (copy)')
  if (editDuring === 'none') {
    assert.equal(editor.exists().title, 'Remote saved canvas')
    assert.equal(editor.exists().revision, 8)
    assert.equal(editor.store.saveStates.p.status, 'saved')
    assert.equal(Object.values(editor.store.saveStates).some((state) => state.status !== 'saved'), false,
      'confirmed copy and reconciled original no longer trigger the unsaved-work warning')
    assert.equal(editor.store.history.p, undefined)
    assert.deepEqual(sharedJournal.list('shared-editor'), [otherCandidate],
      'reconciliation clears only this editor’s original recovery candidate')
  } else {
    assert.equal(editor.store.saveStates.p.status, 'conflict')
    assert.equal(editor.exists().title, editDuring === 'copy' ? 'Newer edit during copy'
      : editDuring === 'reload' ? 'Newer edit during reload'
        : editDuring === 'lost-copy-response' ? 'Newer edit after lost response' : 'Draft saved as copy')
    assert.ok(sharedJournal.list('shared-editor').some((candidate) => candidate.payload.title === editor.exists().title),
      'later edits or an unconfirmed reload retain the original recovery candidate')
    assert.ok(editor.store.history.p)
  }
  if (editDuring === 'copy' || editDuring === 'lost-copy-response') assert.equal(reloadCount, 0)
  if (editDuring === 'lost-copy-response') assert.deepEqual(copies[0], copies[1], 'copy receipt retry keeps its original snapshot and mutation ID')
  else assert.equal(copies.length, 1)
  editor.reset()
}
sharedJournal.clearUser('shared-editor')
globalThis.fetch = originalFetch
console.log('PASS: confirmed conflict copies clean only the unchanged original; edits during POST/GET and lost-response retries remain recoverable')

// Undo before debounce clears only the active editor's journal, without sending a write.
const undoEditor = liveEditor('project')
const oldJournal = createDraftRecovery()
oldJournal.save('shared-editor', 'project', 'p', { title: 'Old recovery candidate' }, 1)
let undoWrites = 0
undoEditor.owner.request = async () => { undoWrites++; throw new Error('Unexpected write') }
undoEditor.store.renameNode('p', 'ref', 'Temporary name')
assert.equal(sharedJournal.list('shared-editor').length, 2)
undoEditor.store.travel('p', 'past')
assert.equal(undoEditor.store.saveStates.p.status, 'saved')
assert.deepEqual(sharedJournal.list('shared-editor').map((entry) => entry.payload.title), ['Old recovery candidate'])
await new Promise((resolve) => setTimeout(resolve, 650))
assert.equal(undoWrites, 0, 'Undo to confirmed state cancels the scheduled save')
undoEditor.reset()
sharedJournal.clearUser('shared-editor')
delete globalThis.window

// An in-flight edit may already be committed: Undo must retain uncertainty and then compensate.
const undoGate = deferred(), undoCalls = [], undoStates = []
let cleanWhilePending = 0
const undoQueue = createSaveQueue({
  write: async (_id, value, revision, mutationId) => {
    undoCalls.push({ value, revision, mutationId })
    if (undoCalls.length === 1) { await undoGate.promise; throw new Error('Response lost') }
    return { revision: revision + 1 }
  },
  revision: (result) => result.revision,
  saved() {},
  clean() { cleanWhilePending++ },
  state: (_id, state) => undoStates.push(state),
})
undoQueue.register('p', { title: 'A' }, 1)
undoQueue.update('p', { title: 'B' })
const savingBeforeUndo = assert.rejects(undoQueue.flush('p'))
undoQueue.update('p', { title: 'A' })
assert.equal(cleanWhilePending, 0)
assert.notEqual(undoStates.at(-1).status, 'saved')
undoGate.resolve()
await savingBeforeUndo
await undoQueue.retry('p')
assert.deepEqual(undoCalls[1], undoCalls[0], 'Undo cannot change the identity of an uncertain write')
assert.deepEqual(undoCalls.map((call) => [call.value.title, call.revision]), [['B', 1], ['B', 1], ['A', 2]])
assert.equal(undoStates.at(-1).status, 'saved')
undoQueue.dispose()
console.log('PASS: two-tab and refreshed-session ACK isolation; Undo clears owned recovery before save and preserves in-flight retry uncertainty')

// Multipart retries keep immutable file bytes and fields even if the caller changes its form.
const multipartCalls = []
const multipart = createMutationRequests(async (_path, options) => {
  multipartCalls.push({
    key: options.body.get('clientMutationId'),
    name: options.body.get('file').name,
    bytes: await options.body.get('file').text(),
  })
  if (multipartCalls.length === 1) throw new Error('Upload response lost')
  return { asset: { id: 'asset-once' } }
})
const originalForm = new FormData()
originalForm.append('file', new File(['original bytes'], 'reference.png', { type: 'image/png' }))
originalForm.append('clientMutationId', 'original-mutation')
const uploadingForm = assert.rejects(multipart.run('upload', '/api/assets', { method: 'POST', body: originalForm }))
originalForm.set('file', new File(['changed bytes'], 'changed.png', { type: 'image/png' }))
originalForm.set('clientMutationId', 'changed-mutation')
await uploadingForm
await multipart.run('upload', '/api/assets', { method: 'POST', body: originalForm })
assert.deepEqual(multipartCalls, [
  { key: 'original-mutation', name: 'reference.png', bytes: 'original bytes' },
  { key: 'original-mutation', name: 'reference.png', bytes: 'original bytes' },
])

const uploadEditor = liveEditor('project')
const uploadedBodies = []
const uploadReceipts = new Map()
let loseUploadResponse = true
globalThis.fetch = async (_path, options) => {
  assert.ok(options.body instanceof FormData)
  assert.equal(options.headers['Content-Type'], undefined, 'browser supplies the multipart boundary')
  const file = options.body.get('file')
  const mutationId = options.body.get('clientMutationId')
  uploadedBodies.push({ mutationId, name: file.name, type: file.type, bytes: await file.text() })
  let asset = uploadReceipts.get(mutationId)
  if (!asset) {
    asset = { id: `asset-${uploadReceipts.size + 1}`, name: file.name, url: '/api/assets/test/file', createdAt: 1 }
    uploadReceipts.set(mutationId, asset)
  }
  if (loseUploadResponse) {
    loseUploadResponse = false
    return new Response('{"asset":', { status: 201 })
  }
  return Response.json({ asset }, { status: 201 })
}
const uploadFile = () => new File(['synthetic image bytes'], 'my-reference.png', { type: 'image/png' })
await assert.rejects(uploadEditor.store.uploadLibraryItem(uploadFile()), /Select the same file again to retry/)
await uploadEditor.store.uploadLibraryItem(uploadFile())
assert.deepEqual(uploadedBodies[0], uploadedBodies[1], 'reselecting the same file retries the accepted upload')
assert.equal(uploadReceipts.size, 1)
assert.equal(uploadEditor.store.library.length, 1)
await uploadEditor.store.uploadLibraryItem(uploadFile())
assert.notEqual(uploadedBodies[2].mutationId, uploadedBodies[1].mutationId, 'a new upload after success is intentional')
assert.equal(uploadReceipts.size, 2)
await assert.rejects(uploadEditor.store.uploadLibraryItem(new File(['unsupported'], 'image.gif', { type: 'image/gif' })), /JPG, PNG or WebP/)
await assert.rejects(uploadEditor.store.uploadLibraryItem({ type: 'image/png', size: 13 * 1024 * 1024 }), /12 MB/)
assert.equal(uploadedBodies.length, 3, 'invalid files are rejected before reading/uploading bytes')
uploadEditor.store.renameProject('p', 'x'.repeat(200))
assert.equal(uploadEditor.store.project('p').title.length, 160, 'project rename stays within API validation bounds')
uploadEditor.reset()

// Identical concurrent selection joins the same request and inserts only one library card.
const concurrentUpload = liveEditor('project')
const uploadStarted = deferred(), finishUpload = deferred()
let concurrentUploads = 0
globalThis.fetch = async () => {
  concurrentUploads++
  uploadStarted.resolve()
  await finishUpload.promise
  return Response.json({ asset: { id: 'shared-upload', name: 'Shared', url: '/api/assets/shared/file', createdAt: 1 } }, { status: 201 })
}
const firstUpload = concurrentUpload.store.uploadLibraryItem(uploadFile())
await uploadStarted.promise
const secondUpload = concurrentUpload.store.uploadLibraryItem(uploadFile())
await new Promise((resolve) => setTimeout(resolve, 50))
finishUpload.resolve()
await Promise.all([firstUpload, secondUpload])
assert.equal(concurrentUploads, 1)
assert.equal(concurrentUpload.store.library.length, 1)
concurrentUpload.reset()

// Switching accounts while bytes are read must not upload the old account's selection.
const switchedUpload = liveEditor('project')
const bytesReady = deferred()
const slowFile = uploadFile()
slowFile.arrayBuffer = () => bytesReady.promise
let switchedUploads = 0
globalThis.fetch = async () => { switchedUploads++; throw new Error('Must not upload') }
const readingOldFile = assert.rejects(switchedUpload.store.uploadLibraryItem(slowFile), { name: 'AbortError' })
switchedUpload.owner.connect('new-owner', async () => 'test-token')
bytesReady.resolve(new ArrayBuffer(4))
await readingOldFile
assert.equal(switchedUploads, 0)
switchedUpload.reset()
globalThis.fetch = originalFetch
console.log('PASS: upload retries retain multipart identity/bytes, intentional uploads remain separate, concurrent retries deduplicate, account switches stop old uploads, and project names stay valid')

globalThis.fetch = async () => Response.json({
  message: 'Invalid project', data: { code: 'invalid_project', message: 'This model accepts up to 3 references.' },
}, { status: 400 })
const validationApi = createWorkspaceApi(async () => 'test-token')
await assert.rejects(validationApi.request('/api/projects/p', { method: 'PUT', body: {} }), {
  code: 'invalid_project', message: 'This model accepts up to 3 references.',
})
validationApi.cancel()

const expiredUpload = liveEditor('project')
const expiredUploadIds = []
globalThis.fetch = async (_path, options) => {
  expiredUploadIds.push(options.body.get('clientMutationId'))
  if (expiredUploadIds.length === 1) throw new Error('Upload response lost')
  return new Response('{', { status: 410 })
}
await assert.rejects(expiredUpload.store.uploadLibraryItem(uploadFile()), /Select the same file/)
await assert.rejects(expiredUpload.store.uploadLibraryItem(uploadFile()), /Reload/)
await assert.rejects(expiredUpload.store.uploadLibraryItem(uploadFile()), /Reload/)
assert.deepEqual(expiredUploadIds, [expiredUploadIds[0], expiredUploadIds[0], expiredUploadIds[0]])
expiredUpload.reset()
globalThis.fetch = originalFetch
console.log('PASS: project validation shows actionable details; expired upload receipts never create a fresh upload identity')

// Live generations are accepted once, append server-owned outputs, and preserve later canvas edits.
const { GENERATION_UNCONFIGURED } = await import('../app/entities/studio/generation.ts')
const { defaultDraft } = await import('../app/entities/studio/catalog.ts')
setActivePinia(createPinia())
const jobsOwner = useWorkspaceStore()
jobsOwner.live = true
jobsOwner.connect('job-owner', async () => 'test-token')
const jobsStudio = useStudioStore()
const jobProject = {
  id: 'job-project', title: 'Before submit', revision: 1, createdAt: 1,
  nodes: [{ id: 'generator', type: 'generator', x: 10, y: 20, draft: { ...defaultDraft(), prompt: 'A quiet forest', count: 1 } }],
  edges: [], viewport: { x: 0, y: 0, scale: 1 },
}
jobsStudio.hydrateLive([structuredClone(jobProject)], [])
await assert.rejects(jobsStudio.generateFromNodeAsync('job-project', 'generator'), /not connected/)
jobsStudio.hydrateLive([structuredClone(jobProject)], [], [], { ...GENERATION_UNCONFIGURED, enabled: true, reason: null })
const acceptedJob = {
  id: 'job-1', projectId: 'job-project', generatorId: 'generator', createdAt: 2,
  draft: structuredClone(jobProject.nodes[0].draft), priceCredits: null,
  takes: [{ id: 'take-1', generationId: 'job-1', status: 'queued', assetId: null, url: null, posterUrl: null, favorite: false }],
}
let serverJobProject = structuredClone(jobProject), acceptedProject, fetchedJob = structuredClone(acceptedJob)
const jobPosts = [], jobPuts = []
const jobStarted = deferred(), acceptJob = deferred()
globalThis.fetch = async (path, options) => {
  if (options.method === 'PUT') {
    const body = JSON.parse(options.body)
    jobPuts.push(body)
    assert.equal(body.expectedRevision, serverJobProject.revision)
    serverJobProject = { ...serverJobProject, ...body, revision: serverJobProject.revision + 1 }
    return Response.json({ project: serverJobProject })
  }
  if (options.method === 'POST') {
    jobPosts.push(JSON.parse(options.body))
    if (jobPosts.length === 1) {
      assert.equal(jobPosts[0].expectedRevision, serverJobProject.revision)
      serverJobProject.nodes.push({ id: 'take_take-1', type: 'take', takeId: 'take-1', generationId: 'job-1', x: 440, y: 20 })
      serverJobProject.edges.push({ id: 'output_take-1', from: 'generator', to: 'take_take-1' })
      serverJobProject.revision++
      acceptedProject = structuredClone(serverJobProject)
      jobStarted.resolve()
      await acceptJob.promise
      throw new Error('Accepted job response lost')
    }
    return Response.json({ generation: acceptedJob, project: acceptedProject }, { status: 202 })
  }
  assert.equal(path, '/api/generations')
  return Response.json({ generations: [fetchedJob] })
}
jobsStudio.renameProject('job-project', 'Saved before generation')
const submittingJob = assert.rejects(jobsStudio.generateFromNodeAsync('job-project', 'generator'), /response lost/)
await jobStarted.promise
jobsStudio.updateDraft('job-project', 'generator', { prompt: 'Edited while job is being accepted' })
await assert.rejects(jobsStudio.retryProjectSave('job-project'), /paused/)
acceptJob.resolve()
await submittingJob
assert.equal(jobsStudio.generationSubmissions.generator.status, 'unconfirmed')
await jobsStudio.generateFromNodeAsync('job-project', 'generator')
assert.deepEqual(jobPosts[1], jobPosts[0], 'Check request repeats the original accepted-job mutation')
await jobsStudio.retryProjectSave('job-project')
assert.equal(jobPuts.length, 2, 'only pre-submit changes and post-accept edits are written')
assert.equal(serverJobProject.nodes[0].draft.prompt, 'Edited while job is being accepted')
assert.equal(serverJobProject.nodes.filter((node) => node.type === 'take').length, 1)
assert.equal(jobsStudio.generations.length, 1)
assert.equal(jobsStudio.findTake('take-1').take.url, null, 'queued jobs never borrow demo media')
assert.equal(jobsStudio.credits, 0)

// Polling updates a viewed Take object in place and never resurrects deleted canvas outputs.
const observedTake = jobsStudio.findTake('take-1').take
jobsStudio.project('job-project').nodes = jobsStudio.project('job-project').nodes.filter((node) => node.type !== 'take')
jobsStudio.project('job-project').edges = []
fetchedJob.takes[0] = { ...fetchedJob.takes[0], status: 'done', assetId: 'generated-asset', url: '/api/assets/generated-asset/file?variant=preview' }
await jobsStudio.refreshGenerations()
assert.equal(observedTake.status, 'done')
assert.equal(observedTake.assetId, 'generated-asset')
assert.equal(jobsStudio.project('job-project').nodes.some((node) => node.type === 'take'), false, 'poll cannot restore a user-deleted result')

fetchedJob.takes[0].status = 'unknown'
await jobsStudio.refreshGenerations()
assert.match(jobsStudio.generationBlocked('job-project', 'generator'), /unconfirmed/)
await assert.rejects(jobsStudio.generateFromNodeAsync('job-project', 'generator'), /unconfirmed/)
assert.equal(jobPosts.length, 2, 'unknown provider outcome never starts new paid work')

// Approved local character photos cannot authorize video references.
jobsStudio.project('job-project').nodes[0].draft = { ...defaultDraft(), mode: 'video', modelId: 'seedance-2-5', prompt: 'Portrait video' }
jobsStudio.project('job-project').nodes.push({ id: 'person-ref', type: 'reference', assetId: 'sheet', assetKind: 'character', characterVersionId: 'character-version', name: 'Person', url: '/api/assets/sheet/file', x: 0, y: 0 })
jobsStudio.project('job-project').edges = [{ id: 'character-input', from: 'person-ref', to: 'generator' }]
assert.match(jobsStudio.generationBlocked('job-project', 'generator'), /identity authorization/)
assert.match(jobsStudio.connectionError('job-project', 'person-ref', 'generator'), /identity authorization/)

const lateJobs = deferred()
globalThis.fetch = async () => { await lateJobs.promise; return Response.json({ generations: [acceptedJob] }) }
const refreshingOldJobs = jobsStudio.refreshGenerations()
jobsStudio.resetPrivate()
jobsOwner.disconnect()
lateJobs.resolve()
await refreshingOldJobs
assert.equal(jobsStudio.generations.length, 0, 'old polling responses cannot repopulate another account')
globalThis.fetch = originalFetch
console.log('PASS: live generation gating, exact accepted-job replay, atomic output merge with concurrent edits, durable polling, no fake results/resurrection, unknown-outcome and character-video gates, and account-safe polling')

setActivePinia(createPinia())
const capabilitiesOwner = useWorkspaceStore()
capabilitiesOwner.live = true
capabilitiesOwner.connect('capability-owner', async () => 'test-token')
const capabilitiesStudio = useStudioStore()
const doneJob = structuredClone(acceptedJob)
doneJob.takes[0] = { ...doneJob.takes[0], status: 'done', assetId: 'owned-output', url: '/api/assets/owned-output/file' }
capabilitiesStudio.hydrateLive([structuredClone(jobProject)], [], [doneJob], { ...GENERATION_UNCONFIGURED, enabled: true, reason: null, counts: [1], videoDuration: { min: 4, max: 10, step: 2 } })
const capabilityDraft = capabilitiesStudio.project('job-project').nodes[0].draft
capabilityDraft.prompt = ''
assert.match(capabilitiesStudio.generationBlocked('job-project', 'generator'), /Add a prompt/)
capabilityDraft.prompt = 'A quiet forest'
capabilityDraft.modelId = 'unverified-model'
assert.match(capabilitiesStudio.generationBlocked('job-project', 'generator'), /supported model/)
capabilityDraft.modelId = 'seedream-5-pro'
capabilityDraft.count = 4
assert.match(capabilitiesStudio.generationBlocked('job-project', 'generator'), /output count/)
capabilityDraft.count = 1
capabilityDraft.mode = 'video'
capabilityDraft.modelId = 'seedance-2-5'
capabilityDraft.durationS = 5
assert.match(capabilitiesStudio.generationBlocked('job-project', 'generator'), /supported duration/)
capabilityDraft.durationS = 6
capabilityDraft.trial = true
assert.match(capabilitiesStudio.generationBlocked('job-project', 'generator'), /Trial generation is unavailable/)
capabilityDraft.trial = false
assert.equal(capabilitiesStudio.generationBlocked('job-project', 'generator'), '')

const staleFavoritePoll = deferred()
globalThis.fetch = async (_path, options) => {
  if (options.method === 'PATCH') {
    assert.deepEqual(JSON.parse(options.body), { favorite: true })
    return Response.json({ generation: { ...doneJob, takes: [{ ...doneJob.takes[0], favorite: true, status: 'queued' }] } })
  }
  await staleFavoritePoll.promise
  return Response.json({ generations: [doneJob] })
}
const beforeFavoritePoll = capabilitiesStudio.refreshGenerations()
capabilitiesStudio.toggleFavorite('take-1')
for (let i = 0; i < 40 && capabilitiesStudio.favoritePending['take-1']; i++) await Promise.resolve()
assert.equal(capabilitiesStudio.favoritePending['take-1'], undefined)
assert.equal(capabilitiesStudio.findTake('take-1').take.favorite, true)
assert.equal(capabilitiesStudio.findTake('take-1').take.status, 'done', 'favorite response must not roll back newer job status')
staleFavoritePoll.resolve()
await beforeFavoritePoll
assert.equal(capabilitiesStudio.findTake('take-1').take.favorite, true, 'a pre-favorite poll cannot erase its acknowledgement')
capabilitiesStudio.projects.push({ ...structuredClone(jobProject), id: 'copy-project', nodes: [{ id: 'copied-output', type: 'take', takeId: 'take-1', generationId: 'job-1', x: 0, y: 0 }], edges: [] })
capabilitiesStudio.deleteProject('job-project')
assert.equal(capabilitiesStudio.findTake('take-1').take.assetId, 'owned-output', 'copied results remain available after deleting the original project')
capabilitiesStudio.resetPrivate()
capabilitiesOwner.disconnect()
globalThis.fetch = originalFetch
console.log('PASS: capability bounds gate live submission; favorite updates and stale polling preserve job state; copied results survive original-project removal')

const disabledReceipts = createMutationRequests(async () => { throw new ApiError(503, 'Generation is not connected.', 'generation_disabled') })
await assert.rejects(disabledReceipts.run('generation', '/api/projects/p/generations', { method: 'POST', body: { clientMutationId: 'declined' } }))
assert.equal(disabledReceipts.has('generation'), false, 'a known pre-submit configuration refusal is not an uncertain paid outcome')

// The live character primary action places an image generator; it does not claim video authorization.
setActivePinia(createPinia())
const placementOwner = useWorkspaceStore()
placementOwner.live = true
const placementStudio = useStudioStore()
placementStudio.hydrateLive([structuredClone(jobProject)], [])
const originalNavigate = globalThis.navigateTo
const destinations = []
globalThis.navigateTo = (path) => destinations.push(path)
const { useCharacterPlacement } = await import('../app/features/characters/useCharacterPlacement.ts')
const placement = useCharacterPlacement()
const savedPerson = { ...actor, savedAt: 1, sheetUrl: '/api/assets/character-sheet/file', sheetAssetId: 'character-sheet', characterVersionId: 'reviewed-version' }
await placement.useInImage(savedPerson)
const placed = placementStudio.project('job-project')
const imageGenerator = placed.nodes.filter((node) => node.type === 'generator').at(-1)
assert.equal(imageGenerator.draft.mode, 'image')
assert.match(imageGenerator.draft.prompt, /@person/)
assert.equal(placed.nodes.some((node) => node.type === 'reference' && node.characterVersionId === 'reviewed-version'), true)
const placedCount = placed.nodes.length
await placement.useInVideo(savedPerson)
assert.equal(placed.nodes.length, placedCount, 'unavailable portrait authorization cannot create a video flow')
assert.equal(destinations.length, 1)
placementStudio.resetPrivate()
placementOwner.disconnect()
if (originalNavigate) globalThis.navigateTo = originalNavigate
else delete globalThis.navigateTo
console.log('PASS: live character action creates an image generator with a pinned @reference; direct character-to-video remains gated')

// Browser fetch failures get actionable copy without becoming a definitive rejection.
const offlineApi = createWorkspaceApi(async () => 'test-token')
const offlineMutations = createMutationRequests((path, options) => offlineApi.request(path, options))
const offlineBodies = []
globalThis.fetch = async (_path, options) => {
  offlineBodies.push(JSON.parse(options.body))
  if (offlineBodies.length === 1) throw new TypeError('Failed to fetch')
  return Response.json({ project: { id: 'created-before-disconnect' } })
}
await assert.rejects(offlineMutations.run('create', '/api/projects', {
  method: 'POST', body: { title: 'Original', clientMutationId: 'same-offline-retry' },
}), (cause) => {
  assert.equal(cause.message, 'Couldn’t reach Vela. Check your connection and try again.')
  assert.equal(cause.status, undefined)
  assert.equal(cause.code, undefined)
  assert.ok(cause.cause instanceof TypeError)
  return true
})
assert.equal(offlineMutations.has('create'), true)
await offlineMutations.run('create', '/api/projects', {
  method: 'POST', body: { title: 'Later input', clientMutationId: 'must-not-replace-original' },
})
assert.deepEqual(offlineBodies[1], offlineBodies[0], 'the friendly transport error keeps the original lost-reply mutation')
offlineApi.cancel()
globalThis.fetch = originalFetch
console.log('PASS: offline errors are actionable and retain the exact original mutation for safe replay')

// Each live video model owns its limits and reference policy; demo pricing is not involved.
const { capabilitiesForModel, preferredVideoModel, normalizeModelDraft, characterVideoBlocked } = await import('../app/entities/studio/generation.ts')
const { LIVE_VIDEO_MODELS } = await import('../app/entities/studio/catalog.ts')
assert.deepEqual(LIVE_VIDEO_MODELS.map(({ value, label }) => [value, label]), [
  ['seedance-2-5', 'Seedance 2.5'], ['minimax-h3', 'MiniMax H3'], ['h3-eros-max', 'H3 Eros Max · Beta7'],
])
assert.equal(LIVE_VIDEO_MODELS.some((model) => 'rates' in model), false)
const multiModelCaps = {
  ...GENERATION_UNCONFIGURED, enabled: true, reason: null,
  videoModels: ['seedance-2-5', 'minimax-h3', 'h3-eros-max'],
  modelSettings: {
    'seedream-5-pro': { enabled: false, reason: 'Image generation is not connected yet.' },
    'seedance-2-5': { enabled: false, reason: 'Seedance is not connected yet.', characterVideo: false },
    'minimax-h3': { enabled: true, reason: null, videoQualities: ['720p'], videoDuration: { min: 5, max: 15, step: 5 }, maxVideoReferences: 9, characterVideo: true },
    'h3-eros-max': { enabled: true, reason: null, videoQualities: ['720p'], videoDuration: { min: 5, max: 15, step: 5 }, maxVideoReferences: 9, characterVideo: true, referenceModes: ['images'] },
  },
}
assert.equal(preferredVideoModel(multiModelCaps), 'h3-eros-max')
assert.equal(preferredVideoModel({ ...multiModelCaps, videoModels: ['minimax-h3'] }), 'minimax-h3')
assert.equal(preferredVideoModel(GENERATION_UNCONFIGURED), undefined)
assert.equal(characterVideoBlocked(multiModelCaps), '')
assert.equal(capabilitiesForModel(multiModelCaps, { modelId: 'seedance-2-5' }).enabled, false, 'global enabled never enables an unavailable selected model')
const bothProviders = structuredClone(multiModelCaps)
bothProviders.modelSettings['seedance-2-5'].enabled = true
bothProviders.modelSettings['seedance-2-5'].reason = null
assert.equal(preferredVideoModel(bothProviders), 'seedance-2-5', 'existing enabled Seedance default is preserved')
assert.equal(preferredVideoModel(bothProviders, true), 'h3-eros-max', 'character placement picks a compatible model even if Seedance is enabled')
const normalizedEros = normalizeModelDraft({ ...defaultDraft(), mode: 'video', modelId: 'h3-eros-max', durationS: 6, videoQuality: '480p', prompt: 'Keep this prompt', referenceId: 'keep-reference' }, multiModelCaps)
assert.equal(normalizedEros.durationS, 5)
assert.equal(normalizedEros.videoQuality, '720p')
assert.equal(normalizedEros.prompt, 'Keep this prompt')
assert.equal(normalizedEros.referenceId, 'keep-reference')
assert.equal(normalizeModelDraft({ ...normalizedEros, durationS: 10 }, multiModelCaps).durationS, 10)
assert.equal(normalizeModelDraft({ ...normalizedEros, durationS: 4 }, multiModelCaps).durationS, 5)

setActivePinia(createPinia())
const modelsOwner = useWorkspaceStore()
modelsOwner.live = true
modelsOwner.connect('models-owner', async () => 'test-token')
const modelsStudio = useStudioStore()
const modelProject = structuredClone(jobProject)
modelProject.nodes[0].draft = { ...defaultDraft(), mode: 'video', modelId: 'seedance-2-5', prompt: 'A character study', durationS: 30, videoQuality: '480p' }
for (let i = 0; i < 10; i++) {
  modelProject.nodes.push({ id: `ref-${i}`, type: 'reference', assetId: `asset-${i}`, ...(i === 0 ? { assetKind: 'character', characterVersionId: 'pinned-version' } : {}), name: `Reference ${i}`, url: `/api/assets/asset-${i}/file`, x: 0, y: 0 })
  if (i < 9) modelProject.edges.push({ id: `input-${i}`, from: `ref-${i}`, to: 'generator' })
}
modelsStudio.hydrateLive([modelProject], [], [], multiModelCaps)
const modelsProject = modelsStudio.project('job-project')
const originalInputs = JSON.stringify(modelsProject.edges)
modelsStudio.updateDraft('job-project', 'generator', { modelId: 'h3-eros-max' })
const selectedDraft = modelsProject.nodes[0].draft
assert.equal(selectedDraft.durationS, 15)
assert.equal(selectedDraft.videoQuality, '720p')
assert.equal(selectedDraft.prompt, 'A character study')
assert.equal(JSON.stringify(modelsProject.edges), originalInputs, 'model switch cannot discard pinned inputs')
assert.equal(modelsStudio.generationBlocked('job-project', 'generator'), '')
assert.match(modelsStudio.connectionError('job-project', 'ref-9', 'generator'), /up to 9 references/)
assert.match(modelsStudio.assetMentionOption('job-project', 'generator', { id: 'extra-asset', kind: 'image', name: 'Extra', handle: 'extra', url: '/api/assets/extra/file' }).disabled, /up to 9 references/)
assert.equal(modelsStudio.assetMentionOption('job-project', 'generator', { id: 'asset-0', kind: 'character', name: 'Person', handle: 'person', url: '/api/assets/asset-0/file' }).disabled, '')
selectedDraft.durationS = 6
assert.match(modelsStudio.generationBlocked('job-project', 'generator'), /supported duration/)
selectedDraft.durationS = 10
selectedDraft.videoQuality = '480p'
assert.match(modelsStudio.generationBlocked('job-project', 'generator'), /supported quality/)
selectedDraft.videoQuality = '720p'
modelsProject.edges = [{ id: 'start-frame', from: 'ref-1', to: 'generator', slot: 'start' }]
assert.match(modelsStudio.generationBlocked('job-project', 'generator'), /does not support start\/end/)
assert.match(modelsStudio.connectionError('job-project', 'ref-2', 'generator', 'end'), /does not support start\/end/)
modelsStudio.updateDraft('job-project', 'generator', { modelId: 'minimax-h3' })
assert.equal(modelsStudio.generationBlocked('job-project', 'generator'), '')
assert.equal(modelsStudio.connectionError('job-project', 'ref-2', 'generator', 'end'), null)
assert.deepEqual(modelsProject.edges.map((edge) => edge.id), ['start-frame'], 'switching back restores frame support without recreating inputs')
modelsStudio.updateDraft('job-project', 'generator', { modelId: 'seedance-2-5' })
assert.match(modelsStudio.generationBlocked('job-project', 'generator'), /Seedance is not connected/)
modelsStudio.generationCapabilities = bothProviders
assert.equal(modelsStudio.generationBlocked('job-project', 'generator'), '')
assert.match(modelsStudio.connectionError('job-project', 'ref-0', 'generator'), /identity authorization/, 'Seedance still rejects character references')
modelsStudio.generationCapabilities = multiModelCaps
const newVideo = modelsStudio.addGeneratorNode('job-project', 600, 100, 'video')
assert.equal(newVideo.draft.modelId, 'h3-eros-max')
assert.equal(newVideo.draft.durationS, 5)

const modelDestinations = []
globalThis.navigateTo = (path) => modelDestinations.push(path)
await useCharacterPlacement().useInVideo(savedPerson)
const characterVideo = modelsProject.nodes.filter((node) => node.type === 'generator').at(-1)
assert.equal(characterVideo.draft.modelId, 'h3-eros-max')
assert.match(characterVideo.draft.prompt, /@person/)
assert.equal(modelsProject.edges.some((edge) => edge.to === characterVideo.id && modelsProject.nodes.some((node) => node.id === edge.from && node.characterVersionId === 'reviewed-version')), true)
assert.equal(modelDestinations.length, 1)
if (originalNavigate) globalThis.navigateTo = originalNavigate
else delete globalThis.navigateTo

globalThis.fetch = async (path, options) => {
  assert.equal(path, '/api/projects')
  const body = JSON.parse(options.body)
  assert.equal(body.nodes[0].draft.modelId, 'h3-eros-max', 'a new project starts with the available video provider')
  assert.equal(body.nodes[0].draft.durationS, 5)
  return Response.json({ project: { ...body, revision: 1, createdAt: 1 } })
}
await modelsStudio.createProjectAsync()
modelsStudio.resetPrivate()
modelsOwner.disconnect()
globalThis.fetch = originalFetch
console.log('PASS: separate live model labels, per-model availability/duration/quality/reference/character policies, Eros frame refusal without input loss, compatible character placement and Voplica defaults')
