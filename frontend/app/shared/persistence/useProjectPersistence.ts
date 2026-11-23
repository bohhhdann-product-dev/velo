import { ref, watch, type Ref } from 'vue'
import type { Project } from '~/entities/studio/types'
import { useWorkspaceStore } from '~/stores/workspace'
import { createDraftRecovery } from './recovery'
import { projectPayload } from './projectPayload'
import { createSaveQueue, type SaveState } from './saveQueue'

export function useProjectPersistence(projects: Ref<Project[]>) {
  const workspace = useWorkspaceStore()
  let recovery = createDraftRecovery()
  const states = ref<Record<string, SaveState>>({})
  const reloads = ref<Record<string, number>>({})
  let queue:
    | ReturnType<typeof createSaveQueue<ReturnType<typeof projectPayload>, Project>>
    | undefined
  watch(
    () =>
      workspace.live
        ? projects.value.map((p) => {
            try {
              return { id: p.id, payload: projectPayload(p) }
            } catch (cause) {
              return {
                id: p.id,
                error: cause instanceof Error ? cause.message : 'Invalid canvas reference.',
              }
            }
          })
        : [],
    (items) => {
      for (const item of items) {
        if (item.payload) queue?.update(item.id, item.payload)
        else states.value[item.id] = { status: 'error', message: item.error }
      }
    },
    { flush: 'sync' },
  )
  function register(project: Project) {
    queue?.register(project.id, projectPayload(project), project.revision ?? 0)
  }
  function start() {
    reset()
    recovery = createDraftRecovery()
    queue = createSaveQueue({
      async write(id, value, expectedRevision, clientMutationId) {
        const result = await workspace.request<{ project: Project }>(`/api/projects/${id}`, {
          method: 'PUT',
          body: { ...value, expectedRevision, clientMutationId },
        })
        return result.project
      },
      revision: (project) => project.revision ?? 0,
      dirty(id, payload, revision) {
        if (workspace.userId) recovery.save(workspace.userId, 'project', id, payload, revision)
      },
      clean(id) {
        if (workspace.userId) recovery.remove(workspace.userId, 'project', id)
      },
      saved(id, saved, _sent, unchanged) {
        if (unchanged && workspace.userId) recovery.remove(workspace.userId, 'project', id)
        // Apply metadata only: current nodes/viewport may already contain later edits.
        const local = projects.value.find((p) => p.id === id)
        if (local) local.revision = saved.revision
      },
      state: (id, state) => {
        states.value[id] = state
      },
    })
    projects.value.forEach(register)
  }
  function reset() {
    queue?.dispose()
    queue = undefined
    states.value = {}
    reloads.value = {}
  }
  async function reload(id: string, expectedPayload?: ReturnType<typeof projectPayload>) {
    const session = workspace.sessionVersion
    const activeQueue = queue
    const expected = expectedPayload === undefined ? undefined : JSON.stringify(expectedPayload)
    const unchanged = () => {
      if (queue !== activeQueue) return false
      if (expected === undefined) return true
      const current = projects.value.find((p) => p.id === id)
      return current !== undefined && JSON.stringify(projectPayload(current)) === expected
    }
    if (!unchanged()) return false
    const { project } = await workspace.request<{ project: Project }>(`/api/projects/${id}`)
    workspace.assertSession(session)
    if (!unchanged()) return false
    workspace.forgetMutation(`project:delete:${id}`)
    register(project)
    if (workspace.userId) recovery.remove(workspace.userId, 'project', id)
    const index = projects.value.findIndex((p) => p.id === id)
    if (index !== -1) projects.value[index] = project
    reloads.value[id] = (reloads.value[id] ?? 0) + 1
    return true
  }
  function mergeGeneration(canonical: Project, generationId: string) {
    const local = projects.value.find((p) => p.id === canonical.id)
    if (!local) return
    // A generation appends outputs on the server; keep edits made while it was accepted.
    register(canonical)
    local.revision = canonical.revision
    const outputs = canonical.nodes.filter((node) => node.type === 'take' && node.generationId === generationId)
    for (const node of outputs) if (!local.nodes.some((current) => current.id === node.id)) local.nodes.push(node)
    const outputIds = new Set(outputs.map((node) => node.id))
    for (const edge of canonical.edges) {
      if (outputIds.has(edge.to) && local.nodes.some((node) => node.id === edge.from)
        && !local.edges.some((current) => current.id === edge.id)) local.edges.push(edge)
    }
    queue?.update(local.id, projectPayload(local))
  }
  return {
    states,
    reloads,
    start,
    register,
    reset,
    reload,
    mergeGeneration,
    flush: (id: string) => queue?.flush(id),
    retry: (id: string) => queue?.retry(id),
    hold: (id: string) => queue?.hold(id),
    release: (id: string) => queue?.release(id),
    remove: (id: string) => {
      queue?.remove(id)
      if (workspace.userId) recovery.remove(workspace.userId, 'project', id)
      delete states.value[id]
    },
  }
}
