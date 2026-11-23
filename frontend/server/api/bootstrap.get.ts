import { defineEventHandler } from 'h3'
import { requireUser } from '../utils/auth'
import { listProjects } from '../services/projects'
import { listGenerations } from '../services/generations'
import { generationCapabilities } from '../services/generation/config'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const generation = generationCapabilities()
  return { user, projects: await listProjects(user.id), generations: await listGenerations(user.id), generation, generationEnabled: generation.enabled }
})
