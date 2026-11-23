import { defineEventHandler, setResponseStatus } from 'h3'
import { requireUser } from '../../../utils/auth'
import { readJsonBody } from '../../../utils/request'
import { createCheckout } from '../../../services/billing'
export default defineEventHandler(async event => {
  const user = await requireUser(event)
  const result = await createCheckout(user.id, await readJsonBody(event, 1024))
  setResponseStatus(event, 201)
  return result
})
