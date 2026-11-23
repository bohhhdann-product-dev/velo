import { defineEventHandler, getRouterParam } from 'h3'
import { requireUser } from '../../../utils/auth'
import { getCheckout } from '../../../services/billing'
export default defineEventHandler(async event => getCheckout((await requireUser(event)).id, getRouterParam(event, 'id') ?? ''))
