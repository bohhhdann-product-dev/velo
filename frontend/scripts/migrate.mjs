import { createHash } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import postgres from 'postgres'

export async function migrate(databaseUrl = process.env.DATABASE_URL) {
  if (!databaseUrl) throw new Error('DATABASE_URL is required; migrations never choose a database implicitly.')
  const sql = postgres(databaseUrl, { max: 1, onnotice: () => {} })
  try {
    // One lock covers discovery and every migration, even across concurrent deploys.
    await sql.begin(async (tx) => {
      await tx`SELECT pg_advisory_xact_lock(8642102026)`
      await tx`CREATE TABLE IF NOT EXISTS schema_migrations (
        name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now()
      )`
      const directory = new URL('../server/db/migrations/', import.meta.url)
      const names = (await readdir(directory)).filter((name) => /^\d+_[a-z0-9_]+\.sql$/.test(name)).sort()
      for (const name of names) {
        const source = await readFile(new URL(name, directory), 'utf8')
        const checksum = createHash('sha256').update(source).digest('hex')
        const [existing] = await tx`SELECT checksum FROM schema_migrations WHERE name = ${name}`
        if (existing) {
          if (existing.checksum !== checksum) throw new Error(`Applied migration changed: ${name}`)
          continue
        }
        await tx.unsafe(source)
        await tx`INSERT INTO schema_migrations (name, checksum) VALUES (${name}, ${checksum})`
        console.log(`Applied ${name}`)
      }
    })
  } finally {
    await sql.end()
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    await migrate()
  } catch (error) {
    // Database exceptions may contain connection details or SQL values.
    const safeCode = /^[A-Z0-9_]{3,32}$/.test(error?.code ?? '') ? ` (${error.code})` : ''
    const safeMessage = /^Applied migration changed: \d+_[a-z0-9_]+\.sql$/.test(error?.message ?? '') ? ` ${error.message}` : ''
    console.error(`Migration failed${safeCode}.${safeMessage} Check database access and migration checksums; credentials are not logged.`)
    process.exitCode = 1
  }
}
