import { defineEventHandler, getRouterParam } from 'h3'
import { requireUser } from '../../utils/auth'
import { readJsonBody } from '../../utils/request'
import { parseProjectId, parseProjectUpdate } from '../../utils/project-validation'
import { updateProject } from '../../services/projects'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const id = parseProjectId(getRouterParam(event, 'id'))
  const input = parseProjectUpdate(await readJsonBody(event))
  return { project: await updateProject(user.id, id, input) }
})
