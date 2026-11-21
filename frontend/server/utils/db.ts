import postgres from 'postgres'
import { createError } from 'h3'

let database: postgres.Sql | undefined

export function getDb(): postgres.Sql {
  if (!database) {
    const url = process.env.DATABASE_URL
    if (!url) throw createError({ statusCode: 503, statusMessage: 'Database is not configured' })
    database = postgres(url, {
      max: 10,
      idle_timeout: 20,
      connect_timeout: 10,
      onnotice: () => {},
    })
  }
  return database
}

/** Allows graceful shutdown and isolated integration tests. */
export async function closeDb() {
  const current = database
  database = undefined
  await current?.end({ timeout: 5 })
}
