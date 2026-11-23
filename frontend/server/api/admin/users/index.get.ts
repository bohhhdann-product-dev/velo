import { defineEventHandler, getQuery } from 'h3'
import { requireAdmin } from '../../../utils/auth'
import { listAdminUsers } from '../../../services/admin'

export default defineEventHandler(async event => {
  const actor = await requireAdmin(event)
  return listAdminUsers(actor.id, getQuery(event))
})
