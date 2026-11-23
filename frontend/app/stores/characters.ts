import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'
import { useWorkspaceStore } from '~/stores/workspace'
import { createSaveQueue, type SaveState } from '~/shared/persistence/saveQueue'
import { createDraftRecovery } from '~/shared/persistence/recovery'
import { characterPayload } from '~/shared/persistence/characterPayload'
import { requiresReload } from '~/shared/api/workspace'
import type {
  Character,
  CharacterPhoto,
  PhotoAngle,
  PhotoStage,
} from '~/entities/character/types'
import { uniqueHandle } from '~/entities/studio/mentions'

let sequence = 0
export const useCharactersStore = defineStore('characters', () => {
  const workspace = useWorkspaceStore()
  let recovery = createDraftRecovery()
  const live = computed(() => workspace.live)
  const items = ref<Character[]>([])
  const saveStates = ref<Record<string, SaveState>>({})
  const busy = ref<Record<string, boolean>>({})
  const recoveryCopies = new Map<string, string>()
  const pendingActions = new Map<
    string,
    { operation: 'approve' | 'sheet' | 'publish'; stage?: PhotoStage; sent: string }
  >()
  let queue:
    | ReturnType<typeof createSaveQueue<ReturnType<typeof characterPayload>, Character>>
    | undefined
  watch(
    () =>
      workspace.live
        ? items.value.map((c) => ({ id: c.id, payload: characterPayload(c) }))
        : [],
    (entries) => {
      for (const entry of entries) queue?.update(entry.id, entry.payload)
    },
    { flush: 'sync' },
  )
  function register(c: Character) {
    queue?.register(c.id, characterPayload(c), c.storageRevision ?? 0)
  }
  function resetPrivate() {
    queue?.dispose()
    pendingActions.clear()
    recoveryCopies.clear()
    queue = undefined
    items.value = []
    saveStates.value = {}
    busy.value = {}
  }
  function hydrateLive(loaded: Character[]) {
    resetPrivate()
    recovery = createDraftRecovery()
    items.value = loaded
    queue = createSaveQueue({
      async write(id, character, expectedRevision, clientMutationId) {
        return (
          await workspace.request<{ character: Character }>(`/api/characters/${id}`, {
            method: 'PUT',
            body: { character, expectedRevision, clientMutationId },
          })
        ).character
      },
      revision: (c) => c.storageRevision ?? 0,
      dirty(id, payload, revision) {
        if (workspace.userId)
          recovery.save(workspace.userId, 'character', id, payload, revision)
      },
      clean(id) {
        if (workspace.userId) recovery.remove(workspace.userId, 'character', id)
      },
      saved(id, canonical, _sent, unchanged) {
        if (unchanged && workspace.userId) recovery.remove(workspace.userId, 'character', id)
        const local = find(id)
        if (!local) return
        if (unchanged) Object.assign(local, canonical)
        else local.storageRevision = canonical.storageRevision
      },
      state: (id, state) => {
        saveStates.value[id] = state
      },
    })
    loaded.forEach(register)
  }
  async function createAsync(mutationKey = 'character:create') {
    if (!workspace.live) return create()
    const session = workspace.sessionVersion
    const { character } = await workspace.mutate<{ character: Character }>(
      mutationKey,
      '/api/characters',
      {
        method: 'POST',
        body: { id: crypto.randomUUID(), clientMutationId: crypto.randomUUID() },
      },
    )
    workspace.assertSession(session)
    register(character)
    const existing = find(character.id)
    if (existing) return existing
    items.value.unshift(character)
    return character
  }
  async function restoreCopy(payload: unknown, recoveryId: string) {
    const source = payload as ReturnType<typeof characterPayload>
    if (
      !source ||
      typeof source.name !== 'string' ||
      !source.face?.photos ||
      !source.body?.photos
    )
      throw new Error('This recovery draft cannot be opened.')
    const previousCopy = recoveryCopies.get(recoveryId)
    const created =
      (previousCopy ? find(previousCopy) : undefined) ??
      (await createAsync(`character:recover:${recoveryId}`))
    recoveryCopies.set(recoveryId, created.id)
    const local = find(created.id)!
    local.name = `${source.name || 'Character'} (recovered)`.slice(0, 60)
    local.handle = uniqueHandle(
      source.handle || local.name,
      items.value.filter((c) => c.id !== local.id).map((c) => c.handle),
    )
    for (const stage of ['face', 'body'] as const) {
      local[stage] = {
        notes: source[stage].notes,
        approved: false,
        photos: Object.fromEntries(
          Object.entries(source[stage].photos).map(([angle, photo]) => [
            angle,
            {
              ...photo,
              url: `/api/assets/${encodeURIComponent(photo.assetId)}/file?variant=preview`,
            },
          ]),
        ),
      }
    }
    await queue?.retry(local.id)
    recoveryCopies.delete(recoveryId)
    return local
  }
  async function flush(id: string) {
    await queue?.flush(id)
  }
  async function action(
    id: string,
    operation: 'approve' | 'sheet' | 'publish',
    stage?: PhotoStage,
  ) {
    const session = workspace.sessionVersion
    if (busy.value[id]) throw new Error('Please wait for the current action.')
    const prior = pendingActions.get(id)
    if (prior && (prior.operation !== operation || prior.stage !== stage))
      throw new Error('Retry the previous action before continuing.')
    busy.value[id] = true
    const key = `character:action:${id}`
    let held = false
    try {
      // Flush also drains edits that arrive while an earlier save is in flight.
      if (!prior) await flush(id)
      workspace.assertSession(session)
      const local = find(id)
      if (!local) throw new Error('Character not found.')
      const pending = prior ?? {
        operation,
        stage,
        sent: JSON.stringify(characterPayload(local)),
      }
      pendingActions.set(id, pending)
      queue?.hold(id)
      held = true
      const { character } = await workspace.mutate<{ character: Character }>(
        key,
        `/api/characters/${id}/${operation}`,
        {
          method: 'POST',
          body: {
            expectedRevision: local.storageRevision,
            clientMutationId: crypto.randomUUID(),
            ...(stage ? { stage } : {}),
          },
        },
      )
      workspace.assertSession(session)
      if (JSON.stringify(characterPayload(local)) === pending.sent)
        Object.assign(local, character)
      else local.storageRevision = character.storageRevision
      pendingActions.delete(id)
      register(character)
      queue?.update(id, characterPayload(local))
      return character
    } catch (cause) {
      workspace.assertSession(session)
      if (requiresReload(cause)) {
        queue?.hold(id)
        saveStates.value[id] = {
          status: 'conflict',
          code: (cause as { code?: string }).code,
          message: cause instanceof Error ? cause.message : 'Reload the saved character to continue.',
        }
        if (!workspace.hasPendingMutation(key)) pendingActions.delete(id)
      } else if (workspace.hasPendingMutation(key)) {
        saveStates.value[id] = {
          status: 'error',
          message:
            'Could not confirm the action. Retry to recover its result; your edits are kept.',
        }
      } else if (held) {
        pendingActions.delete(id)
        queue?.release(id)
      }
      throw cause
    } finally {
      if (session === workspace.sessionVersion) busy.value[id] = false
    }
  }
  async function retrySave(id: string) {
    const pending = pendingActions.get(id)
    if (pending) return action(id, pending.operation, pending.stage)
    return queue?.retry(id)
  }
  async function approveAsync(id: string, stage: PhotoStage) {
    if (!workspace.live) return approve(id, stage)
    await action(id, 'approve', stage)
    return !!find(id)?.[stage].approved
  }
  async function buildSheet(id: string) {
    return action(id, 'sheet')
  }
  async function saveAsync(id: string) {
    if (!workspace.live) return save(id)
    await action(id, 'publish')
    return ''
  }
  async function removeAsync(id: string) {
    const session = workspace.sessionVersion
    if (workspace.live) {
      const key = `character:delete:${id}`
      if (!workspace.hasPendingMutation(key)) await flush(id)
      workspace.assertSession(session)
      queue?.hold(id)
      try {
        await workspace.mutate(key, `/api/characters/${id}`, {
          method: 'DELETE',
          body: {
            expectedRevision: find(id)?.storageRevision,
            clientMutationId: crypto.randomUUID(),
          },
        })
      } catch (cause) {
        workspace.assertSession(session)
        if (!workspace.hasPendingMutation(key)) queue?.release(id)
        throw cause
      }
    }
    workspace.assertSession(session)
    queue?.remove(id)
    if (workspace.userId) recovery.remove(workspace.userId, 'character', id)
    remove(id)
  }
  async function reload(id: string) {
    const session = workspace.sessionVersion
    const { character } = await workspace.request<{ character: Character }>(
      `/api/characters/${id}`,
    )
    workspace.assertSession(session)
    pendingActions.delete(id)
    workspace.forgetMutation(`character:action:${id}`)
    workspace.forgetMutation(`character:delete:${id}`)
    register(character)
    if (workspace.userId) recovery.remove(workspace.userId, 'character', id)
    const index = items.value.findIndex((c) => c.id === id)
    if (index !== -1) items.value[index] = character
  }
  const saved = computed(() => items.value.filter((c) => c.savedAt && c.sheetUrl))
  const find = (id: string) => items.value.find((c) => c.id === id)
  function create() {
    if (workspace.live) throw new Error('Use createAsync in the live workspace.')
    const character: Character = {
      id: `character_${Date.now().toString(36)}_${++sequence}`,
      name: '',
      handle: '',
      face: { photos: {}, notes: '', approved: false },
      body: { photos: {}, notes: '', approved: false },
      sheetUrl: null,
      savedAt: null,
      revision: 0,
      createdAt: Date.now(),
    }
    items.value.unshift(character)
    return items.value[0]!
  }
  function identityError(id: string) {
    const character = find(id)
    if (!character?.name.trim()) return 'Give your character a name.'
    if (!/^[\p{L}\p{N}_-]{1,48}$/u.test(character.handle))
      return 'Use letters, numbers, underscores or hyphens for the handle.'
    if (items.value.some((c) => c.id !== id && c.handle === character.handle))
      return 'This handle is already in use. Choose another.'
    return ''
  }
  function updateIdentity(id: string, patch: { name?: string; handle?: string }) {
    const c = find(id)
    if (!c) return
    c.savedAt = null
    if (workspace.live) {
      c.sheetUrl = null
      c.sheetAssetId = null
      c.characterVersionId = null
    }
    if (patch.name !== undefined) {
      const oldNameHandle = uniqueHandle(
        c.name,
        items.value.filter((item) => item.id !== id).map((item) => item.handle),
      )
      const automatic = !c.handle || c.handle === oldNameHandle
      c.name = patch.name.slice(0, 60)
      if (automatic)
        c.handle = c.name.trim()
          ? uniqueHandle(
              c.name,
              items.value.filter((item) => item.id !== id).map((item) => item.handle),
            )
          : ''
    }
    if (patch.handle !== undefined)
      c.handle = patch.handle.trim().replace(/^@/, '').toLowerCase().slice(0, 48)
  }
  function invalidate(c: Character, stage: PhotoStage) {
    c[stage].approved = false
    if (stage === 'face') c.body.approved = false
    c.sheetUrl = null
    c.sheetAssetId = null
    c.characterVersionId = null
    c.savedAt = null
    c.revision++
  }
  function setPhoto(
    id: string,
    stage: PhotoStage,
    angle: PhotoAngle,
    photo: CharacterPhoto | null,
  ) {
    const c = find(id)
    if (!c) return
    if (photo) c[stage].photos[angle] = { ...photo }
    else delete c[stage].photos[angle]
    invalidate(c, stage)
  }
  function updateNotes(id: string, stage: PhotoStage, notes: string) {
    const c = find(id)
    if (!c || c[stage].notes === notes) return
    c[stage].notes = notes.slice(0, 1000)
    invalidate(c, stage)
  }
  function approve(id: string, stage: PhotoStage) {
    const c = find(id)
    if (
      !c ||
      identityError(id) ||
      !c[stage].photos.front ||
      (stage === 'body' && !c.face.approved)
    )
      return false
    c[stage].approved = true
    return true
  }
  function setSheet(id: string, url: string, revision: number) {
    const c = find(id)
    if (!c || revision !== c.revision || !c.face.approved || !c.body.approved || !url)
      return false
    c.sheetUrl = url
    c.savedAt = null
    return true
  }
  function save(id: string) {
    const c = find(id)
    const error = identityError(id)
    if (error) return error
    if (!c?.face.approved || !c.body.approved || !c.sheetUrl)
      return 'Approve your face and body, then build the reference sheet.'
    c.name = c.name.trim()
    c.savedAt = Date.now()
    return ''
  }
  function remove(id: string) {
    items.value = items.value.filter((c) => c.id !== id)
  }
  function restore(character: Character) {
    if (find(character.id)) return
    if (character.handle)
      character.handle = uniqueHandle(
        character.handle,
        items.value.map((c) => c.handle),
      )
    items.value.unshift(character)
  }
  return {
    restoreCopy,
    live,
    hydrateLive,
    resetPrivate,
    createAsync,
    flush,
    approveAsync,
    buildSheet,
    saveAsync,
    removeAsync,
    saveStates,
    busy,
    reload,
    retrySave,
    restore,
    items,
    saved,
    find,
    create,
    identityError,
    updateIdentity,
    setPhoto,
    updateNotes,
    approve,
    setSheet,
    save,
    remove,
  }
})
