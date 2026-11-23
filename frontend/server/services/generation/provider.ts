import type { Draft } from '../../../app/entities/studio/types'

export type ProviderId = 'modelark' | 'voplica'
export interface GenerationReference {
  nodeId: string
  assetId: string
  characterVersionId?: string
  role: 'reference_image' | 'first_frame' | 'last_frame'
  name?: string
  identitySheet?: boolean
}
export interface GenerationManifest {
  draft: Draft
  prompt: string
  provider?: ProviderId // Pre-Voplica manifests belong to ModelArk.
  providerModel: string
  providerWorkflow?: string
  references: GenerationReference[]
}
export interface ProviderUsage {
  reservedMilli?: string
  chargedMilli?: string
  reversedMilli?: string
  netChargedMilli?: string
  warningCodes: string[]
}
export interface ProviderOutput {
  mode: 'image' | 'video'
  url: string
  posterUrl?: string
  provider?: ProviderId
  fileId?: string
}
export type VideoResult = (
  { status: 'queued' | 'running' } |
  { status: 'failed'; code: string } |
  { status: 'succeeded'; output: ProviderOutput }
) & { usage?: ProviderUsage }
export interface ProviderUploadProgress {
  uploadedBytes: number
  pending?: boolean
  chunkSize?: number
  uploadType?: 'SIMPLE' | 'MULTIPART'
  finalized?: boolean
}
export interface ProviderState { uploads?: string[]; uploadProgress?: Record<string, ProviderUploadProgress> }
export interface PreparationContext {
  state: ProviderState
  save(state: ProviderState): Promise<void>
}
export interface GenerationProvider {
  prepare?(manifest: GenerationManifest, references: string[], context: PreparationContext): Promise<{ ready: boolean; references: string[] }>
  cleanup?(state: ProviderState, save: PreparationContext['save']): Promise<void>
  image(manifest: GenerationManifest, references: string[]): Promise<ProviderOutput>
  video(manifest: GenerationManifest, references: string[], takeId?: string): Promise<string>
  poll(taskId: string): Promise<VideoResult>
}
export class ProviderFailure extends Error {
  constructor(public outcome: 'rejected' | 'unknown' | 'transient', public code: string) { super(code) }
}
