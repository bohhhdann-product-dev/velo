import { defineEventHandler, getRouterParam } from 'h3'
import { requireUser } from '../../utils/auth'
import { parseProjectId } from '../../utils/project-validation'
import { getProject } from '../../services/projects'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  return { project: await getProject(user.id, parseProjectId(getRouterParam(event, 'id'))) }
})
