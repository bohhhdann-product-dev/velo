import { defineEventHandler } from 'h3'
import { requireUser } from '../../utils/auth'
import { listCharacters } from '../../services/characters'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  return { characters: await listCharacters(user.id) }
})
