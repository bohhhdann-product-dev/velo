import { createHash } from 'node:crypto'
import { VOPLICA_EROS_MODEL, VOPLICA_MODELS, VOPLICA_WORKFLOW, voplicaConfig } from './voplica-config'
import { ProviderFailure, type GenerationManifest, type GenerationProvider, type ProviderState, type ProviderUsage } from './provider'

const FILES = '/voplica.api.files.FilesService/'
const RUNS = '/voplica.api.workflow.WorkflowExecutionService/'
const MAX_REFERENCE = 30_000_000
const MAX_OUTPUT = 200 * 1024 * 1024
const MAX_RESPONSE = 2 * 1024 * 1024
const SIZES = { '16:9': [1280, 736], '9:16': [736, 1280], '1:1': [960, 960] } as const
type Value = { literal: { stringValue: string } | { int32Value: number } | { floatValue: number } }
  | { mapLiteral: { map: Record<string, Value> } } | { listLiteral: { values: Value[] } }
const string = (value: string): Value => ({ literal: { stringValue: value } })
const integer = (value: number): Value => ({ literal: { int32Value: value } })
const map = (value: Record<string, Value>): Value => ({ mapLiteral: { map: value } })
const list = (value: Value[]): Value => ({ listLiteral: { values: value } })
const identifier = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{1,160}$/.test(value)
const code = (value: unknown, fallback = 'provider_error') => typeof value === 'string' && /^[A-Za-z0-9_.:-]{1,100}$/.test(value) ? value : fallback
const invalid = (reason = 'provider_invalid_response'): never => { throw new ProviderFailure('transient', reason) }

export function voplicaTakeKey(takeId: string) {
  if (!identifier(takeId)) throw new ProviderFailure('rejected', 'invalid_take_id')
  return `vela_${createHash('sha256').update(takeId).digest('hex').slice(0, 24)}`
}

export function voplicaVideoRequest(manifest: GenerationManifest, fileIds: string[], takeId: string) {
  const { draft } = manifest
  const model = VOPLICA_MODELS[draft.modelId as keyof typeof VOPLICA_MODELS]
  const size = SIZES[draft.aspect]
  const first = manifest.references.filter(ref => ref.role === 'first_frame')
  const last = manifest.references.filter(ref => ref.role === 'last_frame')
  const frames = first.length + last.length > 0
  if (!model || model.variant !== manifest.providerModel || draft.mode !== 'video'
    || manifest.providerWorkflow !== VOPLICA_WORKFLOW || !size || draft.videoQuality !== '720p'
    || ![5, 10, 15].includes(draft.durationS) || draft.trial
    || fileIds.length !== manifest.references.length || fileIds.length > 9 || fileIds.some(id => !identifier(id))
    || first.length > 1 || last.length > 1 || (last.length > 0 && !first.length)
    || (frames && manifest.references.some(ref => ref.role === 'reference_image'))
    || (manifest.providerModel === VOPLICA_EROS_MODEL && frames))
    throw new ProviderFailure('rejected', 'unsupported_voplica_parameters')
  // H3 is fixed at 24fps and accepts frame counts congruent to 5 modulo 17.
  const numFrames = Math.ceil((draft.durationS * 24 - 5) / 17) * 17 + 5
  const references = manifest.references.map((ref, index) => {
    const role = ref.role === 'first_frame' ? 1 : ref.role === 'last_frame' ? 2 : ref.identitySheet ? 10 : 11
    return map({ file: map({ file_id: string(fileIds[index]!) }), role: integer(role),
      name: string(ref.name || `ref${index + 1}`),
      ...(role === 11 ? { subject_binding: string(`subject_${index + 1}`), purpose: integer(ref.characterVersionId ? 100 : 1) } : {}) })
  })
  return {
    workflowVariantId: manifest.providerWorkflow,
    visibility: 'PRIVATE', contentPublishPolicy: { publishStage: 'STAGE_NONE', defaultVisibility: 'PRIVATE' },
    idempotencyKey: voplicaTakeKey(takeId),
    workflowInput: { main: map({ prompt: string(manifest.prompt), base_model_id: string(manifest.providerModel),
      width: integer(size[0]), height: integer(size[1]), num_frames: integer(numFrames),
      frame_rate: { literal: { floatValue: 24 } }, generation_mode: integer(frames ? 21 : 20),
      inference_mode: integer(1), ...(references.length ? { references: list(references) } : {}) }) },
  }
}

function referenceBytes(value: string) {
  if (value.length > Math.ceil(MAX_REFERENCE / 3) * 4 + 40)
    throw new ProviderFailure('rejected', 'reference_too_large')
  const match = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value)
  if (!match || match[2]!.length % 4 !== 0) throw new ProviderFailure('rejected', 'invalid_reference_data')
  const bytes = Buffer.from(match[2]!, 'base64')
  if (!bytes.length || bytes.length > MAX_REFERENCE || bytes.toString('base64') !== match[2])
    throw new ProviderFailure('rejected', 'invalid_reference_data')
  return { bytes, mimeType: `IMAGE_${match[1]!.toUpperCase()}`, extension: match[1]! }
}
function number(value: unknown, fallback?: number): number {
  const parsed = value === undefined && fallback !== undefined ? fallback
    : typeof value === 'number' ? value : typeof value === 'string' && /^\d{1,16}$/.test(value) ? Number(value) : NaN
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : invalid()
}
function uploadType(value: unknown) {
  return value === 'SIMPLE' || value === 1 ? 'SIMPLE' as const
    : value === 'MULTIPART' || value === 2 ? 'MULTIPART' as const : undefined
}
function nested(value: any, ...path: string[]): any {
  for (const key of path) value = value?.mapLiteral?.map?.[key]
  return value
}
function usage(result: any): ProviderUsage {
  const run = result?.workflowExecution
  const output: ProviderUsage = { warningCodes: [] }
  for (const [source, target] of Object.entries({ creditsReservedMilli: 'reservedMilli', creditsChargedMilli: 'chargedMilli',
    creditsReversedMilli: 'reversedMilli', creditsNetChargedMilli: 'netChargedMilli' } as const)) {
    const value = run?.[source]
    if (typeof value === 'string' && /^\d{1,20}$/.test(value)) output[target] = value
    else if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) output[target] = String(value)
  }
  output.warningCodes = [...new Set<string>((Array.isArray(result?.messages) ? result.messages : [])
    .filter((message: any) => message?.severity === 'WARNING' || message?.severity === 2)
    .map((message: any) => code(message.code, 'provider_warning')))].slice(0, 20)
  return output
}

/** Fixed-origin RPC client. Only non-paid preparation/polling may be retried by the worker. */
export function voplicaProvider(fetcher: typeof fetch = fetch): GenerationProvider {
  async function request(path: string, body: unknown, paid = false, uploadHeaders?: Record<string, string>) {
    const config = voplicaConfig()
    if (!config.configured || (paid && !config.enabled)) throw new ProviderFailure('rejected', 'generation_disabled')
    let response: Response
    try {
      response = await fetcher(config.baseUrl + path, { method: 'POST', redirect: 'error',
        headers: { Authorization: `Bearer ${config.key}`, 'Content-Type': uploadHeaders ? 'application/octet-stream' : 'application/json', ...uploadHeaders },
        body: uploadHeaders ? body as BodyInit : JSON.stringify(body), signal: AbortSignal.timeout(uploadHeaders ? 30_000 : 20_000) })
    } catch { throw new ProviderFailure(paid ? 'unknown' : 'transient', 'provider_connection_lost') }
    let data: any
    try {
      const reader = response.body?.getReader()
      if (!reader) throw new Error('empty')
      const chunks: Uint8Array[] = []
      let length = 0
      while (true) {
        const chunk = await reader.read()
        if (chunk.done) break
        length += chunk.value.length
        if (length > MAX_RESPONSE) { await reader.cancel(); throw new Error('large') }
        chunks.push(chunk.value)
      }
      data = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    } catch { throw new ProviderFailure(paid ? 'unknown' : 'transient', 'provider_invalid_response') }
    if (!response.ok) {
      const definitive = response.status >= 400 && response.status < 500 && ![408, 429].includes(response.status)
      throw new ProviderFailure(definitive ? 'rejected' : paid ? 'unknown' : 'transient', code(data?.code, `provider_http_${response.status}`))
    }
    return data
  }
  async function deleteUpload(id: string) {
    try { await request(FILES + 'DeleteFileUpload', { fileId: id }) }
    catch (error) {
      if (!(error instanceof ProviderFailure) || !['not_found', 'provider_http_404'].includes(error.code)) throw error
    }
  }
  return {
    async prepare(manifest, references, context) {
      const uploads = [...context.state.uploads ?? []]
      const progress = { ...context.state.uploadProgress }
      const checkpoint = async () => {
        try { await context.save({ ...context.state, uploads: [...uploads],
          uploadProgress: Object.fromEntries(Object.entries(progress).map(([id, value]) => [id, { ...value }])) }) }
        catch (error) {
          if (error instanceof ProviderFailure && error.code === 'lease_lost') throw error
          throw new ProviderFailure('transient', 'upload_checkpoint_unknown')
        }
      }
      if (references.length !== manifest.references.length || references.length > 9 || uploads.length > references.length
        || uploads.some(id => !identifier(id))) throw new ProviderFailure('rejected', 'invalid_reference_state')
      for (let index = 0; index < references.length; index++) {
        let id = uploads[index]
        if (!id) {
          const file = referenceBytes(references[index]!)
          const initialized = await request(FILES + 'InitFileUpload', { fileSize: String(file.bytes.length),
            mimeType: file.mimeType, fileName: `reference_${index + 1}.${file.extension}`, purpose: 'PRIMARY' })
          id = initialized?.fileUploadInfo?.fileId
          if (!identifier(id)) return invalid('provider_missing_upload_id')
          uploads.push(id)
          const started = initialized.fileUploadInfo
          const initialChunkSize = Number(started.chunkSize)
          progress[id] = { uploadedBytes: 0,
            ...(Number.isSafeInteger(initialChunkSize) && initialChunkSize > 0 && initialChunkSize <= MAX_REFERENCE ? { chunkSize: initialChunkSize } : {}),
            ...(uploadType(started.uploadType) ? { uploadType: uploadType(started.uploadType) } : {}) }
          try { await checkpoint() }
          catch (error) {
            if (error instanceof ProviderFailure && error.code === 'lease_lost') {
              // A definite rejected checkpoint leaves this allocation unowned.
              try { await deleteUpload(id) } catch { /* Preserve the definitive lease failure. */ }
              throw error
            }
            // The DB may have committed before its reply was lost. Re-read the
            // durable state next turn; deleting now could destroy that checkpoint.
            throw new ProviderFailure('transient', 'upload_checkpoint_unknown')
          }
          return { ready: false, references: [] }
        }
        const current = progress[id] ?? { uploadedBytes: 0 }
        if (current.pending) {
          // Progress reads can remain at zero after a successful byte POST.
          // An uncertain non-paid transfer restarts its allocation, never its bytes.
          if (index !== uploads.length - 1) throw new ProviderFailure('rejected', 'invalid_reference_state')
          await deleteUpload(id)
          uploads.pop()
          delete progress[id]
          await checkpoint()
          return { ready: false, references: [] }
        }
        const info = (await request(FILES + 'GetFileUpload', { fileId: id }))?.fileUploadInfo
        if (!info || info.fileId !== id) return invalid()
        if (info.status === 'COMPLETED' || info.status === 3) continue
        if (info.status === 'FAILED' || info.status === 4 || info.status === 'CANCELLED' || info.status === 5)
          throw new ProviderFailure('rejected', 'reference_upload_failed')
        if (info.status === 'PROCESSING' || info.status === 2) return { ready: false, references: [] }
        if (info.status !== 'UPLOADING' && info.status !== 1) return invalid()
        if (current.finalized) return { ready: false, references: [] }
        if (info.uploadExpiresAt && number(info.uploadExpiresAt) <= Date.now())
          throw new ProviderFailure('rejected', 'reference_upload_expired')
        const file = referenceBytes(references[index]!)
        const size = number(info.fileSize), offset = Math.max(number(info.uploadedBytes, 0), number(current.uploadedBytes)),
          chunkSize = number(current.chunkSize ?? info.chunkSize)
        if (size !== file.bytes.length || offset > size || chunkSize <= 0) return invalid()
        if (offset === size) {
          await request(FILES + 'FinalizeFileUpload', { fileId: id, convertFlowType: 'IMAGE_DEFAULT' })
          progress[id] = { ...current, uploadedBytes: size, finalized: true }
          await checkpoint()
          return { ready: false, references: [] }
        }
        const type = current.uploadType ?? uploadType(info.uploadType)
        if (!type) return invalid()
        const simple = type === 'SIMPLE'
        const length = simple ? size : Math.min(chunkSize, size - offset)
        if (length > MAX_REFERENCE || chunkSize > MAX_REFERENCE || offset % chunkSize !== 0 || (simple && offset !== 0)) return invalid('provider_invalid_chunk_size')
        progress[id] = { ...current, uploadedBytes: offset, chunkSize, uploadType: type, pending: true }
        await checkpoint()
        const sent = await request('/storage/upload', file.bytes.subarray(offset, offset + length), false,
          { 'file-id': id, offset: String(offset) })
        if (number(sent?.uploadedBytes) !== offset + length || number(sent?.totalBytes) !== size) return invalid()
        progress[id] = { ...progress[id]!, uploadedBytes: offset + length, pending: false }
        await checkpoint()
        return { ready: false, references: [] }
      }
      return { ready: true, references: uploads }
    },
    async cleanup(state: ProviderState, save) {
      const [id, ...remaining] = state.uploads ?? []
      if (!id) return
      if (!identifier(id)) throw new ProviderFailure('rejected', 'invalid_reference_state')
      await deleteUpload(id)
      const progress = { ...state.uploadProgress }
      delete progress[id]
      await save({ ...state, uploads: remaining, ...(state.uploadProgress ? { uploadProgress: progress } : {}) })
    },
    async image() { throw new ProviderFailure('rejected', 'unsupported_voplica_image') },
    async video(manifest, fileIds, takeId) {
      const result = await request(RUNS + 'ExecuteWorkflow', voplicaVideoRequest(manifest, fileIds, takeId ?? ''), true)
      if (!identifier(result?.workflowExecutionId)) throw new ProviderFailure('unknown', 'provider_missing_task_id')
      return result.workflowExecutionId
    },
    async poll(taskId) {
      if (!identifier(taskId)) throw new ProviderFailure('rejected', 'invalid_task_id')
      const result = await request(RUNS + 'GetWorkflowExecution', { workflowExecutionId: taskId })
      const status = result?.workflowExecution?.status
      const observedUsage = usage(result)
      if (status === 'PENDING' || status === 1) return { status: 'queued', usage: observedUsage }
      if (status === 'RUNNING' || status === 2 || status === 'CANCELLING' || status === 6) return { status: 'running', usage: observedUsage }
      if (status === 'FAILED' || status === 4 || status === 'CANCELLED' || status === 5) {
        const error = (Array.isArray(result.messages) ? result.messages : []).find((message: any) => message?.severity === 'ERROR' || message?.severity === 3)
        return { status: 'failed', code: code(error?.code, 'provider_generation_failed'), usage: observedUsage }
      }
      if (status !== 'COMPLETED' && status !== 3) return invalid()
      const fileId = nested(result.workflowOutput?.data, 'inference_output', 'video', 'id')?.literal?.stringValue
      if (!identifier(fileId)) return { status: 'failed', code: 'provider_empty_output', usage: observedUsage }
      const file = (await request(FILES + 'GetFileInfo', { fileId }))?.file
      let url: URL
      try { url = new URL(file?.uri) } catch { return invalid('provider_invalid_output') }
      if (url.protocol !== 'https:' || url.username || url.password || url.href.length > 8192 || file?.id !== fileId
        || !['VIDEO_MP4', 7009].includes(file?.mimeType)
        || (file.sizeBytes !== undefined && (number(file.sizeBytes) === 0 || number(file.sizeBytes) > MAX_OUTPUT)))
        return invalid('provider_invalid_output')
      return { status: 'succeeded', output: { mode: 'video', provider: 'voplica', fileId, url: url.href }, usage: observedUsage }
    },
  }
}
