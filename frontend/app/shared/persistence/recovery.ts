export type RecoveryKind = 'project' | 'character'
export type RecoveryDraft = {
  version: 1
  userId: string
  kind: RecoveryKind
  id: string
  revision: number
  updatedAt: number
  payload: unknown
}
export type RecoveryStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem' | 'key' | 'length'>
export type RecoverySaveResult = { ok: true } | { ok: false; reason: 'unavailable' | 'quota' | 'too_large' | 'invalid' }

const PREFIX = 'vela:recovery:v1:'
const MAX_BYTES = 1024 * 1024
const sensitiveKey = /url|token|secret|authorization|cookie|base64/i
const privateFields = new Set(['file', 'bytes', 'imagedata', 'ownerid', 'owner_id', 'userid', 'user_id'])

function userPrefix(userId: string) { return `${PREFIX}${encodeURIComponent(userId)}:` }
function storageKey(userId: string, kind: RecoveryKind, id: string) {
  return `${userPrefix(userId)}${kind}:${encodeURIComponent(id)}`
}
function validIdentity(userId: unknown, kind: unknown, id: unknown, revision: unknown) {
  return typeof userId === 'string' && userId.length > 0 && userId.length <= 256
    && (kind === 'project' || kind === 'character')
    && typeof id === 'string' && id.length > 0 && id.length <= 128
    && typeof revision === 'number' && Number.isInteger(revision) && revision >= 0
}
function durablePayload(payload: unknown): unknown {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('Invalid draft')
  // The callers use their durable serializers. This second boundary prevents a
  // mistakenly hydrated object or auth object from writing URLs, bytes or tokens.
  const text = JSON.stringify(payload, (key, value) => {
    if (sensitiveKey.test(key) || privateFields.has(key.toLowerCase())) return undefined
    if (typeof value === 'number' && !Number.isFinite(value)) throw new Error('Invalid number')
    return value
  })
  return JSON.parse(text)
}

/** Candidates for an explicit restore-as-copy prompt; never applies server writes. */
export function createDraftRecovery(storage?: RecoveryStorage | null) {
  let backend: RecoveryStorage | null = null
  try { backend = storage === undefined ? (typeof window === 'undefined' ? null : window.localStorage) : storage } catch { /* Private mode may deny storage. */ }

  function save(userId: string, kind: RecoveryKind, id: string, payload: unknown, revision: number): RecoverySaveResult {
    if (!backend) return { ok: false, reason: 'unavailable' }
    if (!validIdentity(userId, kind, id, revision)) return { ok: false, reason: 'invalid' }
    let serialized: string
    try {
      const draft: RecoveryDraft = { version: 1, userId, kind, id, revision, updatedAt: Date.now(), payload: durablePayload(payload) }
      serialized = JSON.stringify(draft)
      if (new TextEncoder().encode(serialized).length > MAX_BYTES) return { ok: false, reason: 'too_large' }
    } catch { return { ok: false, reason: 'invalid' } }
    try {
      // setItem is atomic on quota failure: retain the previously recovered value.
      backend.setItem(storageKey(userId, kind, id), serialized)
      return { ok: true }
    } catch (error) {
      return { ok: false, reason: (error as { name?: string })?.name === 'QuotaExceededError' ? 'quota' : 'unavailable' }
    }
  }

  function list(userId: string): RecoveryDraft[] {
    if (!backend || !userId) return []
    const drafts: RecoveryDraft[] = []
    try {
      for (let index = 0; index < backend.length; index++) {
        const key = backend.key(index)
        if (!key?.startsWith(userPrefix(userId))) continue
        try {
          const text = backend.getItem(key)
          if (!text || new TextEncoder().encode(text).length > MAX_BYTES) continue
          const draft = JSON.parse(text) as RecoveryDraft
          if (draft.version !== 1 || draft.userId !== userId || !validIdentity(draft.userId, draft.kind, draft.id, draft.revision)
            || !Number.isFinite(draft.updatedAt) || draft.updatedAt < 0 || storageKey(userId, draft.kind, draft.id) !== key) continue
          drafts.push({ ...draft, payload: durablePayload(draft.payload) })
        } catch { /* A corrupt entry cannot prevent loading another user's workspace. */ }
      }
    } catch { return drafts }
    return drafts.sort((a, b) => b.updatedAt - a.updatedAt)
  }

  function remove(userId: string, kind: RecoveryKind, id: string): boolean {
    if (!backend) return false
    try { backend.removeItem(storageKey(userId, kind, id)); return true } catch { return false }
  }
  function clearUser(userId: string): boolean {
    if (!backend || !userId) return false
    try {
      const keys: string[] = []
      for (let index = 0; index < backend.length; index++) {
        const key = backend.key(index)
        if (key?.startsWith(userPrefix(userId))) keys.push(key)
      }
      for (const key of keys) backend.removeItem(key)
      return true
    } catch { return false }
  }
  return { save, list, remove, clearUser }
}
