import { randomUUID } from 'node:crypto'
import type postgres from 'postgres'
import { z } from 'zod'
import { getDb } from '../utils/db'
import { fail, lockOwner, type Db } from './media'
import { assertAccountActive, getAccountPolicy, isAdminUser } from './account-policy'

export const WELCOME_TOKENS = 500
export const TOKEN_PACKS = [
  { id: 'starter', tokens: 10_000, priceCents: 1_000, currency: 'USD' },
  { id: 'creator', tokens: 25_000, priceCents: 2_500, currency: 'USD' },
  { id: 'studio', tokens: 50_000, priceCents: 5_000, currency: 'USD' },
] as const
export function demoCheckoutEnabled() {
  return process.env.NODE_ENV !== 'production' && process.env.VELA_DEMO_PAYMENTS_ENABLED === 'true'
}
function assertDemoCheckout() {
  if (!demoCheckoutEnabled()) fail(403, 'demo_checkout_disabled', 'Test payments are unavailable in this environment.')
}
// Every wallet mutation runs under the same owner lock as generation admission.
async function ensureWelcome(tx: postgres.TransactionSql, ownerId: string) {
  await tx`INSERT INTO token_ledger(id, owner_id, kind, amount, idempotency_key, label)
    VALUES (${randomUUID()}, ${ownerId}, 'welcome', ${WELCOME_TOKENS}, 'welcome:v1', 'Welcome tokens')
    ON CONFLICT (owner_id, idempotency_key) DO NOTHING`
}
async function balances(db: Db, ownerId: string) {
  const [row] = await db`SELECT coalesce(sum(amount), 0)::bigint AS total,
    coalesce(sum(reserved_delta), 0)::bigint AS reserved FROM token_ledger WHERE owner_id = ${ownerId}`
  const totalTokens = Number(row!.total), reservedTokens = Number(row!.reserved)
  return { totalTokens, reservedTokens, availableTokens: totalTokens - reservedTokens }
}
async function walletDto(db: Db, ownerId: string) {
  const ledger = await db`SELECT id, kind, amount, label, created_at FROM token_ledger
    WHERE owner_id = ${ownerId} ORDER BY created_at DESC, id DESC LIMIT 100`
  const policy = await getAccountPolicy(db, ownerId)
  return { ...await balances(db, ownerId), welcomeTokens: WELCOME_TOKENS,
    discountPercent: policy.discountPercent, nsfwEnabled: policy.nsfwEnabled, isAdmin: isAdminUser(ownerId),
    demoCheckoutEnabled: demoCheckoutEnabled(), tokenUsd: 0.001, packs: TOKEN_PACKS,
    ledger: ledger.map(row => ({ id: row.id as string, kind: row.kind as string, amount: Number(row.amount),
      label: row.label as string, createdAt: new Date(row.created_at).getTime() })) }
}
export async function getWallet(ownerId: string) {
  return getDb().begin(async tx => {
    await lockOwner(tx, ownerId)
    await assertAccountActive(tx, ownerId)
    await ensureWelcome(tx, ownerId)
    return walletDto(tx, ownerId)
  })
}
const checkoutInput = z.object({ packId: z.string(), idempotencyKey: z.string().uuid() }).strict()
const checkoutId = z.string().uuid()
function checkoutDto(row: Record<string, any>) {
  return { id: row.id as string, status: row.status as 'pending' | 'paid', packId: row.pack_id as string,
    tokens: Number(row.tokens), priceCents: Number(row.price_cents), currency: 'USD' as const, demo: row.payment_mode === 'test',
    createdAt: new Date(row.created_at).getTime() }
}
async function ownedCheckout(db: Db, ownerId: string, id: string) {
  if (!checkoutId.safeParse(id).success) fail(404, 'not_found', 'Payment not found.')
  const [row] = await db`SELECT * FROM token_checkouts WHERE id = ${id} AND owner_id = ${ownerId}`
  if (!row) fail(404, 'not_found', 'Payment not found.')
  return row
}
export async function createCheckout(ownerId: string, input: unknown) {
  assertDemoCheckout()
  const parsed = checkoutInput.safeParse(input)
  if (!parsed.success) fail(400, 'invalid_checkout', 'Choose a token pack and provide a unique payment request ID.')
  const { packId, idempotencyKey } = parsed.data
  const pack = TOKEN_PACKS.find(pack => pack.id === packId)
  if (!pack) fail(400, 'invalid_pack', 'This token pack is unavailable.')
  return getDb().begin(async tx => {
    await lockOwner(tx, ownerId)
    await assertAccountActive(tx, ownerId)
    await ensureWelcome(tx, ownerId)
    const [existing] = await tx`SELECT * FROM token_checkouts WHERE owner_id = ${ownerId} AND idempotency_key = ${idempotencyKey}`
    if (existing) {
      if (existing.pack_id !== packId) fail(409, 'payment_id_reused', 'This payment request already belongs to another token pack.')
      return checkoutDto(existing)
    }
    const [count] = await tx`SELECT count(*)::int AS count FROM token_checkouts WHERE owner_id = ${ownerId} AND created_at > now() - interval '1 hour'`
    if (count!.count >= 30) fail(429, 'checkout_limit', 'Too many payment attempts. Try again later.')
    const [row] = await tx`INSERT INTO token_checkouts(id, owner_id, idempotency_key, pack_id, tokens, price_cents)
      VALUES (${randomUUID()}, ${ownerId}, ${idempotencyKey}, ${pack.id}, ${pack.tokens}, ${pack.priceCents}) RETURNING *`
    return checkoutDto(row!)
  })
}
export async function getCheckout(ownerId: string, id: string) {
  return checkoutDto(await ownedCheckout(getDb(), ownerId, id))
}
export async function confirmCheckout(ownerId: string, id: string) {
  assertDemoCheckout()
  return getDb().begin(async tx => {
    await lockOwner(tx, ownerId)
    await assertAccountActive(tx, ownerId)
    const row = await ownedCheckout(tx, ownerId, id)
    if (row.payment_mode !== 'test') fail(403, 'live_payment_required', 'Only verified payment provider events can confirm a live payment.')
    await ensureWelcome(tx, ownerId)
    if (row.status !== 'paid') {
      await tx`INSERT INTO token_ledger(id, owner_id, kind, amount, idempotency_key, label)
        VALUES (${randomUUID()}, ${ownerId}, 'demo_purchase', ${row.tokens}, ${`checkout:${id}`}, ${`Test purchase · ${Number(row.tokens).toLocaleString('en-US')} tokens`})`
      await tx`UPDATE token_checkouts SET status = 'paid', paid_at = now() WHERE id = ${id}`
      row.status = 'paid'
    }
    return { checkout: checkoutDto(row), wallet: await walletDto(tx, ownerId) }
  })
}

/** Caller holds owner lock and creates take in the same transaction. */
export async function reserveTakeTokens(tx: postgres.TransactionSql, ownerId: string, takeId: string, price: number) {
  if (!Number.isSafeInteger(price) || price < 0) fail(503, 'pricing_unavailable', 'Pricing is unavailable for this generation.')
  await ensureWelcome(tx, ownerId)
  await assertProviderSpendingAllowed(tx, ownerId)
  const balance = await balances(tx, ownerId)
  if (balance.availableTokens < price) fail(402, 'insufficient_tokens', 'Not enough tokens. Buy a token pack to continue.')
  await tx`INSERT INTO token_ledger(id, owner_id, kind, amount, reserved_delta, idempotency_key, label)
    VALUES (${randomUUID()}, ${ownerId}, 'reserve', 0, ${price}, ${`take:${takeId}:reserve`}, ${`Reserved ${price} tokens for generation`})`
  await tx`UPDATE generation_takes SET price_tokens = ${price}, token_state = 'reserved' WHERE id = ${takeId}`
}
/** Recheck at worker submission: a dev-accepted job must not bypass a later production guard. */
export async function assertProviderSpendingAllowed(tx: postgres.TransactionSql, ownerId: string) {
  await assertAccountActive(tx, ownerId)
  if (process.env.NODE_ENV === 'production' || process.env.VELA_ALLOW_DEMO_PROVIDER_SPEND !== 'true') {
    const [demo] = await tx`SELECT 1 FROM token_ledger WHERE owner_id = ${ownerId} AND kind = 'demo_purchase' LIMIT 1`
    if (demo) fail(403, 'demo_provider_spend_blocked', 'Test tokens cannot pay for live generation in this environment.')
  }
}
/** Finalization is idempotent, owner-locked and atomic with the take's terminal transition. */
export async function settleTakeTokens(tx: postgres.TransactionSql, ownerId: string, takeId: string, outcome: 'spend' | 'release') {
  const [take] = await tx`UPDATE generation_takes t SET token_state = ${outcome === 'spend' ? 'spent' : 'released'}
    FROM generations g WHERE t.id = ${takeId} AND t.generation_id = g.id AND g.owner_id = ${ownerId}
    AND t.token_state = 'reserved' RETURNING t.price_tokens`
  if (!take) return
  const price = Number(take.price_tokens)
  await tx`INSERT INTO token_ledger(id, owner_id, kind, amount, reserved_delta, idempotency_key, label)
    VALUES (${randomUUID()}, ${ownerId}, ${outcome}, ${outcome === 'spend' ? -price : 0}, ${-price}, ${`take:${takeId}:settle`},
      ${outcome === 'spend' ? 'Generation completed' : `${price} reserved tokens returned`})`
}
