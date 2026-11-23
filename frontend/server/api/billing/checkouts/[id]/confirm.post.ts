import { defineEventHandler, getRouterParam } from 'h3'
import { requireUser } from '../../../../utils/auth'
import { confirmCheckout } from '../../../../services/billing'
export default defineEventHandler(async event => confirmCheckout((await requireUser(event)).id, getRouterParam(event, 'id') ?? ''))
