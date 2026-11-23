import { isDefinitiveRejection } from '../api/workspace'

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
      let body: unknown
      if (options.body instanceof FormData) {
        // Copy the fields while retaining immutable File bytes for exact retries.
        const form = new FormData()
        for (const [name, value] of options.body.entries()) form.append(name, value)
        body = form
      } else body = options.body === undefined ? undefined : JSON.parse(JSON.stringify(options.body))
      entry = { path, options: { ...options, body } }
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
          if (isDefinitiveRejection(cause) && pending.get(key) === current)
            pending.delete(key)
          throw cause
        })
        .finally(() => {
          current.running = undefined
        })
    }
    return entry.running as Promise<T>
  }
  return {
    run,
    has: (key: string) => pending.has(key),
    forget: (key: string) => pending.delete(key),
    clear: () => pending.clear(),
  }
}
