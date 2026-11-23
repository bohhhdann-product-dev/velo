import assert from 'node:assert/strict'
import test, { after, before } from 'node:test'
import { voplicaProvider, voplicaTakeKey, voplicaVideoRequest } from '../../server/services/generation/voplica'
import { VOPLICA_BASE_URL, VOPLICA_EROS_MODEL, VOPLICA_MODEL, VOPLICA_MODELS, VOPLICA_WORKFLOW, voplicaConfig } from '../../server/services/generation/voplica-config'
import { ProviderFailure, type GenerationManifest, type ProviderState } from '../../server/services/generation/provider'

const previous = { key: process.env.VOPLICA_API_KEY, enabled: process.env.VELA_GENERATION_ENABLED, voplica: process.env.VELA_VOPLICA_ENABLED }
before(() => {
  process.env.VOPLICA_API_KEY = 'synthetic-key-never-sent'
  process.env.VELA_GENERATION_ENABLED = 'true'
  process.env.VELA_VOPLICA_ENABLED = 'true'
})
after(() => {
  for (const [name, value] of Object.entries({ VOPLICA_API_KEY: previous.key, VELA_GENERATION_ENABLED: previous.enabled, VELA_VOPLICA_ENABLED: previous.voplica })) {
    if (value === undefined) delete process.env[name]
    else process.env[name] = value
  }
})
const manifest: GenerationManifest = {
  provider: 'voplica', providerModel: VOPLICA_MODEL, providerWorkflow: VOPLICA_WORKFLOW,
  draft: { mode: 'video', modelId: 'minimax-h3', prompt: 'A forest', aspect: '16:9', imageQuality: '2k',
    videoQuality: '720p', durationS: 5, trial: false, count: 1, referenceId: null },
  prompt: 'A forest', references: [],
}
const withRefs = (references: GenerationManifest['references']): GenerationManifest => ({ ...manifest, references })
const reference = { nodeId: 'node1', assetId: 'asset1', role: 'reference_image' as const, name: 'ref1' }
const unwrap = (value: any): any => value?.mapLiteral ? Object.fromEntries(Object.entries(value.mapLiteral.map).map(([key, item]) => [key, unwrap(item)]))
  : value?.listLiteral ? value.listLiteral.values.map(unwrap) : Object.values(value?.literal ?? {})[0]
const failure = (outcome: ProviderFailure['outcome'], code?: string) => (error: unknown) => error instanceof ProviderFailure
  && error.outcome === outcome && (code === undefined || error.code === code)
const pathOf = (url: unknown) => new URL(String(url)).pathname.split('/').at(-1)!
const fixtureData = `data:image/png;base64,${Buffer.from('0123456789').toString('base64')}`

test('exact model variants, private workflow, take idempotency and H3 timing are explicit', () => {
  assert.equal(VOPLICA_MODELS['h3-eros-max'].variant, '01M765CW9DP2X9GD4MG8G54P2V')
  assert.equal(VOPLICA_MODELS['h3-eros-max'].family, 'MINIMAX_H3')
  assert.equal(voplicaConfig().enabled, true)
  assert.match(voplicaTakeKey('take-1'), /^[A-Za-z0-9_]{1,30}$/)
  assert.equal(voplicaTakeKey('take-1'), voplicaTakeKey('take-1'))
  assert.notEqual(voplicaTakeKey('take-1'), voplicaTakeKey('take-2'))
  const expected = [[5, 124], [10, 243], [15, 362]]
  for (const [seconds, frames] of expected) {
    const request = voplicaVideoRequest({ ...manifest, draft: { ...manifest.draft, durationS: seconds! } }, [], 'take-1')
    assert.equal(request.visibility, 'PRIVATE')
    assert.deepEqual(request.contentPublishPolicy, { publishStage: 'STAGE_NONE', defaultVisibility: 'PRIVATE' })
    assert.deepEqual(Object.keys(request.workflowInput), ['main'], 'No paid refinement/upscale step is requested')
    const input = unwrap(request.workflowInput.main)
    assert.equal(input.base_model_id, VOPLICA_MODEL)
    assert.equal(input.num_frames, frames)
    assert.equal(input.frame_rate, 24)
    assert.deepEqual([input.width, input.height], [1280, 736])
    assert.equal(input.generation_mode, 20)
    assert.equal(input.inference_mode, 1)
    assert.equal(input.references, undefined)
  }
  for (const [aspect, size] of [['1:1', [960, 960]], ['9:16', [736, 1280]]] as const) {
    const input = unwrap(voplicaVideoRequest({ ...manifest, draft: { ...manifest.draft, aspect } }, [], 'take').workflowInput.main)
    assert.deepEqual([input.width, input.height], size)
  }
})

test('reference identity and frame roles remain distinct; Eros never silently falls back to frame conditioning', () => {
  const refs = withRefs([reference, { ...reference, nodeId: 'sheet', assetId: 'sheet', identitySheet: true, characterVersionId: 'version', name: 'ref2' }])
  const input = unwrap(voplicaVideoRequest(refs, ['file1', 'file2'], 'take').workflowInput.main)
  assert.deepEqual(input.references, [
    { file: { file_id: 'file1' }, role: 11, name: 'ref1', subject_binding: 'subject_1', purpose: 1 },
    { file: { file_id: 'file2' }, role: 10, name: 'ref2' },
  ])
  const frames = withRefs([{ ...reference, role: 'first_frame' }, { ...reference, role: 'last_frame', assetId: 'last' }])
  const frameInput = unwrap(voplicaVideoRequest(frames, ['first', 'last'], 'take').workflowInput.main)
  assert.equal(frameInput.generation_mode, 21)
  assert.deepEqual(frameInput.references.map((item: any) => item.role), [1, 2])
  const eros = { ...manifest, providerModel: VOPLICA_EROS_MODEL, draft: { ...manifest.draft, modelId: 'h3-eros-max' as const } }
  assert.equal(unwrap(voplicaVideoRequest(eros, [], 'take').workflowInput.main).base_model_id, VOPLICA_EROS_MODEL)
  assert.throws(() => voplicaVideoRequest({ ...eros, references: frames.references }, ['first', 'last'], 'take'), failure('rejected'))
  assert.throws(() => voplicaVideoRequest(withRefs([{ ...reference, role: 'last_frame' }]), ['last'], 'take'), failure('rejected'))
  assert.throws(() => voplicaVideoRequest({ ...manifest, providerModel: 'other' }, [], 'take'), failure('rejected'))
  assert.throws(() => voplicaVideoRequest({ ...manifest, draft: { ...manifest.draft, durationS: 30 } }, [], 'take'), failure('rejected'))
})

test('paid Execute performs one request; transport/5xx/unreadable success never becomes a new submission', async () => {
  for (const result of ['transport', '500', '429', 'malformed', 'missing-id']) {
    let calls = 0
    const provider = voplicaProvider((async (url, options) => {
      calls++
      assert.equal(String(url), VOPLICA_BASE_URL + '/voplica.api.workflow.WorkflowExecutionService/ExecuteWorkflow')
      assert.equal(options?.redirect, 'error')
      assert.ok(options?.signal)
      assert.equal((options?.headers as any).Authorization, 'Bearer synthetic-key-never-sent')
      assert.equal(JSON.parse(String(options?.body)).idempotencyKey, voplicaTakeKey('take'))
      if (result === 'transport') throw new TypeError('Synthetic lost reply')
      if (result === '500' || result === '429') return Response.json({ code: 'unavailable' }, { status: Number(result) })
      return new Response(result === 'malformed' ? '{' : '{}')
    }) as typeof fetch)
    await assert.rejects(provider.video(manifest, [], 'take'), failure('unknown'))
    assert.equal(calls, 1)
  }
  const rejected = voplicaProvider((async () => Response.json({ code: 'permission_denied', message: 'Do not echo provider detail' }, { status: 403 })) as typeof fetch)
  await assert.rejects(rejected.video(manifest, [], 'take'), failure('rejected', 'permission_denied'))
})

test('submission flags stop paid work but leave status/cleanup available with a configured key', async () => {
  const paths: string[] = []
  const provider = voplicaProvider((async url => {
    paths.push(pathOf(url))
    return Response.json(pathOf(url) === 'GetWorkflowExecution' ? { workflowExecution: { status: 'RUNNING' } } : {})
  }) as typeof fetch)
  process.env.VELA_GENERATION_ENABLED = 'false'
  try {
    await assert.rejects(provider.video(manifest, [], 'take'), failure('rejected', 'generation_disabled'))
    await assert.rejects(provider.image(manifest, []), failure('rejected', 'unsupported_voplica_image'))
    assert.equal((await provider.poll('run')).status, 'running')
    let saved: ProviderState = {}
    await provider.cleanup!({ uploads: ['file'] }, async state => { saved = state })
    assert.deepEqual(saved, { uploads: [] })
    assert.deepEqual(paths, ['GetWorkflowExecution', 'DeleteFileUpload'])
  } finally { process.env.VELA_GENERATION_ENABLED = 'true' }
})

test('durable multipart ACKs override permanently stale progress and preserve Init sizing; lost finalize replies remain pollable', async () => {
  let state: ProviderState = {}, uploaded = 0, phase = 'UPLOADING', initCount = 0, finalizeLost = false
  const sent: { offset: number; bytes: string }[] = [], calls: string[] = []
  const provider = voplicaProvider((async (url, options) => {
    const path = pathOf(url)
    calls.push(path)
    if (path === 'InitFileUpload') {
      initCount++
      assert.deepEqual(JSON.parse(String(options?.body)), { fileSize: '10', mimeType: 'IMAGE_PNG', fileName: 'reference_1.png', purpose: 'PRIMARY' })
      return Response.json({ fileUploadInfo: { fileId: 'file1', chunkSize: '4', uploadType: 'MULTIPART' } })
    }
    assert.deepEqual(state.uploads, ['file1'], 'file identity must be durable before sending its bytes')
    if (path === 'GetFileUpload') return Response.json({ fileUploadInfo: {
      fileId: 'file1', fileSize: '10', uploadedBytes: phase === 'UPLOADING' ? '0' : String(uploaded), chunkSize: '5242880', uploadType: 'MULTIPART', status: phase,
    } })
    if (path === 'upload') {
      const offset = Number((options?.headers as any).offset)
      assert.equal(offset, uploaded, 'advance from acknowledged progress even when GetFileUpload remains at zero')
      assert.equal(state.uploadProgress?.file1?.pending, true, 'attempt is durable before bytes leave the process')
      assert.equal((options?.headers as any)['file-id'], 'file1')
      assert.equal((options?.headers as any)['Content-Type'], 'application/octet-stream')
      const bytes = Buffer.from(options?.body as Uint8Array)
      assert.ok(bytes.length <= 4)
      sent.push({ offset, bytes: bytes.toString() })
      uploaded += bytes.length
      return Response.json({ uploadedBytes: uploaded, totalBytes: 10 })
    }
    assert.equal(path, 'FinalizeFileUpload')
    assert.deepEqual(JSON.parse(String(options?.body)), { fileId: 'file1', convertFlowType: 'IMAGE_DEFAULT' })
    phase = 'PROCESSING'
    if (!finalizeLost) { finalizeLost = true; throw new TypeError('Lost finalize response') }
    throw new Error('Finalize must not repeat after provider reports processing')
  }) as typeof fetch)
  const turn = () => provider.prepare!(withRefs([reference]), [fixtureData], { state, save: async updated => { state = updated } })
  assert.equal((await turn()).ready, false)
  for (let index = 0; index < 3; index++) {
    const before = calls.length
    assert.equal((await turn()).ready, false)
    assert.equal(calls.slice(before).filter(path => path !== 'GetFileUpload').length, 1)
  }
  await assert.rejects(turn(), failure('transient', 'provider_connection_lost'))
  assert.equal((await turn()).ready, false)
  phase = 'COMPLETED'
  assert.deepEqual(await turn(), { ready: true, references: ['file1'] })
  assert.equal(initCount, 1)
  assert.deepEqual(sent, [{ offset: 0, bytes: '0123' }, { offset: 4, bytes: '4567' }, { offset: 8, bytes: '89' }])
})

test('confirmed SIMPLE ACK finalizes without resending despite zero reported progress and changed chunk size', async () => {
  let state: ProviderState = {}, finalized = false, complete = false
  const paths: string[] = []
  const bytes = Buffer.alloc(360, 1)
  const provider = voplicaProvider((async (url, options) => {
    const path = pathOf(url)
    paths.push(path)
    if (path === 'InitFileUpload') return Response.json({ fileUploadInfo: { fileId: 'simple-file', chunkSize: '360', uploadType: 'SIMPLE' } })
    if (path === 'GetFileUpload') return Response.json({ fileUploadInfo: {
      fileId: 'simple-file', fileSize: '360', uploadedBytes: '0', chunkSize: '5242880', uploadType: 'SIMPLE', status: complete ? 'COMPLETED' : 'UPLOADING',
    } })
    if (path === 'upload') {
      assert.equal((options?.headers as any).offset, '0')
      assert.equal((options?.body as Uint8Array).length, 360)
      return Response.json({ uploadedBytes: 360, totalBytes: 360 })
    }
    assert.equal(path, 'FinalizeFileUpload')
    assert.equal(finalized, false, 'successful finalize is not repeated while status reads lag')
    finalized = true
    return Response.json({ asset: { id: 'asset', visibility: 'PRIVATE' } })
  }) as typeof fetch)
  const turn = () => provider.prepare!(withRefs([reference]), [`data:image/webp;base64,${bytes.toString('base64')}`], { state, save: async updated => { state = updated } })
  assert.equal((await turn()).ready, false)
  assert.equal((await turn()).ready, false)
  assert.equal(state.uploadProgress?.['simple-file']?.uploadedBytes, 360)
  assert.equal(state.uploadProgress?.['simple-file']?.pending, false)
  assert.equal((await turn()).ready, false)
  assert.equal((await turn()).ready, false)
  complete = true
  assert.deepEqual(await turn(), { ready: true, references: ['simple-file'] })
  assert.equal(paths.filter(path => path === 'upload').length, 1)
  assert.equal(paths.filter(path => path === 'FinalizeFileUpload').length, 1)
})

test('uncertain byte ACK restarts only the last allocation and preserves completed earlier references', async () => {
  let state: ProviderState = { uploads: ['completed-file', 'uncertain-file'] }
  const paths: string[] = [], uploads: string[] = []
  const provider = voplicaProvider((async (url, options) => {
    const path = pathOf(url)
    paths.push(path)
    if (path === 'InitFileUpload') return Response.json({ fileUploadInfo: { fileId: 'replacement-file', chunkSize: '4', uploadType: 'MULTIPART' } })
    if (path === 'upload') {
      const id = (options?.headers as any)['file-id']
      uploads.push(id)
      if (id === 'uncertain-file') throw new TypeError('Bytes accepted but reply lost')
      assert.equal((options?.headers as any).offset, '0')
      return Response.json({ uploadedBytes: 4, totalBytes: 10 })
    }
    const id = JSON.parse(String(options?.body)).fileId
    if (path === 'DeleteFileUpload') { assert.equal(id, 'uncertain-file'); return Response.json({}) }
    return Response.json({ fileUploadInfo: { fileId: id, status: id === 'completed-file' ? 'COMPLETED' : 'UPLOADING',
      fileSize: '10', uploadedBytes: '0', chunkSize: '4', uploadType: 'MULTIPART' } })
  }) as typeof fetch)
  const turn = () => provider.prepare!(withRefs([reference, reference]), [fixtureData, fixtureData], { state, save: async updated => { state = updated } })
  await assert.rejects(turn(), failure('transient', 'provider_connection_lost'))
  assert.equal(state.uploadProgress?.['uncertain-file']?.pending, true)
  const beforeReset = paths.length
  assert.equal((await turn()).ready, false)
  assert.deepEqual(paths.slice(beforeReset), ['GetFileUpload', 'DeleteFileUpload'])
  assert.deepEqual(state.uploads, ['completed-file'])
  assert.equal(state.uploadProgress?.['uncertain-file'], undefined)
  assert.equal((await turn()).ready, false)
  assert.deepEqual(state.uploads, ['completed-file', 'replacement-file'])
  assert.equal((await turn()).ready, false)
  assert.deepEqual(uploads, ['uncertain-file', 'replacement-file'], 'uncertain bytes never retry against the old allocation')
})

test('lost DB ACK after byte acknowledgement resumes committed progress or resets the uncertain allocation', async () => {
  for (const committed of [false, true]) {
    let durable: ProviderState = { uploads: ['file'] }
    let failCheckpoint = true
    const paths: string[] = []
    const provider = voplicaProvider((async url => {
      const path = pathOf(url)
      paths.push(path)
      if (path === 'GetFileUpload') return Response.json({ fileUploadInfo: {
        fileId: 'file', fileSize: '10', uploadedBytes: '0', chunkSize: '10', uploadType: 'SIMPLE', status: 'UPLOADING',
      } })
      if (path === 'upload') return Response.json({ uploadedBytes: 10, totalBytes: 10 })
      assert.equal(path, committed ? 'FinalizeFileUpload' : 'DeleteFileUpload')
      return Response.json({})
    }) as typeof fetch)
    const turn = () => provider.prepare!(withRefs([reference]), [fixtureData], { state: durable, save: async updated => {
      if (failCheckpoint && updated.uploadProgress?.file?.uploadedBytes === 10) {
        failCheckpoint = false
        if (committed) durable = structuredClone(updated)
        throw new Error('DB ACK lost')
      }
      durable = structuredClone(updated)
    } })
    await assert.rejects(turn(), failure('transient', 'upload_checkpoint_unknown'))
    assert.equal(durable.uploadProgress?.file?.pending, !committed)
    assert.equal((await turn()).ready, false)
    assert.equal(paths.filter(path => path === 'upload').length, 1)
    assert.equal(paths.at(-1), committed ? 'FinalizeFileUpload' : 'DeleteFileUpload')
  }
})

test('each reference gets one persisted file and completed references are reused while later inputs prepare', async () => {
  let state: ProviderState = {}
  const paths: string[] = []
  const provider = voplicaProvider((async (url, options) => {
    paths.push(pathOf(url))
    if (pathOf(url) === 'InitFileUpload') return Response.json({ fileUploadInfo: { fileId: `file${(state.uploads?.length ?? 0) + 1}` } })
    return Response.json({ fileUploadInfo: { fileId: JSON.parse(String(options?.body)).fileId, status: 'COMPLETED' } })
  }) as typeof fetch)
  const turn = () => provider.prepare!(withRefs([reference, reference]), [fixtureData, fixtureData], { state, save: async next => { state = next } })
  assert.equal((await turn()).ready, false)
  assert.equal((await turn()).ready, false)
  assert.deepEqual(await turn(), { ready: true, references: ['file1', 'file2'] })
  assert.equal(paths.filter(path => path === 'InitFileUpload').length, 2)
})

test('definitively lost lease removes the newly allocated file before propagating checkpoint rejection', async () => {
  const calls: string[] = []
  const provider = voplicaProvider((async url => {
    calls.push(pathOf(url))
    return Response.json(pathOf(url) === 'InitFileUpload' ? { fileUploadInfo: { fileId: 'new-file' } } : {})
  }) as typeof fetch)
  const checkpointError = new ProviderFailure('transient', 'lease_lost')
  await assert.rejects(provider.prepare!(withRefs([reference]), [fixtureData], { state: {}, save: async () => { throw checkpointError } }), error => error === checkpointError)
  assert.deepEqual(calls, ['InitFileUpload', 'DeleteFileUpload'])
})

test('committed checkpoint with a lost DB reply keeps its remote file and resumes from durable state', async () => {
  const calls: string[] = []
  let durable: ProviderState = {}
  const provider = voplicaProvider((async url => {
    calls.push(pathOf(url))
    assert.notEqual(pathOf(url), 'DeleteFileUpload', 'Unknown checkpoint outcome must not delete a possibly durable input')
    return Response.json({ fileUploadInfo: { fileId: 'checkpointed-file', status: 'COMPLETED' } })
  }) as typeof fetch)
  await assert.rejects(provider.prepare!(withRefs([reference]), [fixtureData], { state: {}, save: async state => {
    durable = structuredClone(state)
    throw new Error('DB committed; reply lost')
  } }), failure('transient', 'upload_checkpoint_unknown'))
  assert.deepEqual(durable.uploads, ['checkpointed-file'])
  const resumed = await provider.prepare!(withRefs([reference]), [fixtureData], { state: durable, save: async () => { assert.fail('No allocation/checkpoint needed') } })
  assert.deepEqual(resumed, { ready: true, references: ['checkpointed-file'] })
  assert.deepEqual(calls, ['InitFileUpload', 'GetFileUpload'])
})

test('upload input and provider offsets/chunks are bounded; invalid metadata never sends bytes', async () => {
  let calls = 0
  const provider = voplicaProvider((async () => { calls++; throw new Error('Not reached') }) as typeof fetch)
  await assert.rejects(provider.prepare!(withRefs([reference]), ['https://private.example/photo'], { state: {}, save: async () => {} }), failure('rejected'))
  assert.equal(calls, 0, 'adapter never downloads arbitrary reference URLs')
  for (const metadata of [
    { uploadedBytes: '11' }, { uploadedBytes: '1' }, { chunkSize: '0' }, { fileSize: '20' },
    { status: 'FAILED' }, { status: 'UPLOADING', uploadExpiresAt: '1' },
  ]) {
    const requests: string[] = []
    const invalidProvider = voplicaProvider((async url => {
      requests.push(pathOf(url))
      return Response.json({ fileUploadInfo: { fileId: 'file1', fileSize: '10', uploadedBytes: '0', chunkSize: '4',
        uploadType: 'MULTIPART', status: 'UPLOADING', ...metadata } })
    }) as typeof fetch)
    await assert.rejects(invalidProvider.prepare!(withRefs([reference]), [fixtureData], { state: { uploads: ['file1'] }, save: async () => {} }))
    assert.deepEqual(requests, ['GetFileUpload'])
  }
})

test('cleanup deletes at most one file per turn, retains failed deletes, and resumes after missing-file responses', async () => {
  let state: ProviderState = { uploads: ['first', 'second'] }
  let lost = true
  const deleted: string[] = []
  const provider = voplicaProvider((async (_url, options) => {
    deleted.push(JSON.parse(String(options?.body)).fileId)
    if (lost) { lost = false; throw new TypeError('Delete response lost') }
    return Response.json({ code: 'not_found' }, { status: 404 })
  }) as typeof fetch)
  const clean = () => provider.cleanup!(state, async updated => { state = updated })
  await assert.rejects(clean(), failure('transient'))
  assert.deepEqual(state.uploads, ['first', 'second'])
  await clean()
  assert.deepEqual(state.uploads, ['second'])
  await clean()
  assert.deepEqual(state.uploads, [])
  assert.deepEqual(deleted, ['first', 'first', 'second'])
})

test('poll decodes nested video file IDs and reports exact milli-credit usage and warning codes', async () => {
  const paths: string[] = []
  const provider = voplicaProvider((async (url, options) => {
    paths.push(pathOf(url))
    if (pathOf(url) === 'GetFileInfo') {
      assert.deepEqual(JSON.parse(String(options?.body)), { fileId: 'video-file' })
      return Response.json({ file: { id: 'video-file', uri: 'https://files.example/result.mp4?signature=synthetic', mimeType: 'VIDEO_MP4' } })
    }
    return Response.json({ workflowExecution: { status: 'COMPLETED', creditsReservedMilli: '9007199254740993',
      creditsChargedMilli: '120', creditsReversedMilli: '20', creditsNetChargedMilli: '100' },
    workflowOutput: { data: { mapLiteral: { map: { inference_output: { mapLiteral: { map: { video: {
      mapLiteral: { map: { id: { literal: { stringValue: 'video-file' } } } },
    } } } } } } } }, messages: [
      { severity: 'WARNING', code: 'INFERENCE_MODE_FALLBACK', message: 'Never stored verbatim' },
      { severity: 2, code: 'INFERENCE_MODE_FALLBACK' }, { severity: 'INFO', code: 'INFO' },
    ] })
  }) as typeof fetch)
  const result = await provider.poll('run')
  assert.equal(result.status, 'succeeded')
  if (result.status !== 'succeeded') return assert.fail('Expected output')
  assert.deepEqual(result.output, { mode: 'video', provider: 'voplica', fileId: 'video-file', url: 'https://files.example/result.mp4?signature=synthetic' })
  assert.deepEqual(result.usage, { reservedMilli: '9007199254740993', chargedMilli: '120', reversedMilli: '20', netChargedMilli: '100', warningCodes: ['INFERENCE_MODE_FALLBACK'] })
  assert.deepEqual(paths, ['GetWorkflowExecution', 'GetFileInfo'], 'Only authenticated RPCs; output download belongs to media ingestion')
})

test('poll distinguishes waiting/cancelling/failure and treats completed output absence as terminal', async () => {
  for (const [status, expected] of [['PENDING', 'queued'], [1, 'queued'], ['RUNNING', 'running'], ['CANCELLING', 'running'], ['FAILED', 'failed'], ['CANCELLED', 'failed']] as const) {
    const provider = voplicaProvider((async () => Response.json({ workflowExecution: { status },
      messages: [{ severity: 'ERROR', message: 'CONTENT_POLICY_INPUT_TOO_LONG: private prompt must not leak' }] })) as typeof fetch)
    const result = await provider.poll('run')
    assert.equal(result.status, expected)
    if (result.status === 'failed') assert.equal(result.code, 'provider_generation_failed', 'Provider prose cannot enter persisted error codes')
  }
  const missing = voplicaProvider((async () => Response.json({ workflowExecution: { status: 'COMPLETED' }, workflowOutput: {} })) as typeof fetch)
  assert.deepEqual(await missing.poll('run'), { status: 'failed', code: 'provider_empty_output', usage: { warningCodes: [] } })
})

test('provider-selected SIMPLE uploads larger than 8MiB remain one bounded operation', async () => {
  const bytes = Buffer.alloc(9 * 1024 * 1024, 1)
  let sends = 0
  const provider = voplicaProvider((async (url, options) => {
    if (pathOf(url) === 'GetFileUpload') return Response.json({ fileUploadInfo: {
      fileId: 'simple', fileSize: String(bytes.length), uploadedBytes: '0', chunkSize: String(bytes.length), uploadType: 'SIMPLE', status: 'UPLOADING',
    } })
    assert.equal(pathOf(url), 'upload')
    assert.equal((options?.body as Uint8Array).length, bytes.length)
    sends++
    return Response.json({ uploadedBytes: bytes.length, totalBytes: bytes.length })
  }) as typeof fetch)
  const result = await provider.prepare!(withRefs([reference]), [`data:image/png;base64,${bytes.toString('base64')}`], { state: { uploads: ['simple'] }, save: async () => {} })
  assert.equal(result.ready, false)
  assert.equal(sends, 1)
})

test('output file size, MIME, identity and HTTPS boundaries are verified before ingestion', async () => {
  const response = { workflowExecution: { status: 'COMPLETED' }, workflowOutput: { data: {
    mapLiteral: { map: { inference_output: { mapLiteral: { map: { video: { mapLiteral: { map: {
      id: { literal: { stringValue: 'video' } },
    } } } } } } } },
  } } }
  for (const patch of [{ sizeBytes: String(200 * 1024 * 1024 + 1) }, { sizeBytes: '0' }, { mimeType: 'IMAGE_PNG' },
    { id: 'other-file' }, { uri: 'http://files.example/video.mp4' }, { uri: 'https://name:password@files.example/video.mp4' }]) {
    const provider = voplicaProvider((async url => Response.json(pathOf(url) === 'GetWorkflowExecution' ? response
      : { file: { id: 'video', uri: 'https://files.example/video.mp4', mimeType: 'VIDEO_MP4', sizeBytes: '100', ...patch } })) as typeof fetch)
    await assert.rejects(provider.poll('run'), failure('transient', 'provider_invalid_output'))
  }
  const accepted = voplicaProvider((async () => Response.json({ workflowExecutionId: 'accepted-run' })) as typeof fetch)
  assert.equal(await accepted.video(manifest, [], 'take'), 'accepted-run')
})
