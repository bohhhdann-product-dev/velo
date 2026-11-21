import { defineEventHandler, getRouterParam } from 'h3'
import { requireUser } from '../../utils/auth'
import { deleteAsset } from '../../services/media'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  await deleteAsset(user.id, getRouterParam(event, 'id') ?? '')
  return { deleted: true }
})
