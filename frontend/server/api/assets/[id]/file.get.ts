import { defineEventHandler, getQuery, getRouterParam, setHeader } from 'h3'
import { requireUser } from '../../../utils/auth'
import { getDb } from '../../../utils/db'
import { fail, ownedAsset } from '../../../services/media'
import { getStorage } from '../../../services/storage'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const asset = await ownedAsset(getDb(), user.id, getRouterParam(event, 'id') ?? '')
  const variant = getQuery(event).variant ?? 'preview'
  if (variant !== 'preview' && variant !== 'source') fail(400, 'invalid_variant', 'Unknown image variant')
  const bytes = await getStorage().get(variant === 'source' ? asset.source_key : asset.preview_key)
  setHeader(event, 'Content-Type', 'image/webp')
  setHeader(event, 'Content-Length', bytes.length)
  setHeader(event, 'Content-Disposition', 'inline')
  setHeader(event, 'Cache-Control', 'private, no-store')
  setHeader(event, 'X-Content-Type-Options', 'nosniff')
  setHeader(event, 'Cross-Origin-Resource-Policy', 'same-origin')
  return bytes
})
