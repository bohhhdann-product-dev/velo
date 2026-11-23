import { defineEventHandler, getHeader, getQuery, getRouterParam, sendStream, setHeader, setResponseStatus } from 'h3'
import { requireUser } from '../../../utils/auth'
import { getDb } from '../../../utils/db'
import { fail, ownedAsset } from '../../../services/media'
import { getStorage } from '../../../services/storage'
import { parseMediaRange } from '../../../services/media-range'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const asset = await ownedAsset(getDb(), user.id, getRouterParam(event, 'id') ?? '')
  const variant = getQuery(event).variant ?? 'preview'
  if (variant !== 'preview' && variant !== 'source') fail(400, 'invalid_variant', 'Unknown media variant')
  const key = variant === 'source' ? asset.source_key : asset.preview_key
  if (!key) fail(404, 'preview_unavailable', 'No preview is available for this media')
  const storage = getStorage()
  const { size } = await storage.stat(key)
  const mimeType = variant === 'source' ? asset.mime_type : asset.preview_mime_type ?? 'image/webp'
  setHeader(event, 'Content-Type', mimeType)
  setHeader(event, 'Content-Disposition', 'inline')
  setHeader(event, 'Cache-Control', 'private, no-store')
  setHeader(event, 'X-Content-Type-Options', 'nosniff')
  setHeader(event, 'Cross-Origin-Resource-Policy', 'same-origin')
  setHeader(event, 'Accept-Ranges', 'bytes')
  let range: ReturnType<typeof parseMediaRange>
  try { range = parseMediaRange(getHeader(event, 'range'), size) }
  catch {
    setResponseStatus(event, 416)
    setHeader(event, 'Content-Range', `bytes */${size}`)
    return null
  }
  if (range) {
    setResponseStatus(event, 206)
    setHeader(event, 'Content-Range', `bytes ${range.start}-${range.end}/${size}`)
  }
  setHeader(event, 'Content-Length', range ? range.end - range.start + 1 : size)
  return sendStream(event, await storage.stream(key, range ?? undefined))
})
