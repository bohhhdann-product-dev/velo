import { ref, watch, type Ref } from 'vue'
import type { Project } from '~/entities/studio/types'
import { useWorkspaceStore } from '~/stores/workspace'
import { createDraftRecovery } from './recovery'
import { projectPayload } from './projectPayload'
import { createSaveQueue, type SaveState } from './saveQueue'

export function useProjectPersistence(projects: Ref<Project[]>) {
  const workspace = useWorkspaceStore()
  const recovery = createDraftRecovery()
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
  async function reload(id: string) {
    const session = workspace.sessionVersion
    const { project } = await workspace.request<{ project: Project }>(`/api/projects/${id}`)
    workspace.assertSession(session)
    register(project)
    if (workspace.userId) recovery.remove(workspace.userId, 'project', id)
    const index = projects.value.findIndex((p) => p.id === id)
    if (index !== -1) projects.value[index] = project
    reloads.value[id] = (reloads.value[id] ?? 0) + 1
  }
  return {
    states,
    reloads,
    start,
    register,
    reset,
    reload,
    flush: (id: string) => queue?.flush(id),
    retry: (id: string) => queue?.retry(id),
    remove: (id: string) => {
      queue?.remove(id)
      if (workspace.userId) recovery.remove(workspace.userId, 'project', id)
      delete states.value[id]
    },
  }
}
