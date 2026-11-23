import type { GenerationCapabilities } from '../../../app/entities/studio/generation'
import { voplicaConfig } from './voplica-config'

const IMAGE_MODEL = 'dola-seedream-5-0-pro-260628'
const VIDEO_MODEL = 'dreamina-seedance-2-5-260628'
const BASE_URL = 'https://ark.ap-southeast.bytepluses.com/api/v3'

export function generationConfig() {
  const key = process.env.ARK_API_KEY ?? ''
  const baseUrl = process.env.ARK_BASE_URL ?? BASE_URL
  const imageModel = process.env.ARK_IMAGE_MODEL ?? IMAGE_MODEL
  const videoModel = process.env.ARK_VIDEO_MODEL ?? VIDEO_MODEL
  const modelAllowed = (value: string, expected: string) => value === expected || /^ep-[a-zA-Z0-9-]+$/.test(value)
  const configured = !!key && baseUrl === BASE_URL && modelAllowed(imageModel, IMAGE_MODEL) && modelAllowed(videoModel, VIDEO_MODEL)
  const modelArkEnabled = process.env.VELA_GENERATION_ENABLED === 'true' && configured
  const voplica = voplicaConfig()
  const enabled = modelArkEnabled || voplica.enabled
  return { key, baseUrl, imageModel, videoModel, enabled, modelArkEnabled, modelArkConfigured: configured,
    reason: enabled ? null : configured || voplica.configured ? 'Generation is paused.' : 'Generation is not connected yet.' }
}
export function generationCapabilities(): GenerationCapabilities {
  const { enabled, reason, modelArkEnabled, modelArkConfigured } = generationConfig()
  const voplica = voplicaConfig()
  const unavailable = (configured: boolean, name: string) => configured ? `${name} generation is paused.` : `${name} is not connected yet.`
  return { enabled, reason, imageModel: 'seedream-5-pro', videoModels: ['seedance-2-5', 'minimax-h3', 'h3-eros-max'],
    imageQualities: ['1k', '2k'], videoQualities: ['480p', '720p'],
    aspects: ['1:1', '16:9', '9:16'], counts: [1, 2, 3, 4],
    videoDuration: { min: 4, max: 30, step: 1 }, referenceModes: ['images', 'start-end'],
    maxImageReferences: 6, maxVideoReferences: 15, trial: false, characterVideo: false,
    modelSettings: {
      'seedream-5-pro': { enabled: modelArkEnabled, reason: modelArkEnabled ? null : unavailable(modelArkConfigured, 'Seedream') },
      'seedance-2-5': { enabled: modelArkEnabled, reason: modelArkEnabled ? null : unavailable(modelArkConfigured, 'Seedance'), characterVideo: false },
      'minimax-h3': { enabled: voplica.enabled, reason: voplica.enabled ? null : unavailable(voplica.configured, 'MiniMax'),
        videoQualities: ['720p'], videoDuration: { min: 5, max: 15, step: 5 }, maxVideoReferences: 9, characterVideo: true },
      'h3-eros-max': { enabled: voplica.enabled, reason: voplica.enabled ? null : unavailable(voplica.configured, 'MiniMax'),
        videoQualities: ['720p'], videoDuration: { min: 5, max: 15, step: 5 }, maxVideoReferences: 9, characterVideo: true,
        referenceModes: ['images'] },
    } }
}
