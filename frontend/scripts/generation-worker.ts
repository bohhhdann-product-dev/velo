import { runGenerationWorkerOnce } from '../server/services/generation/worker'
import { generationConfig } from '../server/services/generation/config'
import { voplicaConfig } from '../server/services/generation/voplica-config'
import { closeDb } from '../server/utils/db'
let stopping = false
process.on('SIGINT', () => { stopping = true })
process.on('SIGTERM', () => { stopping = true })
try {
  const args = process.argv.slice(2)
  if (args.some(arg => arg !== '--once') || args.length > 1) throw new Error('Invalid arguments')
  if (!generationConfig().modelArkConfigured && !voplicaConfig().configured) throw new Error('No provider is configured')
  do {
    const worked = await runGenerationWorkerOnce()
    if (args.includes('--once')) break
    if (!worked) await new Promise(resolve => setTimeout(resolve, 1000))
  } while (!stopping)
} catch {
  console.error('Generation worker stopped. Check provider configuration, migrations, database, and storage access. No unconfirmed submission is retried.')
  process.exitCode = 1
} finally { await closeDb() }
