import { defineEventHandler, setResponseStatus } from 'h3'
import { requireUser } from '../../utils/auth'
import { receiveImageUpload } from '../../services/media'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const asset = await receiveImageUpload(user.id, event)
  setResponseStatus(event, 201)
  return { asset }
})
