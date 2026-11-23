import type postgres from 'postgres'
import { assetIsUsed, retireUnusedVersions } from '../media'
import { settleTakeTokens } from '../billing'

/** Caller holds the owner lock. In-flight paid requests must finish normally. */
export async function cancelUnsubmittedForAccount(tx: postgres.TransactionSql, ownerId: string, reason: 'account_blocked' | 'nsfw_disabled') {
  const cancelled = await tx`UPDATE generation_takes t SET status = 'failed', reserved_bytes = 0,
    error_code = ${reason}, error_message = ${reason === 'account_blocked' ? 'This account is blocked.' : '18+ model access was disabled.'},
    lease_token = NULL, lease_until = NULL, updated_at = now()
    FROM generations g WHERE t.generation_id = g.id AND g.owner_id = ${ownerId}
      AND t.status IN ('queued', 'preparing')
      AND (${reason} = 'account_blocked' OR g.manifest->'draft'->>'modelId' = 'h3-eros-max') RETURNING t.id`
  for (const take of cancelled) await settleTakeTokens(tx, ownerId, take.id, 'release')
  await retireUnusedVersions(tx, ownerId)
}

/** Deleted projects retire results only after copied canvas pins disappear. */
export async function retireUnusedGenerations(tx: postgres.TransactionSql, ownerId: string) {
  const retired = await tx`UPDATE generations g SET deleted_at = now() WHERE g.owner_id = ${ownerId} AND g.deleted_at IS NULL
    AND EXISTS (SELECT 1 FROM projects p WHERE p.id = g.project_id AND p.deleted_at IS NOT NULL)
    AND NOT EXISTS (SELECT 1 FROM projects p, jsonb_array_elements(p.board->'nodes') n
      WHERE p.owner_id = ${ownerId} AND p.deleted_at IS NULL AND n->>'generationId' = g.id::text)
    RETURNING g.id`
  for (const generation of retired) {
    const cancelled = await tx`UPDATE generation_takes SET status = 'failed', reserved_bytes = 0, error_code = 'project_deleted', error_message = 'The project was deleted.', lease_token = NULL, lease_until = NULL
      WHERE generation_id = ${generation.id} AND status IN ('queued', 'preparing') RETURNING id`
    for (const take of cancelled) await settleTakeTokens(tx, ownerId, take.id, 'release')
    const outputs = await tx`SELECT output_asset_id FROM generation_takes WHERE generation_id = ${generation.id} AND output_asset_id IS NOT NULL`
    for (const output of outputs) if (!await assetIsUsed(tx, ownerId, output.output_asset_id))
      await tx`UPDATE assets SET deleted_at = coalesce(deleted_at, now()) WHERE id = ${output.output_asset_id} AND owner_id = ${ownerId}`
  }
  await retireUnusedVersions(tx, ownerId)
}
