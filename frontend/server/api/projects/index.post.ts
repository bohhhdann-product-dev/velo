import { defineEventHandler, setResponseStatus } from 'h3'
import { requireUser } from '../../utils/auth'
import { readJsonBody } from '../../utils/request'
import { parseProjectCreate } from '../../utils/project-validation'
import { createProject } from '../../services/projects'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const input = parseProjectCreate(await readJsonBody(event))
  const project = await createProject(user.id, input)
  setResponseStatus(event, 201)
  return { project }
})
