import assert from 'node:assert/strict'
import test from 'node:test'
import { imageRequest, videoRequest, modelArkProvider, ProviderFailure, type GenerationManifest } from '../../server/services/generation/modelark'
import { generationCapabilities } from '../../server/services/generation/config'

const manifest: GenerationManifest = { draft: { modelId: 'seedream-5-pro', mode: 'image', trial: false, prompt: 'A forest',
  aspect: '16:9', imageQuality: '2k', videoQuality: '720p', durationS: 6, count: 2, referenceId: null },
  prompt: 'A forest', providerModel: 'dola-seedream-5-0-pro-260628', references: [] }

test('ModelArk payload uses verified image sizes and separate reference/frame video modes', () => {
  const image = imageRequest(manifest, ['data:image/png;base64,fixture'])
  assert.equal(image.size, '2816x1584')
  assert.equal(image.output_format, 'png')
  assert.equal('n' in image, false, 'Each take is one paid image call; unsupported batch options must not be sent')
  const video = { ...manifest, providerModel: 'dreamina-seedance-2-5-260628', references: [
    { nodeId: 'frame', assetId: 'asset', role: 'first_frame' as const },
    { nodeId: 'end', assetId: 'asset2', role: 'last_frame' as const },
  ] }
  const frames = videoRequest(video, ['first', 'last'])
  assert.equal(frames.ratio, 'adaptive')
  assert.equal('omni_reference_task_type' in frames, false)
  const references = videoRequest({ ...video, references: [{ ...video.references[0]!, role: 'reference_image' }] }, ['ref'])
  assert.equal(references.ratio, '16:9')
  assert.equal(references.omni_reference_task_type, 'reference')
  assert.equal(references.return_last_frame, true)
})

test('paid POSTs never auto-retry and ambiguous responses remain unknown', async () => {
  const previous = { ...process.env }
  try {
    process.env.VELA_GENERATION_ENABLED = 'true'
    process.env.ARK_API_KEY = 'synthetic-key-never-sent'
    delete process.env.ARK_BASE_URL
    delete process.env.ARK_IMAGE_MODEL
    delete process.env.ARK_VIDEO_MODEL
    assert.equal(generationCapabilities().enabled, true)
    for (const outcome of ['transport', '500', 'malformed', 'missing-id']) {
      let calls = 0
      const provider = modelArkProvider((async (url, options) => {
        calls++
        assert.equal(url, 'https://ark.ap-southeast.bytepluses.com/api/v3/contents/generations/tasks')
        assert.equal(options?.redirect, 'error')
        if (outcome === 'transport') throw new Error('Synthetic connection loss')
        if (outcome === '500') return new Response('{"error":{"code":"InternalError"}}', { status: 500 })
        if (outcome === 'malformed') return new Response('not json', { status: 200 })
        return new Response('{}', { status: 200 })
      }) as typeof fetch)
      await assert.rejects(provider.video(manifest, []), error => error instanceof ProviderFailure && error.outcome === 'unknown')
      assert.equal(calls, 1)
    }
    const rejected = modelArkProvider((async () => new Response('{"error":{"code":"AccessDenied"}}', { status: 403 })) as typeof fetch)
    await assert.rejects(rejected.image(manifest, []), error => error instanceof ProviderFailure && error.outcome === 'rejected')
    process.env.ARK_BASE_URL = 'https://untrusted.example/api/v3'
    assert.equal(generationCapabilities().enabled, false)
    let called = false
    await assert.rejects(modelArkProvider((async () => { called = true; throw new Error('Not reached') }) as typeof fetch).image(manifest, []))
    assert.equal(called, false)
  } finally {
    for (const key of Object.keys(process.env)) if (!(key in previous)) delete process.env[key]
    Object.assign(process.env, previous)
  }
})
