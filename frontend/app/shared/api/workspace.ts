export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
  ) {
    super(message)
  }
}
export function requiresReload(cause: unknown) {
  const error = cause as { status?: number; code?: string }
  return (
    error?.status === 410 ||
    ['revision_conflict', 'stale_character_revision', 'receipt_expired'].includes(error?.code ?? '')
  )
}
export function isDefinitiveRejection(cause: unknown) {
  const error = cause as { status?: number; code?: string }
  if (error?.code === 'generation_disabled') return true
  return (
    !!error?.status && error.status >= 400 && error.status < 500 &&
    error.status !== 408 && error.status !== 410 && error.code !== 'receipt_expired'
  )
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
        }).catch((cause: unknown) => {
          if (cause instanceof TypeError)
            throw new Error('Couldn’t reach Vela. Check your connection and try again.', { cause })
          throw cause
        })
        // A successful status with an unreadable body still has an unknown outcome.
        const data = response.ok
          ? await response.json()
          : await response.json().catch(() => ({}))
        if (!active) throw new DOMException('Session changed', 'AbortError')
        if (!response.ok)
          throw new ApiError(
            response.status,
            response.status === 410
              ? 'This earlier request can no longer be replayed. Reload to check the saved result before continuing.'
              : typeof data?.data?.message === 'string'
                ? data.data.message
                : data?.message ?? data?.statusMessage ?? 'The request could not be completed.',
            typeof data?.data?.code === 'string' ? data.data.code : undefined,
          )
        return data as T
      } finally {
        requests.delete(controller)
      }
    },
  }
}
export type WorkspaceApi = ReturnType<typeof createWorkspaceApi>
