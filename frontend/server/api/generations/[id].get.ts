import { defineEventHandler, getRouterParam } from 'h3'
import { requireUser } from '../../utils/auth'
import { generationDto } from '../../services/generations'
import { getDb } from '../../utils/db'
export default defineEventHandler(async event => ({ generation: await generationDto(getDb(), (await requireUser(event)).id, getRouterParam(event, 'id') ?? '') }))
