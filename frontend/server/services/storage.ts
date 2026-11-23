import { mkdir, readFile, writeFile, unlink, readdir, stat, realpath } from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import type { Readable } from 'node:stream'
import { isAbsolute, resolve, sep } from 'node:path'
import { homedir } from 'node:os'
import { S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand, DeleteObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3'

export interface StoredObject { key: string; modifiedAt: Date }
export interface MediaStorage {
  put(key: string, bytes: Buffer, mimeType?: string): Promise<void>
  get(key: string): Promise<Buffer>
  stat(key: string): Promise<{ size: number }>
  stream(key: string, range?: { start: number; end: number }): Promise<Readable>
  remove(key: string): Promise<void>
  list(): AsyncIterable<StoredObject>
}

// Neither a filename, user ID nor a URL is ever accepted as a storage path.
const KEY = /^media\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/(source\.(webp|png|jpg|mp4)|preview\.(webp|png|jpg))$/
function assertKey(key: string) {
  if (!KEY.test(key)) throw new Error('Invalid private media key')
}

export function localStorage(directory: string): MediaStorage {
  if (!isAbsolute(directory)) throw new Error('VELA_STORAGE_DIR must be absolute')
  const root = resolve(directory)
  // Refuse a directory under a web public root, including nested deployments.
  if (root.split(sep).includes('public')) throw new Error('Private media cannot be stored under public')
  let ready: Promise<void> | undefined
  function ensurePrivateRoot() {
    return ready ??= (async () => {
      await mkdir(root, { recursive: true, mode: 0o700 })
      if ((await realpath(root)).split(sep).includes('public'))
        throw new Error('Private media cannot be stored under a symlink to public')
    })()
  }
  function path(key: string) { assertKey(key); return resolve(root, key) }
  return {
    async put(key, bytes) {
      const filename = path(key)
      await ensurePrivateRoot()
      await mkdir(resolve(filename, '..'), { recursive: true, mode: 0o700 })
      await writeFile(filename, bytes, { flag: 'wx', mode: 0o600 })
    },
    get(key) {
      const filename = path(key)
      return ensurePrivateRoot().then(() => readFile(filename))
    },
    async stat(key) {
      const filename = path(key)
      await ensurePrivateRoot()
      return { size: (await stat(filename)).size }
    },
    async stream(key, range) {
      const filename = path(key)
      await ensurePrivateRoot()
      return createReadStream(filename, range)
    },
    async remove(key) {
      await ensurePrivateRoot()
      await unlink(path(key)).catch((error: NodeJS.ErrnoException) => { if (error.code !== 'ENOENT') throw error })
    },
    async *list() {
      await ensurePrivateRoot()
      const directories = await readdir(resolve(root, 'media'), { withFileTypes: true })
        .catch((error: NodeJS.ErrnoException) => { if (error.code === 'ENOENT') return []; throw error })
      for (const directory of directories) {
        if (!directory.isDirectory()) continue
        for (const filename of await readdir(resolve(root, 'media', directory.name))) {
          const key = `media/${directory.name}/${filename}`
          if (!KEY.test(key)) continue
          const info = await stat(path(key)).catch((error: NodeJS.ErrnoException) => {
            if (error.code === 'ENOENT') return null
            throw error
          })
          if (info?.isFile()) yield { key, modifiedAt: info.mtime }
        }
      }
    },
  }
}

export function s3Storage(bucket: string, region: string): MediaStorage {
  if (!bucket || !region) throw new Error('AWS_S3_BUCKET and AWS_REGION are required for S3 storage')
  // Uses the SDK default credential chain (local AWS profile / runtime IAM role).
  const client = new S3Client({ region })
  return {
    async put(key, bytes, mimeType = 'image/webp') {
      assertKey(key)
      await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: bytes,
        ContentType: mimeType, CacheControl: 'private, no-store', IfNoneMatch: '*',
        ServerSideEncryption: 'AES256' }))
    },
    async get(key) {
      assertKey(key)
      const response = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }))
      if (!response.Body) throw new Error('Private object is missing')
      return Buffer.from(await response.Body.transformToByteArray())
    },
    async stat(key) {
      assertKey(key)
      const response = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }))
      if (response.ContentLength === undefined) throw new Error('Private object size is missing')
      return { size: response.ContentLength }
    },
    async stream(key, range) {
      assertKey(key)
      const response = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key,
        ...(range ? { Range: `bytes=${range.start}-${range.end}` } : {}) }))
      if (!response.Body || !('pipe' in response.Body)) throw new Error('Private object stream is missing')
      return response.Body as Readable
    },
    async remove(key) {
      assertKey(key)
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }))
    },
    async *list() {
      let token: string | undefined
      do {
        const page = await client.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: 'media/', ContinuationToken: token }))
        for (const object of page.Contents ?? []) {
          if (object.Key && KEY.test(object.Key) && object.LastModified) yield { key: object.Key, modifiedAt: object.LastModified }
        }
        token = page.IsTruncated ? page.NextContinuationToken : undefined
      } while (token)
    },
  }
}

let storage: MediaStorage | undefined
export function getStorage(): MediaStorage {
  if (storage) return storage
  const driver = process.env.VELA_STORAGE_DRIVER ?? 'local'
  if (driver === 's3') storage = s3Storage(process.env.AWS_S3_BUCKET ?? '', process.env.AWS_REGION ?? '')
  else if (driver === 'local') {
    if (process.env.NODE_ENV === 'production' && !process.env.VELA_STORAGE_DIR)
      throw new Error('Production local storage requires an explicit durable VELA_STORAGE_DIR')
    storage = localStorage(process.env.VELA_STORAGE_DIR ?? resolve(homedir(), '.local/share/vela/media'))
  }
  else throw new Error('VELA_STORAGE_DRIVER must be local or s3')
  return storage
}
