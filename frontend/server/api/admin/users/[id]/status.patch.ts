import { defineEventHandler, getRouterParam } from 'h3'
import { requireAdmin } from '../../../../utils/auth'
import { readJsonBody } from '../../../../utils/request'
import { updateAdminStatus } from '../../../../services/admin'

export default defineEventHandler(async event => {
  const actor = await requireAdmin(event)
  return updateAdminStatus(actor.id, getRouterParam(event, 'id') ?? '', await readJsonBody(event, 4096))
})
