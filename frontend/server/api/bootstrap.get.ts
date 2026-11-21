import { defineEventHandler } from 'h3'
import { requireUser } from '../utils/auth'
import { listProjects } from '../services/projects'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  return { user, projects: await listProjects(user.id), generationEnabled: false as const }
})
