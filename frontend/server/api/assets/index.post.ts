import { defineEventHandler, setResponseStatus } from 'h3'
import { requireUser } from '../../utils/auth'
import { readImageUpload, uploadImage } from '../../services/media'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const file = await readImageUpload(event)
  const asset = await uploadImage(user.id, file.bytes, file.mime, file.name)
  setResponseStatus(event, 201)
  return { asset }
})
