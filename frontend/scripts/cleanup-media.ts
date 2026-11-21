import { isAbsolute } from 'node:path'
import { cleanupMedia } from '../server/services/media'
import { closeDb } from '../server/utils/db'

async function main() {
  const args = process.argv.slice(2)
  if (args.some((arg) => arg !== '--apply') || args.length > 1)
    throw new Error('Usage: media:cleanup [--apply]')
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required')
  if (process.env.VELA_STORAGE_DRIVER === 'local') {
    if (!process.env.VELA_STORAGE_DIR || !isAbsolute(process.env.VELA_STORAGE_DIR))
      throw new Error('Local cleanup requires an explicit absolute VELA_STORAGE_DIR')
  } else if (process.env.VELA_STORAGE_DRIVER === 's3') {
    if (!process.env.AWS_REGION || !process.env.AWS_S3_BUCKET)
      throw new Error('S3 cleanup requires explicit AWS_REGION and AWS_S3_BUCKET')
  } else throw new Error('Cleanup requires explicit VELA_STORAGE_DRIVER=local or s3')

  const dryRun = !args.includes('--apply')
  const result = await cleanupMedia({ dryRun })
  console.log(JSON.stringify({ mode: dryRun ? 'dry-run' : 'applied',
    deletedAssets: result.deletedAssets.length, orphanObjects: result.orphanKeys.length,
    batchLimit: 100, deletedRetentionDays: 7, orphanRetentionHours: 24 }))
}

try {
  await main()
} catch {
  // Object keys, bucket names, connection strings and SDK exception bodies are private.
  console.error('Media cleanup failed. Check arguments, explicit database/storage configuration, migrations and storage access.')
  process.exitCode = 1
} finally {
  await closeDb()
}
