import { defineEventHandler, setResponseStatus } from 'h3'
import { requireUser } from '../../utils/auth'
import { readJsonBody } from '../../utils/request'
import { createCharacter } from '../../services/characters'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const character = await createCharacter(user.id, await readJsonBody(event, 16 * 1024))
  setResponseStatus(event, 201)
  return { character }
})
