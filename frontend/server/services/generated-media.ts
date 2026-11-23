import { createHash, randomUUID } from 'node:crypto'
import sharp from 'sharp'
import type postgres from 'postgres'
import { assertMediaQuota, cleanFilename, fail, MAX_IMAGE_PIXELS, withImageSlot, type AssetRow } from './media'
import { downloadProviderOutput } from './provider-download'
import { getStorage } from './storage'
import type { ProviderId } from './generation/provider'

export const MAX_GENERATED_IMAGE_BYTES = 32 * 1024 * 1024
export const MAX_GENERATED_VIDEO_BYTES = 200 * 1024 * 1024
export const MAX_GENERATED_PREVIEW_BYTES = 5 * 1024 * 1024
export function generatedMediaReservation(mode: 'image' | 'video') {
  return mode === 'video' ? MAX_GENERATED_VIDEO_BYTES + MAX_GENERATED_IMAGE_BYTES
    : MAX_GENERATED_IMAGE_BYTES + MAX_GENERATED_PREVIEW_BYTES
}
type ImageMime = 'image/png' | 'image/jpeg' | 'image/webp'
type ImageExtension = 'png' | 'jpg' | 'webp'
export interface PreparedGeneratedMedia {
  readonly kind: 'generated_image' | 'generated_video'
  readonly source: Buffer
  readonly mimeType: ImageMime | 'video/mp4'
  readonly extension: ImageExtension | 'mp4'
  readonly width: number
  readonly height: number
  readonly preview: { bytes: Buffer; mimeType: ImageMime; extension: ImageExtension } | null
}

async function inspectImage(bytes: Buffer) {
  if (!bytes.length || bytes.length > MAX_GENERATED_IMAGE_BYTES)
    fail(502, 'invalid_provider_output', 'The generated image exceeds the storage limit')
  try {
    const options = { failOn: 'error' as const, limitInputPixels: MAX_IMAGE_PIXELS }
    const metadata = await sharp(bytes, options).metadata()
    if (!['png', 'jpeg', 'webp'].includes(metadata.format ?? '') || (metadata.pages ?? 1) !== 1
      || !metadata.width || !metadata.height || metadata.width * metadata.height > MAX_IMAGE_PIXELS)
      fail(502, 'invalid_provider_output', 'The provider returned an unsupported image')
    const preview = await sharp(bytes, options).rotate().resize(1024, 1024, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 82 }).toBuffer()
    if (preview.length > MAX_GENERATED_PREVIEW_BYTES)
      fail(502, 'invalid_provider_output', 'The generated image preview exceeds the storage limit')
    const rotated = (metadata.orientation ?? 1) >= 5
    return { mimeType: `image/${metadata.format}` as ImageMime,
      extension: (metadata.format === 'jpeg' ? 'jpg' : metadata.format) as ImageExtension,
      width: rotated ? metadata.height : metadata.width, height: rotated ? metadata.width : metadata.height,
      preview }
  } catch (error) {
    if (error && typeof error === 'object' && 'statusCode' in error) throw error
    fail(502, 'invalid_provider_output', 'The generated image could not be decoded safely')
  }
}

type Box = { type: string; start: number; end: number }
function mp4Boxes(bytes: Buffer, start = 0, end = bytes.length): Box[] {
  const result: Box[] = []
  while (start < end) {
    if (end - start < 8 || result.length >= 4096) fail(502, 'invalid_provider_output', 'The provider returned an invalid MP4 file')
    let size = bytes.readUInt32BE(start)
    let header = 8
    if (size === 1) {
      if (end - start < 16) fail(502, 'invalid_provider_output', 'The provider returned an invalid MP4 file')
      size = Number(bytes.readBigUInt64BE(start + 8))
      header = 16
    } else if (size === 0) size = end - start
    if (!Number.isSafeInteger(size) || size < header || size > end - start)
      fail(502, 'invalid_provider_output', 'The provider returned an incomplete MP4 file')
    result.push({ type: bytes.toString('ascii', start + 4, start + 8), start: start + header, end: start + size })
    start += size
  }
  return result
}

export function inspectGeneratedMp4(bytes: Buffer): { width: number; height: number } {
  if (!bytes.length || bytes.length > MAX_GENERATED_VIDEO_BYTES)
    fail(502, 'invalid_provider_output', 'The generated video exceeds the storage limit')
  const boxes = mp4Boxes(bytes)
  const ftyp = boxes.find((box) => box.type === 'ftyp')
  const moov = boxes.find((box) => box.type === 'moov')
  if (!ftyp || ftyp.end - ftyp.start < 8 || ftyp.end - ftyp.start > 4096 || !moov || !boxes.some((box) => box.type === 'mdat' && box.end > box.start))
    fail(502, 'invalid_provider_output', 'The provider returned an unsupported MP4 file')
  const brands = [bytes.toString('ascii', ftyp.start, ftyp.start + 4)]
  for (let offset = ftyp.start + 8; offset + 4 <= ftyp.end; offset += 4) brands.push(bytes.toString('ascii', offset, offset + 4))
  if (!brands.some((brand) => ['isom', 'iso2', 'iso3', 'iso4', 'iso5', 'iso6', 'mp41', 'mp42', 'avc1', 'dash', 'M4V '].includes(brand)))
    fail(502, 'invalid_provider_output', 'The provider returned an unsupported MP4 format')
  for (const track of mp4Boxes(bytes, moov.start, moov.end).filter((box) => box.type === 'trak')) {
    const children = mp4Boxes(bytes, track.start, track.end)
    const tkhd = children.find((box) => box.type === 'tkhd')
    const mdia = children.find((box) => box.type === 'mdia')
    if (!tkhd || !mdia) continue
    const handler = mp4Boxes(bytes, mdia.start, mdia.end).find((box) => box.type === 'hdlr')
    if (!handler || handler.end - handler.start < 12 || bytes.toString('ascii', handler.start + 8, handler.start + 12) !== 'vide') continue
    const version = bytes[tkhd.start]
    const length = version === 0 ? 84 : version === 1 ? 96 : 0
    if (!length || tkhd.end - tkhd.start < length) continue
    const width = bytes.readUInt32BE(tkhd.start + length - 8) / 65536
    const height = bytes.readUInt32BE(tkhd.start + length - 4) / 65536
    if (Number.isInteger(width) && Number.isInteger(height) && width > 0 && height > 0 && width * height <= MAX_IMAGE_PIXELS)
      return { width, height }
  }
  // shortcut: validate MP4 structure/tracks, not every codec frame; add a decoder before accepting arbitrary uploaded videos.
  fail(502, 'invalid_provider_output', 'The generated MP4 has no supported video track')
}

export async function prepareGeneratedMedia(output: { mode: 'image' | 'video'; url: string; posterUrl?: string | null; provider?: ProviderId },
  expectedProvider: ProviderId = 'modelark'): Promise<PreparedGeneratedMedia> {
  const provider = output.provider ?? 'modelark'
  if (provider !== expectedProvider || !['modelark', 'voplica'].includes(provider))
    fail(502, 'invalid_provider_output', 'The media output does not match the generation provider')
  return withImageSlot(async () => {
    const source = await downloadProviderOutput(output.url, output.mode === 'video' ? MAX_GENERATED_VIDEO_BYTES : MAX_GENERATED_IMAGE_BYTES, provider)
    if (output.mode === 'image') {
      const image = await inspectImage(source)
      return { kind: 'generated_image', source, mimeType: image.mimeType, extension: image.extension,
        width: image.width, height: image.height, preview: { bytes: image.preview, mimeType: 'image/webp', extension: 'webp' } }
    }
    const dimensions = inspectGeneratedMp4(source)
    let preview: PreparedGeneratedMedia['preview'] = null
    if (output.posterUrl) {
      const bytes = await downloadProviderOutput(output.posterUrl, MAX_GENERATED_IMAGE_BYTES, provider)
      const poster = await inspectImage(bytes)
      // Preserve the provider's original last frame too; re-encoding can invalidate its content credentials.
      preview = { bytes, mimeType: poster.mimeType, extension: poster.extension }
    }
    return { kind: 'generated_video', source, mimeType: 'video/mp4', extension: 'mp4', ...dimensions, preview }
  })
}

/** Caller holds the owner lock and commits this asset together with its generation result. */
export async function persistGeneratedMedia(tx: postgres.TransactionSql, ownerId: string, name: string,
  media: PreparedGeneratedMedia, writtenKeys: string[]): Promise<AssetRow> {
  const size = media.source.length + (media.preview?.bytes.length ?? 0)
  await assertMediaQuota(tx, ownerId, size)
  const id = randomUUID()
  const sourceKey = `media/${id}/source.${media.extension}`
  const previewKey = media.preview ? `media/${id}/preview.${media.preview.extension}` : null
  const [asset] = await tx<AssetRow[]>`INSERT INTO assets
    (id, owner_id, name, kind, mime_type, preview_mime_type, size_bytes, width, height, source_key, preview_key, sha256)
    VALUES (${id}, ${ownerId}, ${cleanFilename(name)}, ${media.kind}, ${media.mimeType}, ${media.preview?.mimeType ?? null},
      ${size}, ${media.width}, ${media.height}, ${sourceKey}, ${previewKey}, ${createHash('sha256').update(media.source).digest('hex')}) RETURNING *`
  writtenKeys.push(sourceKey)
  await getStorage().put(sourceKey, media.source, media.mimeType)
  if (media.preview && previewKey) {
    writtenKeys.push(previewKey)
    await getStorage().put(previewKey, media.preview.bytes, media.preview.mimeType)
  }
  return asset!
}
