import { defineEventHandler, getRouterParam, setResponseStatus } from 'h3'
import { requireUser } from '../../../utils/auth'
import { readJsonBody } from '../../../utils/request'
import { createGeneration } from '../../../services/generations'
export default defineEventHandler(async event => {
  const user = await requireUser(event)
  const result = await createGeneration(user.id, getRouterParam(event, 'id') ?? '', await readJsonBody(event, 4096))
  setResponseStatus(event, 202)
  return result
})
