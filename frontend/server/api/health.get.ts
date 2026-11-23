import { generationConfig } from '../services/generation/config'
import { defineEventHandler } from 'h3'

// Liveness only. Do not expose database/auth configuration or connection errors.
export default defineEventHandler(() => ({ status: 'ok', generationEnabled: generationConfig().enabled }))
