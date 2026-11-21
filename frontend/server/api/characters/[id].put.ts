import { defineEventHandler, getRouterParam } from 'h3'
import { requireUser } from '../../utils/auth'
import { readJsonBody } from '../../utils/request'
import { updateCharacter } from '../../services/characters'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  return { character: await updateCharacter(user.id, getRouterParam(event, 'id') ?? '', await readJsonBody(event, 16 * 1024)) }
})
