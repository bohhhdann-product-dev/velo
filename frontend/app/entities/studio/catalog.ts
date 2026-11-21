import type { Aspect, Draft, ImageQuality, Mode, VideoQuality } from './types'

/** Default model per generator type; the video picker exposes the supported catalog. */
export const MODELS: Record<Mode, { id: string; label: string }> = {
  image: { id: 'seedream-5-pro', label: 'Seedream 5 Pro' },
  video: { id: 'seedance-2-5', label: 'Seedance 2.5' },
}

export const ASPECTS: { value: Aspect; label: string; shortLabel?: string }[] = [
  { value: '1:1', label: 'Square · 1:1', shortLabel: '1:1' },
  { value: '16:9', label: 'Wide · 16:9', shortLabel: '16:9' },
  { value: '9:16', label: 'Tall · 9:16', shortLabel: '9:16' },
]

export const IMAGE_QUALITIES: { value: ImageQuality; label: string; shortLabel?: string }[] = [
  { value: '1k', label: 'Standard · 1K', shortLabel: '1K' },
  { value: '2k', label: 'High · 2K', shortLabel: '2K' },
]

export const VIDEO_QUALITIES: { value: VideoQuality; label: string; shortLabel?: string }[] = [
  { value: '720p', label: 'Standard · 720p', shortLabel: '720p' },
  { value: '480p', label: 'Draft · 480p', shortLabel: '480p' },
]

export const COUNTS = [1, 2, 3, 4]

export const DURATION = { min: 4, max: 12, step: 2, default: 6 }

/** credits per unit */
const IMAGE_PRICE: Record<ImageQuality, number> = { '1k': 2, '2k': 4 }
export const VIDEO_MODELS = [
  { value: 'seedance-2-5', label: 'Seedance 2.5', maxDuration: 30, maxReferences: 15, rates: { '480p': 5, '720p': 8 } },
  { value: 'seedance-2-0', label: 'Seedance 2.0', maxDuration: 15, maxReferences: 9, rates: { '480p': 4, '720p': 6 } },
  { value: 'seedance-2-0-fast', label: 'Seedance 2.0 Fast', maxDuration: 15, maxReferences: 9, rates: { '480p': 3, '720p': 4 } },
  { value: 'seedance-2-0-mini', label: 'Seedance 2.0 Mini', maxDuration: 15, maxReferences: 9, rates: { '480p': 2, '720p': 3 } },
]
export function videoModel(draft: Draft) {
  return VIDEO_MODELS.find(m => m.value === draft.modelId) ?? VIDEO_MODELS[0]!
}

export function priceCredits(draft: Draft): number {
  if (draft.mode === 'image') return IMAGE_PRICE[draft.imageQuality] * draft.count
  return videoModel(draft).rates[draft.trial ? '480p' : draft.videoQuality] * (draft.trial ? 4 : draft.durationS) * draft.count
}

export function defaultDraft(): Draft {
  return {
    modelId: 'seedream-5-pro',
    trial: false,
    mode: 'image',
    prompt: '',
    aspect: '1:1',
    imageQuality: '1k',
    videoQuality: '720p',
    durationS: DURATION.default,
    count: 2,
    referenceId: null,
  }
}

export function aspectDimensions(aspect: Aspect): { w: number; h: number } {
  if (aspect === '16:9') return { w: 1024, h: 576 }
  if (aspect === '9:16') return { w: 576, h: 1024 }
  return { w: 800, h: 800 }
}

export function aspectRatioCss(aspect: Aspect): string {
  if (aspect === '16:9') return '16 / 9'
  if (aspect === '9:16') return '9 / 16'
  return '1 / 1'
}
