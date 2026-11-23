import type { Draft } from './types'

/** Vela usage tokens are not provider tokens or a withdrawable currency. */
export const BILLING_TOKEN_USD = 0.001
export const PRICING_VERSION = '2026-11-23-v1'
export const MARKUP_PERCENT = 75

export interface GenerationQuote {
  version: string
  discountPercent?: number
  perTakeTokens: number
  totalTokens: number
  providerCostUsd: number
  retailUsd: number
  /** Increment attributable to image references, per output. */
  referenceSurchargeTokens: number
  estimated: boolean
}

// USD/million video tokens, no video input. Still references do not add a fee.
const VIDEO_RATES: Record<string, number> = {
  'seedance-2-5': 10.7,
  'seedance-2-5-flash': 7,
  'seedance-2-0': 7,
  'seedance-2-0-fast': 5.6,
  'seedance-2-0-mini': 3.5,
}
const IMAGE_COST_MICROS: Record<string, number> = {
  'seedream-5-flash': 18_000, 'seedream-5-lite': 35_000,
  'seedream-4-5': 40_000, 'seedream-4-0': 30_000,
}
const pricedTokens = (microUsd: number) => Math.ceil(microUsd * (100 + MARKUP_PERCENT) / 100_000)

/** Server calls this only after validating the draft and resolving actual references.
 * A null quote fails closed: no invented price for a runtime-billed provider.
 * Seedance uses the published 480p/720p pixel-budget estimate. Retail is fixed at
 * admission; actual provider token variance is a Vela cost, never a hidden debit.
 */
export function quoteGeneration(draft: Draft, referenceCount = 0, discountPercent = 0): GenerationQuote | null {
  if (!Number.isSafeInteger(referenceCount) || referenceCount < 0 || referenceCount > 15
    || !Number.isSafeInteger(discountPercent) || discountPercent < 0 || discountPercent > 100
    || !Number.isSafeInteger(draft.count) || draft.count < 1 || draft.count > 4) return null
  let costMicros: number
  let baseMicros: number
  let estimated = false
  if (draft.mode === 'image') {
    if (!['1k', '2k'].includes(draft.imageQuality)) return null
    baseMicros = draft.modelId === 'seedream-5-pro'
      ? (draft.imageQuality === '1k' ? 45_000 : 90_000)
      : IMAGE_COST_MICROS[draft.modelId] ?? 0
    if (!baseMicros) return null
    costMicros = baseMicros + (draft.modelId === 'seedream-5-pro' ? Math.max(0, referenceCount - 1) * 3_000 : 0)
  } else if (draft.mode === 'video') {
    const rate = VIDEO_RATES[draft.modelId]
    const duration = draft.trial ? 4 : draft.durationS
    const quality = draft.trial ? '480p' : draft.videoQuality
    const maxDuration = draft.modelId.startsWith('seedance-2-5') ? 30 : 15
    if (!rate || !Number.isSafeInteger(duration) || duration < 4 || duration > maxDuration
      || !['480p', '720p'].includes(quality)) return null
    const tokensPerSecond = quality === '480p' ? 9_600 : 21_600
    baseMicros = costMicros = Math.round(tokensPerSecond * duration * rate)
    estimated = true
  } else return null
  const discountedTokens = (micros: number) => Math.ceil(pricedTokens(micros) * (100 - discountPercent) / 100)
  const perTakeTokens = discountedTokens(costMicros)
  return {
    version: discountPercent ? `${PRICING_VERSION}:d${discountPercent}` : PRICING_VERSION,
    discountPercent, perTakeTokens, totalTokens: perTakeTokens * draft.count,
    providerCostUsd: costMicros * draft.count / 1_000_000,
    retailUsd: perTakeTokens * draft.count * BILLING_TOKEN_USD,
    referenceSurchargeTokens: perTakeTokens - discountedTokens(baseMicros), estimated,
  }
}
