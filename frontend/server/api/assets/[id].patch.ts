import { defineEventHandler, getRouterParam } from 'h3'
import { requireUser } from '../../utils/auth'
import { readJsonBody } from '../../utils/request'
import { fail, setAssetFavorite } from '../../services/media'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const body = await readJsonBody(event, 1024)
  if (!body || typeof body !== 'object' || !('favorite' in body)) fail(400, 'invalid_favorite', 'Favorite must be true or false')
  return { asset: await setAssetFavorite(user.id, getRouterParam(event, 'id') ?? '', body.favorite) }
})
