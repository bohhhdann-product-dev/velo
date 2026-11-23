import { defineEventHandler, getRouterParam } from 'h3'
import { requireUser } from '../../../../utils/auth'
import { readJsonBody } from '../../../../utils/request'
import { favoriteTake } from '../../../../services/generations'
export default defineEventHandler(async event => {
  const user = await requireUser(event)
  const body = await readJsonBody(event, 1024) as { favorite?: unknown } | null
  return { generation: await favoriteTake(user.id, getRouterParam(event, 'id') ?? '', getRouterParam(event, 'takeId') ?? '', body?.favorite) }
})
