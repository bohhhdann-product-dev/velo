import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtemp, rm, stat, mkdir, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import sharp from 'sharp'
import { normalizeImage, MAX_UPLOAD_BYTES } from '../../server/services/media'
import { localStorage } from '../../server/services/storage'
import { editCharacterDocument } from '../../server/services/characters'

test('uploads are decoded, oriented and stripped of metadata; malformed formats fail', async () => {
  const bytes = await sharp({ create: { width: 40, height: 20, channels: 3, background: 'red' } })
    .jpeg().withMetadata({ orientation: 6 }).toBuffer()
  const normalized = await normalizeImage(bytes, 'image/jpeg')
  const info = await sharp(normalized.source).metadata()
  assert.equal(info.format, 'webp')
  assert.equal(info.width, 20)
  assert.equal(info.height, 40)
  assert.equal(info.exif, undefined)
  assert.equal(info.icc, undefined)
  await assert.rejects(normalizeImage(Buffer.from('not an image'), 'image/jpeg'), { statusCode: 415 })
  await assert.rejects(normalizeImage(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>'), 'image/png'), { statusCode: 415 })
  await assert.rejects(normalizeImage(bytes.subarray(0, Math.floor(bytes.length / 2)), 'image/jpeg'), { statusCode: 415 })
  await assert.rejects(normalizeImage(Buffer.alloc(MAX_UPLOAD_BYTES + 1), 'image/png'), { statusCode: 413 })
  const oversized = Buffer.from(bytes)
  const frame = oversized.indexOf(Buffer.from([0xff, 0xc0]))
  assert.ok(frame > 0)
  oversized.writeUInt16BE(8000, frame + 5)
  oversized.writeUInt16BE(6000, frame + 7)
  await assert.rejects(normalizeImage(oversized, 'image/jpeg'), { data: { code: 'invalid_image' } })
})

test('local storage is private, immutable, and rejects public paths or path traversal', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'vela-storage-'))
  try {
    assert.throws(() => localStorage('relative'))
    assert.throws(() => localStorage(join(dir, 'public', 'uploads')))
    await mkdir(join(dir, 'public'))
    await symlink(join(dir, 'public'), join(dir, 'disguised'))
    await assert.rejects(localStorage(join(dir, 'disguised')).put(`media/${randomUUID()}/source.webp`, Buffer.from('private')))
    const storage = localStorage(dir)
    const key = `media/${randomUUID()}/source.webp`
    await storage.put(key, Buffer.from('private'))
    assert.equal((await storage.get(key)).toString(), 'private')
    assert.equal((await stat(join(dir, key))).mode & 0o777, 0o600)
    await assert.rejects(storage.put(key, Buffer.from('overwrite')), { code: 'EEXIST' })
    assert.throws(() => storage.get('../secret'))
    assert.throws(() => storage.get('https://example.com/image.webp'))
    const objects = []
    for await (const object of storage.list()) objects.push(object)
    assert.equal(objects.length, 1)
    await storage.remove(key)
    await assert.rejects(storage.get(key), { code: 'ENOENT' })
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test('untrusted approval/sheet fields are ignored and input changes invalidate dependent approvals', () => {
  const photoId = randomUUID()
  const current = { name: 'Mira', handle: 'mira', revision: 3,
    face: { photos: { front: { assetId: photoId } }, notes: '', approved: true },
    body: { photos: { front: { assetId: photoId } }, notes: '', approved: true },
    sheetAssetId: randomUUID(), characterVersionId: randomUUID(), savedAt: 123 }
  const forged = { ...structuredClone(current), sheetAssetId: 'forged', revision: 900, sheetUrl: 'https://evil.example/photo' }
  assert.deepEqual(editCharacterDocument(current, forged), current)
  forged.face.notes = 'changed'
  const faceEdit = editCharacterDocument(current, forged)
  assert.equal(faceEdit.face.approved, false)
  assert.equal(faceEdit.body.approved, false)
  assert.equal(faceEdit.sheetAssetId, null)
  assert.equal(faceEdit.characterVersionId, null)
  assert.equal(faceEdit.savedAt, null)
  assert.equal(faceEdit.revision, 4)
  const bodyInput = structuredClone(current)
  bodyInput.body.notes = 'changed'
  const bodyEdit = editCharacterDocument(current, bodyInput)
  assert.equal(bodyEdit.face.approved, true)
  assert.equal(bodyEdit.body.approved, false)
})
