import { defineStore } from 'pinia'
import { shallowRef } from 'vue'
import { createMutationRequests } from '~/shared/persistence/mutationRequests'
import { createWorkspaceApi, type WorkspaceApi } from '~/shared/api/workspace'

export const useWorkspaceStore = defineStore('workspace', () => {
  const live = shallowRef(false)
  const sessionVersion = shallowRef(0)
  const userId = shallowRef<string | null>(null)
  const api = shallowRef<WorkspaceApi | null>(null)
  function disconnect() {
    sessionVersion.value++
    mutations.clear()
    api.value?.cancel()
    api.value = null
    userId.value = null
  }
  function connect(id: string, getToken: () => Promise<string | null>) {
    disconnect()
    userId.value = id
    api.value = createWorkspaceApi(getToken)
  }
  async function request<T>(
    path: string,
    options?: { method?: string; body?: unknown },
  ): Promise<T> {
    if (!api.value) throw new Error('Sign in to open your workspace.')
    return api.value.request<T>(path, options)
  }
  function assertSession(version: number) {
    if (version !== sessionVersion.value)
      throw new DOMException('Session changed', 'AbortError')
  }
  const mutations = createMutationRequests(request)
  return {
    live,
    sessionVersion,
    assertSession,
    userId,
    connect,
    disconnect,
    request,
    mutate: mutations.run,
    hasPendingMutation: mutations.has,
    forgetMutation: mutations.forget,
  }
})
