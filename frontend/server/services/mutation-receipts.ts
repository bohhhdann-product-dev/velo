import { createError } from 'h3'
import { getDb } from '../utils/db'

/** An expired accepted mutation must never be mistaken for a new request. */
export function replayReceipt<T>(reply: T | null, replayable: boolean): T {
  if (!replayable || reply === null) throw createError({
    statusCode: 410,
    statusMessage: 'This saved request is too old to replay. Reload to check its result.',
    data: { code: 'receipt_expired' },
  })
  return reply
}

/** Compact snapshots, not their identity. Dry-run and every table are batch bounded. */
export async function compactMutationReplies({ dryRun = true, limit = 100 }: { dryRun?: boolean; limit?: number } = {}) {
  const db = getDb()
  const batch = Number.isSafeInteger(limit) ? Math.min(Math.max(limit, 1), 1000) : 100
  if (dryRun) {
    const receipts = await db`SELECT 1 FROM mutation_receipts WHERE reply IS NOT NULL
      AND created_at <= now() - interval '7 days' ORDER BY created_at LIMIT ${batch}`
    const characters = await db`SELECT 1 FROM character_mutations WHERE response IS NOT NULL
      AND created_at <= now() - interval '7 days' ORDER BY created_at LIMIT ${batch}`
    return { mutationReceipts: receipts.length, characterMutations: characters.length }
  }
  const receipts = await db`WITH expired AS (
    SELECT owner_id, scope, client_mutation_id FROM mutation_receipts WHERE reply IS NOT NULL
      AND created_at <= now() - interval '7 days' ORDER BY created_at LIMIT ${batch} FOR UPDATE SKIP LOCKED
    ) UPDATE mutation_receipts r SET reply = NULL FROM expired e
      WHERE r.owner_id = e.owner_id AND r.scope = e.scope AND r.client_mutation_id = e.client_mutation_id RETURNING 1`
  const characters = await db`WITH expired AS (
    SELECT character_id, mutation_id FROM character_mutations WHERE response IS NOT NULL
      AND created_at <= now() - interval '7 days' ORDER BY created_at LIMIT ${batch} FOR UPDATE SKIP LOCKED
    ) UPDATE character_mutations r SET response = NULL FROM expired e
      WHERE r.character_id = e.character_id AND r.mutation_id = e.mutation_id RETURNING 1`
  return { mutationReceipts: receipts.length, characterMutations: characters.length }
}
