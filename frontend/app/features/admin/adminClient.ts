import { computed, readonly, shallowRef } from 'vue'
import type { AdminActionState, AdminDirectory, AdminMutation, AdminQuery, AdminUserDetail } from '../../entities/admin/types'
import { isDefinitiveRejection } from '../../shared/api/workspace'

type Request = <T>(path: string, options?: { method?: string; body?: unknown }) => Promise<T>
const idleAction = (): AdminActionState => ({ kind: null, pending: false, uncertain: false, conflict: false, error: '' })

/** Session-scoped admin data and exact retries. Nothing is written to browser storage. */
export function createAdminClient(request: Request, session: () => number) {
  const directory = shallowRef<AdminDirectory | null>(null)
  const detail = shallowRef<AdminUserDetail | null>(null)
  const selectedId = shallowRef<string | null>(null)
  const listLoading = shallowRef(false)
  const detailLoading = shallowRef(false)
  const listError = shallowRef('')
  const detailError = shallowRef('')
  const accessError = shallowRef('')
  const action = shallowRef<AdminActionState>(idleAction())
  const confirmed = shallowRef<{ kind: AdminMutation['kind']; sequence: number } | null>(null)
  let listSequence = 0
  let detailSequence = 0
  let epoch = 0
  let acknowledgement = 0
  let pending: { userId: string; kind: AdminMutation['kind']; body: Record<string, unknown> } | null = null
  let running: Promise<boolean> | null = null
  const locked = computed(() => action.value.pending || action.value.uncertain)

  function clear() {
    epoch++; listSequence++; detailSequence++
    directory.value = null; detail.value = null; selectedId.value = null
    listLoading.value = false; detailLoading.value = false
    listError.value = ''; detailError.value = ''; accessError.value = ''
    action.value = idleAction(); confirmed.value = null
    pending = null; running = null
  }
  function guard() {
    const owner = session(), current = epoch
    return () => owner === session() && current === epoch
  }
  function denied(cause: unknown) {
    const error = cause as { status?: number; code?: string }
    if (error?.status !== 403 && error?.status !== 401) return false
    clear()
    accessError.value = error.code === 'account_blocked' ? 'Your account is blocked.'
      : error.status === 401 ? 'Your session expired. Sign in again.'
        : 'This account does not have administrator access.'
    return true
  }
  const message = (cause: unknown) => cause instanceof Error ? cause.message : 'The request could not be completed.'

  async function loadUsers(query: AdminQuery) {
    const valid = guard(), sequence = ++listSequence
    listLoading.value = true; listError.value = ''
    try {
      const params = new URLSearchParams({ q: query.q, filter: query.filter, sort: query.sort, page: String(query.page) })
      const result = await request<AdminDirectory>(`/api/admin/users?${params}`)
      if (!valid() || sequence !== listSequence) return
      directory.value = result
      accessError.value = ''
    } catch (cause) {
      if (valid() && sequence === listSequence && !denied(cause)) listError.value = message(cause)
    } finally { if (valid() && sequence === listSequence) listLoading.value = false }
  }
  async function loadUser(id: string, refresh = false) {
    if (locked.value) return
    const valid = guard(), sequence = ++detailSequence
    if (selectedId.value !== id) {
      detail.value = null; action.value = idleAction(); confirmed.value = null
    }
    selectedId.value = id
    detailLoading.value = true; detailError.value = ''
    try {
      const result = await request<AdminUserDetail>(`/api/admin/users/${encodeURIComponent(id)}`)
      if (!valid() || sequence !== detailSequence || selectedId.value !== id) return
      detail.value = result
      if (refresh) action.value = idleAction()
    } catch (cause) {
      if (valid() && sequence === detailSequence && !denied(cause)) detailError.value = message(cause)
    } finally { if (valid() && sequence === detailSequence) detailLoading.value = false }
  }

  function send(): Promise<boolean> {
    if (running) return running
    if (!pending) return Promise.resolve(false)
    const current = pending, valid = guard()
    action.value = { kind: current.kind, pending: true, uncertain: false, conflict: false, error: '' }
    let task: Promise<boolean> | null = null
    task = (async () => {
      try {
        const result = await request<AdminUserDetail>(`/api/admin/users/${encodeURIComponent(current.userId)}/${current.kind}`, {
          method: current.kind === 'grants' ? 'POST' : 'PATCH', body: current.body,
        })
        if (!valid() || pending !== current || selectedId.value !== current.userId) return false
        // Invalidate reads begun before this acknowledgement.
        detailSequence++; listSequence++
        detailLoading.value = false; listLoading.value = false
        detail.value = result
        if (directory.value) directory.value = { ...directory.value,
          users: directory.value.users.map(user => user.id === result.user.id ? result.user : user) }
        pending = null; action.value = idleAction()
        confirmed.value = { kind: current.kind, sequence: ++acknowledgement }
        return true
      } catch (cause) {
        if (!valid() || pending !== current) return false
        if (denied(cause)) return false
        const definitive = isDefinitiveRejection(cause)
        const conflict = (cause as { code?: string })?.code === 'revision_conflict'
        if (definitive) pending = null
        action.value = { kind: current.kind, pending: false, uncertain: !definitive, conflict,
          error: conflict ? 'This account changed in another session. Refresh its details, review your draft, then save again.'
            : definitive ? message(cause) : 'The result is not confirmed. Retry this same request to check it safely; tokens will not be added twice.' }
        return false
      } finally { if (running === task) running = null }
    })()
    running = task
    return task
  }
  function mutate(input: AdminMutation) {
    if (locked.value || action.value.conflict || detailLoading.value || !detail.value || accessError.value) return Promise.resolve(false)
    pending = { userId: detail.value.user.id, kind: input.kind,
      body: { ...input.payload, expectedRevision: detail.value.user.revision, mutationId: crypto.randomUUID() } }
    return send()
  }
  function retry() { return action.value.uncertain ? send() : Promise.resolve(false) }
  return {
    directory: readonly(directory), detail: readonly(detail), selectedId: readonly(selectedId),
    listLoading: readonly(listLoading), detailLoading: readonly(detailLoading),
    listError: readonly(listError), detailError: readonly(detailError), accessError: readonly(accessError),
    action: readonly(action), confirmed: readonly(confirmed), locked,
    loadUsers, loadUser, mutate, retry, clear,
  }
}
