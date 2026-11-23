import { createHash, randomUUID } from 'node:crypto'
import { z } from 'zod'
import { getDb } from '../utils/db'
import { assertAccountActive, isAdminUser } from './account-policy'
import { fail, lockOwner, type Db } from './media'
import { cancelUnsubmittedForAccount } from './generation/lifecycle'

const userId = z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/)
const revision = z.number().int().min(1).max(2_147_483_646)
const mutation = { expectedRevision: revision, mutationId: z.string().uuid() }
const settingsSchema = z.object({ ...mutation, nsfwEnabled: z.boolean(), discountPercent: z.number().int().min(0).max(100) }).strict()
const grantSchema = z.object({ ...mutation, amount: z.number().int().min(1).max(1_000_000), note: z.string().trim().min(1).max(500) }).strict()
const statusSchema = z.object({ ...mutation, blocked: z.boolean(), reason: z.string().trim().max(500) }).strict()
  .refine(input => !input.blocked || input.reason.length > 0)
const pageNumber = z.preprocess(value => typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value,
  z.number().int().min(1).max(1_000_000))
const listSchema = z.object({ q: z.string().trim().max(160).default(''),
  filter: z.enum(['all', 'active', 'blocked', 'nsfw', 'discounted']).default('all'),
  sort: z.enum(['newest', 'deposits', 'balance']).default('newest'),
  page: pageNumber.default(1), pageSize: pageNumber.pipe(z.number().max(100)).default(25) }).strict()

function parse<T extends z.ZodType>(schema: T, value: unknown): z.infer<T> {
  const result = schema.safeParse(value)
  if (!result.success) fail(400, 'invalid_admin_request', 'Some fields are missing, unsupported, or outside their limits.')
  return result.data
}
async function assertAdmin(db: Db, actorId: string) {
  if (!isAdminUser(actorId)) fail(403, 'not_admin', 'Administrator access is required')
  await assertAccountActive(db, actorId)
}

export interface AdminUserRow {
  id: string; name: string; email: string; joinedAt: number
  nsfwEnabled: boolean; discountPercent: number; blocked: boolean; blockReason: string; revision: number; isAdmin: boolean
  balance: number; reservedTokens: number; depositedCents: number; testDepositedCents: number
}
function rowDto(row: Record<string, any>): AdminUserRow {
  return { id: row.id, name: row.display_name || row.email || row.id, email: row.email, joinedAt: new Date(row.created_at).getTime(),
    nsfwEnabled: row.nsfw_enabled, discountPercent: row.discount_percent, blocked: row.blocked_at !== null,
    blockReason: row.block_reason, revision: row.admin_revision, isAdmin: isAdminUser(row.id),
    balance: Number(row.balance), reservedTokens: Number(row.reserved),
    depositedCents: Number(row.deposited), testDepositedCents: Number(row.test_deposited) }
}
function userColumns(db: Db) {
  return db`u.*, coalesce(w.balance, 0) AS balance, coalesce(w.reserved, 0) AS reserved,
    coalesce(c.deposited, 0) AS deposited, coalesce(c.test_deposited, 0) AS test_deposited`
}
function userTables(db: Db) {
  // Aggregate each source before joining, so ledger and checkout rows cannot multiply each other.
  return db`app_users u LEFT JOIN (
    SELECT owner_id, sum(amount::bigint - reserved_delta::bigint) AS balance, sum(reserved_delta::bigint) AS reserved
    FROM token_ledger GROUP BY owner_id) w ON w.owner_id = u.id
    LEFT JOIN (SELECT owner_id,
      sum(price_cents::bigint) FILTER (WHERE payment_mode = 'live') AS deposited,
      sum(price_cents::bigint) FILTER (WHERE payment_mode = 'test') AS test_deposited
      FROM token_checkouts WHERE status = 'paid' GROUP BY owner_id) c ON c.owner_id = u.id`
}
export async function listAdminUsers(actorId: string, input: unknown = {}) {
  const db = getDb()
  await assertAdmin(db, actorId)
  const { q, filter, sort, page, pageSize } = parse(listSchema, input)
  // Position searches are literal: '%' and '_' have no wildcard privileges.
  const search = q.toLocaleLowerCase('en-US')
  const where = db`(position(${search} in lower(u.display_name)) > 0 OR position(${search} in lower(u.email)) > 0 OR position(${search} in lower(u.id)) > 0)
    AND (${filter} = 'all' OR (${filter} = 'active' AND u.blocked_at IS NULL)
      OR (${filter} = 'blocked' AND u.blocked_at IS NOT NULL) OR (${filter} = 'nsfw' AND u.nsfw_enabled)
      OR (${filter} = 'discounted' AND u.discount_percent > 0))`
  const order = sort === 'balance' ? db`balance DESC` : sort === 'deposits' ? db`deposited DESC` : db`u.created_at DESC`
  const [rows, counts, stats] = await Promise.all([
    db`SELECT ${userColumns(db)} FROM ${userTables(db)} WHERE ${where}
      ORDER BY ${order}, u.id ASC LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`,
    db`SELECT count(*)::int AS count FROM app_users u WHERE ${where}`,
    db`SELECT count(*)::int AS total, count(*) FILTER (WHERE blocked_at IS NULL)::int AS active,
      (SELECT coalesce(sum(price_cents::bigint), 0) FROM token_checkouts WHERE status = 'paid' AND payment_mode = 'live') AS deposited FROM app_users`,
  ])
  return { users: rows.map(rowDto), total: counts[0]!.count as number, page, pageSize, actorId,
    stats: { totalUsers: stats[0]!.total as number, activeUsers: stats[0]!.active as number, totalDepositedCents: Number(stats[0]!.deposited) } }
}

export interface AdminUserDetail {
  user: AdminUserRow
  transactions: { id: string; userId: string; kind: 'deposit' | 'test_purchase' | 'grant' | 'spend'; amountTokens: number; amountCents: number; createdAt: number; note: string }[]
  activity: { id: string; userId: string; createdAt: number; label: string; actorId: string }[]
  historyTruncated: boolean
}
async function userDetail(db: Db, targetId: string): Promise<AdminUserDetail> {
  const [row] = await db`SELECT ${userColumns(db)} FROM ${userTables(db)} WHERE u.id = ${targetId}`
  if (!row) fail(404, 'not_found', 'Account not found')
  const transactions = await db`SELECT * FROM (
    SELECT id, owner_id, CASE WHEN payment_mode = 'live' THEN 'deposit' ELSE 'test_purchase' END AS kind,
      tokens AS amount_tokens, price_cents AS amount_cents, coalesce(paid_at, created_at) AS created_at,
      CASE WHEN payment_mode = 'live' THEN 'Token purchase' ELSE 'Test purchase — no money received' END AS note
    FROM token_checkouts WHERE owner_id = ${targetId} AND status = 'paid'
    UNION ALL
    SELECT id, owner_id, CASE WHEN kind = 'spend' THEN 'spend' ELSE 'grant' END AS kind,
      amount AS amount_tokens, 0 AS amount_cents, created_at, label AS note
    FROM token_ledger WHERE owner_id = ${targetId} AND kind IN ('welcome', 'admin_grant', 'spend')
    ) entries ORDER BY created_at DESC, id DESC LIMIT 101`
  const activity = await db`SELECT id, actor_id, action, before_state, after_state, reason, created_at
    FROM admin_audit WHERE target_id = ${targetId} ORDER BY created_at DESC, id DESC LIMIT 101`
  return { user: rowDto(row), historyTruncated: transactions.length > 100 || activity.length > 100,
    transactions: transactions.slice(0, 100).map(entry => ({ id: entry.id, userId: targetId, kind: entry.kind,
      amountTokens: Number(entry.amount_tokens), amountCents: Number(entry.amount_cents), createdAt: new Date(entry.created_at).getTime(), note: entry.note })),
    activity: activity.slice(0, 100).map(entry => ({ id: entry.id, userId: targetId, actorId: entry.actor_id,
      createdAt: new Date(entry.created_at).getTime(), label: auditLabel(entry) })) }
}
function auditLabel(row: Record<string, any>): string {
  if (row.action === 'grant') return `Granted ${row.after_state.grantAmount} tokens: ${row.reason}`
  if (row.action === 'status') return row.after_state.blocked ? `Blocked account: ${row.reason}` : 'Unblocked account'
  const changes: string[] = []
  if (row.before_state.nsfwEnabled !== row.after_state.nsfwEnabled) changes.push(`18+ content ${row.after_state.nsfwEnabled ? 'enabled' : 'disabled'}`)
  if (row.before_state.discountPercent !== row.after_state.discountPercent) changes.push(`Generation discount set to ${row.after_state.discountPercent}%`)
  return changes.join('; ') || 'Account settings unchanged'
}
export async function getAdminUser(actorId: string, targetId: string): Promise<AdminUserDetail> {
  const db = getDb()
  await assertAdmin(db, actorId)
  parse(userId, targetId)
  return userDetail(db, targetId)
}

type SettingsInput = z.infer<typeof settingsSchema>
type GrantInput = z.infer<typeof grantSchema>
type StatusInput = z.infer<typeof statusSchema>
type Action = 'settings' | 'grant' | 'status'
function policyState(row: Record<string, any>) {
  return { nsfwEnabled: row.nsfw_enabled as boolean, discountPercent: row.discount_percent as number,
    blocked: row.blocked_at !== null, blockReason: row.block_reason as string, revision: row.admin_revision as number }
}
async function mutate(actorId: string, targetId: string, action: Action, input: SettingsInput | GrantInput | StatusInput): Promise<AdminUserDetail> {
  const db = getDb()
  await assertAdmin(db, actorId)
  parse(userId, targetId)
  const fingerprint = createHash('sha256').update(JSON.stringify({ action, targetId, input })).digest('hex')
  return db.begin(async tx => {
    // Same actor/request serializes even when a retry changes targets. Always acquire this before the owner lock.
    await tx`SELECT pg_advisory_xact_lock(hashtextextended(${`admin-request:${actorId}:${input.mutationId}`}, 1))`
    await lockOwner(tx, targetId)
    await assertAdmin(tx, actorId)
    const [receipt] = await tx`SELECT fingerprint FROM admin_audit WHERE actor_id = ${actorId} AND request_id = ${input.mutationId}`
    if (receipt) {
      if (receipt.fingerprint !== fingerprint) fail(409, 'mutation_id_reused', 'This request ID was already used for another action.')
      return userDetail(tx, targetId)
    }
    const [row] = await tx`SELECT * FROM app_users WHERE id = ${targetId} FOR UPDATE`
    if (!row) fail(404, 'not_found', 'Account not found')
    if (row.admin_revision !== input.expectedRevision) fail(409, 'revision_conflict', 'This account changed. Refresh it before saving again.')
    const before = policyState(row)
    let reason = ''
    let grantAmount: number | undefined
    if (action === 'settings') {
      const settings = input as SettingsInput
      if (before.nsfwEnabled !== settings.nsfwEnabled || before.discountPercent !== settings.discountPercent)
        await tx`UPDATE app_users SET nsfw_enabled = ${settings.nsfwEnabled}, discount_percent = ${settings.discountPercent},
          admin_revision = admin_revision + 1 WHERE id = ${targetId}`
      if (before.nsfwEnabled && !settings.nsfwEnabled) await cancelUnsubmittedForAccount(tx, targetId, 'nsfw_disabled')
    } else if (action === 'status') {
      const status = input as StatusInput
      if (status.blocked && (targetId === actorId || isAdminUser(targetId)))
        fail(409, 'protected_admin', 'Administrator accounts cannot be blocked here.')
      reason = status.blocked ? status.reason : ''
      if (before.blocked !== status.blocked || before.blockReason !== reason)
        await tx`UPDATE app_users SET blocked_at = ${status.blocked ? (row.blocked_at || new Date()) : null},
          block_reason = ${reason}, admin_revision = admin_revision + 1 WHERE id = ${targetId}`
      if (!before.blocked && status.blocked) await cancelUnsubmittedForAccount(tx, targetId, 'account_blocked')
    } else {
      const grant = input as GrantInput
      reason = grant.note
      grantAmount = grant.amount
      await tx`INSERT INTO token_ledger(id, owner_id, kind, amount, idempotency_key, label)
        VALUES (${randomUUID()}, ${targetId}, 'admin_grant', ${grant.amount}, ${`admin:${actorId}:${grant.mutationId}`}, ${grant.note})`
      await tx`UPDATE app_users SET admin_revision = admin_revision + 1 WHERE id = ${targetId}`
    }
    const [updated] = await tx`SELECT * FROM app_users WHERE id = ${targetId}`
    const after = { ...policyState(updated!), ...(grantAmount === undefined ? {} : { grantAmount }) }
    await tx`INSERT INTO admin_audit(id, actor_id, target_id, action, request_id, fingerprint, before_state, after_state, reason)
      VALUES (${randomUUID()}, ${actorId}, ${targetId}, ${action}, ${input.mutationId}, ${fingerprint}, ${tx.json(before)}, ${tx.json(after)}, ${reason})`
    return userDetail(tx, targetId)
  })
}
export async function updateAdminSettings(actorId: string, targetId: string, input: unknown) {
  return mutate(actorId, targetId, 'settings', parse(settingsSchema, input))
}
export async function grantAdminTokens(actorId: string, targetId: string, input: unknown) {
  return mutate(actorId, targetId, 'grant', parse(grantSchema, input))
}
export async function updateAdminStatus(actorId: string, targetId: string, input: unknown) {
  return mutate(actorId, targetId, 'status', parse(statusSchema, input))
}
