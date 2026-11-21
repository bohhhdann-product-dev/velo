/** One writer per workspace. Retry the exact mutation after an uncertain response. */
export type SaveState = {
  status: 'saved' | 'pending' | 'saving' | 'error' | 'conflict'
  message?: string
}
type Entry<T> = {
  revision: number
  saved: string
  latest: T
  timer?: ReturnType<typeof setTimeout>
  firstDirty?: number
  pending?: {
    value: T
    fingerprint: string
    mutationId: string
    revision: number
  }
  blocked: boolean
  held: boolean
  due: boolean
}
export function createSaveQueue<T, R>(options: {
  write: (id: string, value: T, revision: number, mutationId: string) => Promise<R>
  revision: (result: R) => number
  saved: (id: string, result: R, sent: T, unchanged: boolean) => void
  state: (id: string, state: SaveState) => void
  dirty?: (id: string, value: T, revision: number) => void
  debounceMs?: number
  maxWaitMs?: number
}) {
  const entries = new Map<string, Entry<T>>()
  let running: Promise<void> | null = null
  let disposed = false
  const fingerprint = (value: T) => JSON.stringify(value)
  function register(id: string, value: T, revision: number) {
    remove(id)
    entries.set(id, {
      latest: value,
      revision,
      saved: fingerprint(value),
      blocked: false,
      held: false,
      due: false,
    })
    options.state(id, { status: 'saved' })
  }
  function remove(id: string) {
    clearTimeout(entries.get(id)?.timer)
    entries.delete(id)
  }
  function update(id: string, value: T) {
    const entry = entries.get(id)
    if (!entry || disposed) return
    entry.latest = value
    if (entry.saved === fingerprint(value) && !entry.pending) return
    options.dirty?.(id, value, entry.revision)
    if (entry.blocked || entry.held) return
    options.state(id, { status: entry.pending ? 'saving' : 'pending' })
    entry.firstDirty ??= Date.now()
    clearTimeout(entry.timer)
    const delay = Math.min(
      options.debounceMs ?? 600,
      Math.max(0, (options.maxWaitMs ?? 2000) - (Date.now() - entry.firstDirty)),
    )
    entry.timer = setTimeout(() => {
      entry.due = true
      void drain()
    }, delay)
  }
  async function process() {
    while (!disposed) {
      const next = [...entries].find(([, e]) => e.due && !e.blocked && !e.held)
      if (!next) return
      const [id, entry] = next
      entry.due = false
      clearTimeout(entry.timer)
      entry.firstDirty = undefined
      if (!entry.pending && entry.saved === fingerprint(entry.latest)) continue
      entry.pending ??= {
        value: JSON.parse(fingerprint(entry.latest)),
        fingerprint: fingerprint(entry.latest),
        mutationId: crypto.randomUUID(),
        revision: entry.revision,
      }
      const pending = entry.pending
      options.state(id, { status: 'saving' })
      try {
        const result = await options.write(
          id,
          pending.value,
          pending.revision,
          pending.mutationId,
        )
        if (disposed || entries.get(id) !== entry) continue
        entry.revision = options.revision(result)
        entry.saved = pending.fingerprint
        entry.pending = undefined
        const unchanged = fingerprint(entry.latest) === entry.saved
        options.saved(id, result, pending.value, unchanged)
        options.state(id, { status: unchanged ? 'saved' : 'pending' })
        if (!unchanged) entry.due = true
      } catch (cause) {
        if (disposed || entries.get(id) !== entry) continue
        entry.blocked = true
        const status = (cause as { status?: number }).status
        options.state(id, {
          status: status === 409 ? 'conflict' : 'error',
          message: cause instanceof Error ? cause.message : 'Could not save changes.',
        })
      }
    }
  }
  function drain(): Promise<void> {
    if (!running)
      running = process().finally(() => {
        running = null
      })
    return running
  }
  async function flush(id: string) {
    const entry = entries.get(id)
    if (!entry) return
    if (entry.held)
      throw new Error(
        'Saving is paused. Resolve the pending action or reload before continuing.',
      )
    clearTimeout(entry.timer)
    entry.due = true
    await drain()
    // A drain can have finished immediately before the flush joined it.
    if (entry.due && !entry.blocked) await drain()
    if (entry.blocked)
      throw new Error('Changes are not saved. Resolve the save error before continuing.')
  }
  async function retry(id: string) {
    const entry = entries.get(id)
    if (!entry) return
    entry.blocked = false
    return flush(id)
  }
  function hold(id: string) {
    const entry = entries.get(id)
    if (entry) {
      entry.held = true
      clearTimeout(entry.timer)
    }
  }
  function release(id: string) {
    const entry = entries.get(id)
    if (entry) {
      entry.held = false
      update(id, entry.latest)
    }
  }
  function dispose() {
    disposed = true
    for (const id of entries.keys()) remove(id)
  }
  return { register, update, remove, flush, retry, hold, release, dispose }
}
