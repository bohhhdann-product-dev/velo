import type postgres from 'postgres'
import { getDb } from '../utils/db'
import { ASSET_ID, assetUrl, fail, lockOwner, ownedAsset, type Db } from './media'

type ReferenceLike = { type: string; assetId?: string; assetKind?: string; characterVersionId?: string }

async function checkReference(db: Db, ownerId: string, node: ReferenceLike, allowDeleted = false) {
  if (node.type !== 'reference') return
  if (!node.assetId) fail(400, 'invalid_reference', 'A reference requires a stored image')
  if (allowDeleted) {
    if (!ASSET_ID.test(node.assetId)) fail(404, 'not_found', 'Image not found')
    const [asset] = await db`SELECT id FROM assets WHERE id = ${node.assetId} AND owner_id = ${ownerId}`
    if (!asset) fail(404, 'not_found', 'Image not found')
  } else await ownedAsset(db, ownerId, node.assetId)
  if (node.assetKind === 'character') {
    if (!node.characterVersionId || !ASSET_ID.test(node.characterVersionId))
      fail(400, 'invalid_reference', 'A character reference requires a published version')
    const [version] = await db`SELECT sheet_asset_id FROM character_versions
      WHERE id = ${node.characterVersionId} AND owner_id = ${ownerId}`
    if (!version || version.sheet_asset_id !== node.assetId) fail(404, 'not_found', 'Character version not found')
  } else if (node.assetKind !== 'image' || node.characterVersionId) {
    fail(400, 'invalid_reference', 'Invalid image reference')
  }
}

export async function validateProjectReferences<T extends ReferenceLike>(tx: postgres.TransactionSql, ownerId: string, nodes: T[]) {
  await lockOwner(tx, ownerId)
  for (const node of nodes) await checkReference(tx, ownerId, node)
}

export async function hydrateProjectReferences<T extends ReferenceLike>(ownerId: string, nodes: T[]): Promise<T[]> {
  const db = getDb()
  const result: T[] = []
  for (const node of nodes) {
    // A receipt can describe an older board whose image has since been deleted.
    // Preserve its accepted result; the file endpoint still denies deleted media.
    await checkReference(db, ownerId, node, true)
    result.push(node.type === 'reference' ? { ...node, url: assetUrl(node.assetId!) } : { ...node })
  }
  return result
}
