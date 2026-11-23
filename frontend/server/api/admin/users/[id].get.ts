import { defineEventHandler, getRouterParam } from 'h3'
import { requireAdmin } from '../../../utils/auth'
import { getAdminUser } from '../../../services/admin'

export default defineEventHandler(async event => {
  const actor = await requireAdmin(event)
  return getAdminUser(actor.id, getRouterParam(event, 'id') ?? '')
})
