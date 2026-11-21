import { defineEventHandler } from 'h3'
import { requireUser } from '../../utils/auth'
import { listAssets } from '../../services/media'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  return { assets: await listAssets(user.id) }
})
