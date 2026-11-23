import { createError } from 'h3'
import type { Db } from './media'

export interface AccountPolicy {
  nsfwEnabled: boolean
  discountPercent: number
  blocked: boolean
  revision: number
}

/** Never infer admin status from public claims, email, or request payloads. */
export function isAdminUser(id: string): boolean {
  return (process.env.VELA_ADMIN_USER_IDS ?? '').split(',').map(value => value.trim()).filter(Boolean).includes(id)
}

export async function getAccountPolicy(db: Db, ownerId: string): Promise<AccountPolicy> {
  const [row] = await db`SELECT nsfw_enabled, discount_percent, blocked_at, admin_revision FROM app_users WHERE id = ${ownerId}`
  if (!row) throw createError({ statusCode: 404, statusMessage: 'Account not found', data: { code: 'not_found' } })
  return { nsfwEnabled: row.nsfw_enabled, discountPercent: row.discount_percent,
    blocked: row.blocked_at !== null, revision: row.admin_revision }
}

export async function assertAccountActive(db: Db, ownerId: string): Promise<void> {
  if ((await getAccountPolicy(db, ownerId)).blocked)
    throw createError({ statusCode: 403, statusMessage: 'This account is blocked', data: { code: 'account_blocked' } })
}
