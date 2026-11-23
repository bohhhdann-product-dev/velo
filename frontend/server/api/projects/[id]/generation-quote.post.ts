import { defineEventHandler, getRouterParam } from 'h3'
import { requireUser } from '../../../utils/auth'
import { readJsonBody } from '../../../utils/request'
import { quoteSavedGeneration } from '../../../services/generations'
export default defineEventHandler(async event => {
  const user = await requireUser(event)
  return quoteSavedGeneration(user.id, getRouterParam(event, 'id') ?? '', await readJsonBody(event, 1024))
})
