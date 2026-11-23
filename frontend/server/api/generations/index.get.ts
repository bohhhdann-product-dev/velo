import { defineEventHandler } from 'h3'
import { requireUser } from '../../utils/auth'
import { listGenerations } from '../../services/generations'
export default defineEventHandler(async event => ({ generations: await listGenerations((await requireUser(event)).id) }))
