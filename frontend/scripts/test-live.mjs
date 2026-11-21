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
const { createWorkspaceApi } = await import('../app/shared/api/workspace.ts')
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
    throw Object.assign(new Error('Conflict'), { status: 409 })
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
  throw Object.assign(new Error('Revision conflict'), { status: 409 })
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
