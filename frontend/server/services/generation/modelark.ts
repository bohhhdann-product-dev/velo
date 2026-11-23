import { generationConfig } from './config'
import { ProviderFailure, type GenerationManifest, type GenerationProvider } from './provider'
export { ProviderFailure, type GenerationManifest, type GenerationProvider, type GenerationReference, type ProviderOutput, type VideoResult } from './provider'
const IMAGE_SIZES = { '1k': { '1:1': '1024x1024', '16:9': '1424x800', '9:16': '800x1424' },
  '2k': { '1:1': '2048x2048', '16:9': '2816x1584', '9:16': '1584x2816' } } as const
export function imageRequest(manifest: GenerationManifest, references: string[]) {
  return { model: manifest.providerModel, prompt: manifest.prompt,
    size: IMAGE_SIZES[manifest.draft.imageQuality][manifest.draft.aspect],
    ...(references.length ? { image: references } : {}), output_format: 'png', response_format: 'url', watermark: true }
}
export function videoRequest(manifest: GenerationManifest, references: string[]) {
  const frames = manifest.references.some(ref => ref.role !== 'reference_image')
  return { model: manifest.providerModel,
    content: [ ...(manifest.prompt ? [{ type: 'text', text: manifest.prompt }] : []),
      ...references.map((url, index) => ({ type: 'image_url', image_url: { url }, role: manifest.references[index]!.role })) ],
    resolution: manifest.draft.videoQuality, ratio: frames ? 'adaptive' : manifest.draft.aspect,
    duration: manifest.draft.durationS, generate_audio: true, output_format: 'mp4',
    return_last_frame: true, watermark: true,
    ...(!frames && references.length ? { omni_reference_task_type: 'reference' } : {}) }
}
function outputUrl(value: unknown): value is string { return typeof value === 'string' && value.length <= 8192 && value.startsWith('https://') }
function safeCode(value: unknown) { return typeof value === 'string' && /^[\w.-]{1,100}$/.test(value) ? value : 'provider_error' }

// No SDK automatic retry: a lost paid POST response cannot safely be submitted twice.
export function modelArkProvider(fetcher: typeof fetch = fetch): GenerationProvider {
  async function request(path: string, body?: unknown) {
    const config = generationConfig()
    if (body ? !config.modelArkEnabled : !config.modelArkConfigured) throw new ProviderFailure('rejected', 'generation_disabled')
    let response: Response
    try {
      response = await fetcher(config.baseUrl + path, { method: body ? 'POST' : 'GET',
        headers: { Authorization: `Bearer ${config.key}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(body ? 180_000 : 20_000), redirect: 'error' })
    } catch { throw new ProviderFailure(body ? 'unknown' : 'transient', 'provider_connection_lost') }
    let data: any
    try { data = await response.json() }
    catch { throw new ProviderFailure(body ? 'unknown' : 'transient', 'provider_invalid_response') }
    if (!response.ok) throw new ProviderFailure(!body ? 'transient'
      : response.status >= 400 && response.status < 500 && response.status !== 408 ? 'rejected' : 'unknown', safeCode(data?.error?.code))
    return data
  }
  return {
    async image(manifest, references) {
      const result = await request('/images/generations', imageRequest(manifest, references))
      const url = result?.data?.[0]?.url
      if (!outputUrl(url)) throw new ProviderFailure(result?.error || result?.data?.[0]?.error ? 'rejected' : 'unknown', safeCode(result?.error?.code ?? result?.data?.[0]?.error?.code))
      return { mode: 'image', url }
    },
    async video(manifest, references) {
      const result = await request('/contents/generations/tasks', videoRequest(manifest, references))
      if (typeof result?.id !== 'string' || !/^[\w-]{1,160}$/.test(result.id)) throw new ProviderFailure('unknown', 'provider_missing_task_id')
      return result.id
    },
    async poll(taskId) {
      const result = await request(`/contents/generations/tasks/${encodeURIComponent(taskId)}`)
      if (result.status === 'queued' || result.status === 'running') return { status: result.status }
      if (['failed', 'expired', 'cancelled'].includes(result.status)) return { status: 'failed', code: safeCode(result.error?.code ?? result.status) }
      if (result.status !== 'succeeded' || !outputUrl(result.content?.video_url)) throw new ProviderFailure('transient', 'provider_invalid_response')
      return { status: 'succeeded', output: { mode: 'video', url: result.content.video_url,
        ...(outputUrl(result.content.last_frame_url) ? { posterUrl: result.content.last_frame_url } : {}) } }
    },
  }
}
