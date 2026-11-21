import { defineEventHandler, getRouterParam } from 'h3'
import { requireUser } from '../../utils/auth'
import { readJsonBody } from '../../utils/request'
import { parseProjectDelete, parseProjectId } from '../../utils/project-validation'
import { deleteProject } from '../../services/projects'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const id = parseProjectId(getRouterParam(event, 'id'))
  return await deleteProject(user.id, id, parseProjectDelete(await readJsonBody(event)))
})
