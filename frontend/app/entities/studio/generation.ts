import type { Aspect, Draft, ImageQuality, VideoQuality } from './types'

export interface GenerationCapabilities {
  enabled: boolean
  reason: string | null
  imageModel: string
  videoModels: string[]
  imageQualities: ImageQuality[]
  videoQualities: VideoQuality[]
  aspects: Aspect[]
  counts: number[]
  videoDuration: { min: number; max: number; step: number }
  referenceModes: ('images' | 'start-end')[]
  maxImageReferences: number
  maxVideoReferences: number
  trial: boolean
  characterVideo: boolean
  modelSettings?: Record<string, Partial<Omit<GenerationCapabilities, 'modelSettings'>>>
}

/** The selected model owns its availability and limits, including character support. */
export function capabilitiesForModel(capabilities: GenerationCapabilities, draft: Pick<Draft, 'modelId'>): GenerationCapabilities {
  return { ...capabilities, ...capabilities.modelSettings?.[draft.modelId] }
}

/** Keep Seedance as its existing default; prefer Eros when only Voplica is available. */
export function preferredVideoModel(capabilities: GenerationCapabilities, character = false): string | undefined {
  return ['seedance-2-5', 'h3-eros-max', 'minimax-h3', ...capabilities.videoModels].find((modelId) => {
    const model = capabilitiesForModel(capabilities, { modelId })
    return capabilities.videoModels.includes(modelId) && model.enabled && (!character || model.characterVideo)
  })
}

/** Switching models changes unsupported settings, never the prompt or canvas inputs. */
export function normalizeModelDraft(draft: Draft, capabilities: GenerationCapabilities): Draft {
  const caps = capabilitiesForModel(capabilities, draft)
  const normalized = { ...draft }
  if (!caps.aspects.includes(draft.aspect)) normalized.aspect = caps.aspects[0] ?? draft.aspect
  if (!caps.counts.includes(draft.count)) normalized.count = caps.counts[0] ?? draft.count
  if (!caps.trial) normalized.trial = false
  if (draft.mode === 'image') {
    if (!caps.imageQualities.includes(draft.imageQuality)) normalized.imageQuality = caps.imageQualities[0] ?? draft.imageQuality
  } else {
    if (!caps.videoQualities.includes(draft.videoQuality)) normalized.videoQuality = caps.videoQualities[0] ?? draft.videoQuality
    const { min, max, step } = caps.videoDuration
    const bounded = Math.min(max, Math.max(min, draft.durationS))
    const steps = Math.min(Math.floor((max - min) / step), Math.round((bounded - min) / step))
    normalized.durationS = min + steps * step
  }
  return normalized
}

export function characterVideoBlocked(capabilities: GenerationCapabilities): string {
  if (preferredVideoModel(capabilities, true)) return ''
  const supported = capabilities.videoModels.map((modelId) => capabilitiesForModel(capabilities, { modelId })).find((model) => model.characterVideo)
  return supported?.reason || CHARACTER_VIDEO_REASON
}

export const GENERATION_UNCONFIGURED: GenerationCapabilities = {
  enabled: false,
  reason: 'Generation is not connected yet.',
  imageModel: 'seedream-5-pro', videoModels: ['seedance-2-5'],
  imageQualities: ['1k', '2k'], videoQualities: ['480p', '720p'],
  aspects: ['1:1', '16:9', '9:16'], counts: [1, 2, 3, 4],
  videoDuration: { min: 4, max: 30, step: 1 },
  referenceModes: ['images', 'start-end'], maxImageReferences: 6, maxVideoReferences: 15,
  trial: false, characterVideo: false,
}

export const CHARACTER_VIDEO_REASON = 'Character photos cannot be used directly for BytePlus video. Separate identity authorization is required and is not available in Vela yet; reviewing photos here does not provide it.'
