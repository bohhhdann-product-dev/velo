// Verified against public Voplica catalogue and message specs on 2026-11-21.
export const VOPLICA_BASE_URL = 'https://api.voplica.com'
export const VOPLICA_WORKFLOW = '01M6MQJ5G8ESWMGB3TH7F28PXH'
export const VOPLICA_MODEL = '01M6MQG2J9ZF86MES4FJ4MR1DJ'
export const VOPLICA_EROS_MODEL = '01M765CW9DP2X9GD4MG8G54P2V'
export const VOPLICA_FAMILY = 'MINIMAX_H3'
export const VOPLICA_MODELS = {
  'minimax-h3': { variant: VOPLICA_MODEL, family: VOPLICA_FAMILY, name: 'MiniMax H3' },
  'h3-eros-max': { variant: VOPLICA_EROS_MODEL, family: VOPLICA_FAMILY, name: 'H3 Eros Max · Beta7' },
} as const
export function voplicaConfig() {
  const key = process.env.VOPLICA_API_KEY?.trim() ?? ''
  const configured = !!key
  return { key, configured, baseUrl: VOPLICA_BASE_URL, model: VOPLICA_MODEL, workflow: VOPLICA_WORKFLOW,
    enabled: configured && process.env.VELA_GENERATION_ENABLED === 'true' && process.env.VELA_VOPLICA_ENABLED === 'true' }
}
