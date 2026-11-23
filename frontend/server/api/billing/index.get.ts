import { defineEventHandler } from 'h3'
import { requireUser } from '../../utils/auth'
import { getWallet } from '../../services/billing'
export default defineEventHandler(async event => getWallet((await requireUser(event)).id))
