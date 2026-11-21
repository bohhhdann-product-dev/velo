export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message)
  }
}
export function createWorkspaceApi(getToken: () => Promise<string | null>) {
  const requests = new Set<AbortController>()
  let active = true
  return {
    cancel() {
      active = false
      for (const request of requests) request.abort()
      requests.clear()
    },
    async request<T>(
      path: string,
      options: { method?: string; body?: unknown } = {},
    ): Promise<T> {
      if (!active) throw new DOMException('Session changed', 'AbortError')
      const controller = new AbortController()
      requests.add(controller)
      try {
        const token = await getToken()
        if (!active) throw new DOMException('Session changed', 'AbortError')
        if (!token) throw new ApiError(401, 'Your session expired. Sign in again.')
        const multipart = options.body instanceof FormData
        const response = await fetch(path, {
          method: options.method ?? 'GET',
          credentials: 'same-origin',
          signal: controller.signal,
          headers: {
            Authorization: `Bearer ${token}`,
            ...(!multipart && options.body ? { 'Content-Type': 'application/json' } : {}),
          },
          body:
            options.body === undefined
              ? undefined
              : multipart
                ? (options.body as FormData)
                : JSON.stringify(options.body),
        })
        const data = await response.json().catch(() => ({}))
        if (!active) throw new DOMException('Session changed', 'AbortError')
        if (!response.ok)
          throw new ApiError(
            response.status,
            data.message ?? data.statusMessage ?? 'The request could not be completed.',
          )
        return data as T
      } finally {
        requests.delete(controller)
      }
    },
  }
}
export type WorkspaceApi = ReturnType<typeof createWorkspaceApi>
