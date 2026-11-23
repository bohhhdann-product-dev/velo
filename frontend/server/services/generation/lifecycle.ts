import type postgres from 'postgres'
import { assetIsUsed, retireUnusedVersions } from '../media'

/** Deleted projects retire results only after copied canvas pins disappear. */
export async function retireUnusedGenerations(tx: postgres.TransactionSql, ownerId: string) {
  const retired = await tx`UPDATE generations g SET deleted_at = now() WHERE g.owner_id = ${ownerId} AND g.deleted_at IS NULL
    AND EXISTS (SELECT 1 FROM projects p WHERE p.id = g.project_id AND p.deleted_at IS NOT NULL)
    AND NOT EXISTS (SELECT 1 FROM projects p, jsonb_array_elements(p.board->'nodes') n
      WHERE p.owner_id = ${ownerId} AND p.deleted_at IS NULL AND n->>'generationId' = g.id::text)
    RETURNING g.id`
  for (const generation of retired) {
    await tx`UPDATE generation_takes SET status = 'failed', reserved_bytes = 0, error_code = 'project_deleted', error_message = 'The project was deleted.', lease_token = NULL, lease_until = NULL
      WHERE generation_id = ${generation.id} AND status IN ('queued', 'preparing')`
    const outputs = await tx`SELECT output_asset_id FROM generation_takes WHERE generation_id = ${generation.id} AND output_asset_id IS NOT NULL`
    for (const output of outputs) if (!await assetIsUsed(tx, ownerId, output.output_asset_id))
      await tx`UPDATE assets SET deleted_at = coalesce(deleted_at, now()) WHERE id = ${output.output_asset_id} AND owner_id = ${ownerId}`
  }
  await retireUnusedVersions(tx, ownerId)
}
