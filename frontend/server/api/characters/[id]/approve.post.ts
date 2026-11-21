import { defineEventHandler, getRouterParam } from 'h3'
import { requireUser } from '../../../utils/auth'
import { readJsonBody } from '../../../utils/request'
import { approveCharacter } from '../../../services/characters'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  return { character: await approveCharacter(user.id, getRouterParam(event, 'id') ?? '', await readJsonBody(event, 1024)) }
})
