type Options = { method: string; body: unknown }
/** Retain a mutation after transport/5xx failures, when its server outcome is unknown. */
export function createMutationRequests(
  request: <T>(path: string, options: Options) => Promise<T>,
) {
  const pending = new Map<
    string,
    { path: string; options: Options; running?: Promise<unknown> }
  >()
  async function run<T>(key: string, path: string, options: Options): Promise<T> {
    let entry = pending.get(key)
    if (!entry) {
      entry = { path, options: JSON.parse(JSON.stringify(options)) }
      pending.set(key, entry)
    }
    if (!entry.running) {
      const current = entry
      current.running = request<T>(current.path, current.options)
        .then((value) => {
          if (pending.get(key) === current) pending.delete(key)
          return value
        })
        .catch((cause) => {
          const status = (cause as { status?: number }).status
          if (status && status >= 400 && status < 500 && pending.get(key) === current)
            pending.delete(key)
          throw cause
        })
        .finally(() => {
          current.running = undefined
        })
    }
    return entry.running as Promise<T>
  }
  return { run, has: (key: string) => pending.has(key), clear: () => pending.clear() }
}
