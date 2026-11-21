import assert from 'node:assert/strict'
import test from 'node:test'
import { createDraftRecovery, type RecoveryStorage } from '../../app/shared/persistence/recovery'

class MemoryStorage implements RecoveryStorage {
  values = new Map<string, string>()
  blocked = false
  get length() { return this.values.size }
  key(index: number) { return [...this.values.keys()][index] ?? null }
  getItem(key: string) { return this.values.get(key) ?? null }
  removeItem(key: string) { this.values.delete(key) }
  setItem(key: string, value: string) {
    if (this.blocked) throw Object.assign(new Error('Storage full'), { name: 'QuotaExceededError' })
    this.values.set(key, value)
  }
}

test('recovery survives a new coordinator and scopes identical resource IDs by account and kind', () => {
  const storage = new MemoryStorage()
  const recovery = createDraftRecovery(storage)
  recovery.save('user:a', 'project', 'same', { title: 'A private draft', nodes: [], edges: [] }, 4)
  recovery.save('user:b', 'project', 'same', { title: 'B private draft' }, 2)
  recovery.save('user:a', 'character', 'same', { name: 'Character' }, 3)
  const reopened = createDraftRecovery(storage)
  assert.equal(reopened.list('user:a').length, 2)
  assert.equal(reopened.list('user:b').length, 1)
  assert.equal(reopened.list('user').length, 0)
  assert.equal((reopened.list('user:a').find((draft) => draft.kind === 'project')!.payload as { title: string }).title, 'A private draft')
  reopened.remove('user:a', 'project', 'same')
  assert.equal(reopened.list('user:a')[0]!.kind, 'character')
  reopened.clearUser('user:a')
  assert.deepEqual(reopened.list('user:a'), [])
  assert.equal(reopened.list('user:b').length, 1, 'logout clears only the previous account')
})

test('recovery retains asset/version metadata and excludes hydrated delivery/auth data recursively', () => {
  const storage = new MemoryStorage()
  const recovery = createDraftRecovery(storage)
  const payload = {
    title: 'Board', token: 'private-token', authorization: 'Bearer private', ownerId: 'forged-owner',
    nodes: [{ id: 'ref', assetId: 'asset', characterVersionId: 'version', url: 'blob:private', name: 'Face', x: 1, y: 2 }],
    face: { photos: { front: { assetId: 'asset', url: 'data:image/png;base64,private', base64: 'private', bytes: [1, 2] } } },
    sheetUrl: 'https://signed.example/private',
  }
  assert.deepEqual(recovery.save('user', 'project', 'p', payload, 3), { ok: true })
  const draft = recovery.list('user')[0]!
  assert.deepEqual(draft.payload, {
    title: 'Board', nodes: [{ id: 'ref', assetId: 'asset', characterVersionId: 'version', name: 'Face', x: 1, y: 2 }],
    face: { photos: { front: { assetId: 'asset' } } },
  })
  assert.equal(JSON.stringify([...storage.values.values()]).includes('private-token'), false)
  assert.equal(payload.nodes[0]!.url, 'blob:private', 'the live document is never mutated')
})

test('quota and oversized/corrupt writes keep the previous recovery candidate', () => {
  const storage = new MemoryStorage()
  const recovery = createDraftRecovery(storage)
  recovery.save('user', 'project', 'p', { title: 'Recover me' }, 1)
  storage.blocked = true
  assert.deepEqual(recovery.save('user', 'project', 'p', { title: 'Newer' }, 1), { ok: false, reason: 'quota' })
  storage.blocked = false
  assert.deepEqual(recovery.save('user', 'project', 'p', { title: 'x'.repeat(1024 * 1024) }, 1), { ok: false, reason: 'too_large' })
  const cyclic: { self?: unknown } = {}; cyclic.self = cyclic
  assert.deepEqual(recovery.save('user', 'project', 'p', cyclic, 1), { ok: false, reason: 'invalid' })
  assert.equal((recovery.list('user')[0]!.payload as { title: string }).title, 'Recover me')
  storage.values.set('vela:recovery:v1:user:project:broken', '{')
  storage.values.set('vela:recovery:v1:user:project:spoof', JSON.stringify({ ...recovery.list('user')[0], id: 'spoof', userId: 'other' }))
  assert.equal(recovery.list('user').length, 1)
})

test('unavailable storage is explicit and no recovery candidate is applied or discarded implicitly', () => {
  const absent = createDraftRecovery(null)
  assert.deepEqual(absent.save('user', 'character', 'id', { name: 'Draft' }, 0), { ok: false, reason: 'unavailable' })
  assert.deepEqual(absent.list('user'), [])
  const storage = new MemoryStorage()
  const recovery = createDraftRecovery(storage)
  recovery.save('user', 'character', 'id', { name: 'Draft' }, 0)
  const first = recovery.list('user')
  const second = recovery.list('user')
  assert.deepEqual(first, second)
  assert.equal(storage.length, 1, 'reading a candidate leaves the explicit decision to the UI')
})
