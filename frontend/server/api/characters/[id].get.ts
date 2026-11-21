import { defineEventHandler, getRouterParam } from 'h3'
import { requireUser } from '../../utils/auth'
import { getCharacter } from '../../services/characters'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  return { character: await getCharacter(user.id, getRouterParam(event, 'id') ?? '') }
})
