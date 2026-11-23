import assert from 'node:assert/strict'
import test from 'node:test'
import sharp from 'sharp'
import { downloadProviderOutput, providerOutputUrl, isPublicAddress } from '../../server/services/provider-download'
import { prepareGeneratedMedia, inspectGeneratedMp4 } from '../../server/services/generated-media'
import { parseMediaRange } from '../../server/services/media-range'
import { createModelArkMediaFixture, createSyntheticMp4 } from '../fixtures/modelark-media'
import type { ProviderId } from '../../server/services/generation/provider'

test('provider downloads pin a public address, send no credentials, reject redirects and enforce streamed limits', async (t) => {
  const fixture = await createModelArkMediaFixture(t, {
    '/ok': Buffer.from('exact source'),
    '/redirect': { bytes: Buffer.alloc(0), status: 302, headers: { location: 'http://127.0.0.1/private' } },
    '/large': Buffer.alloc(64),
    '/chunked': { bytes: Buffer.alloc(64), chunked: true },
    '/encoded': { bytes: Buffer.from('encoded'), headers: { 'content-encoding': 'gzip' } },
    '/empty': Buffer.alloc(0),
  })
  assert.equal((await downloadProviderOutput(fixture.url('/ok?signature=private'), 100)).toString(), 'exact source')
  const request = fixture.requests[0]!
  assert.equal(request.hostname, '93.184.216.34', 'The actual connection uses the validated IP, not a second DNS lookup')
  assert.equal(request.servername, new URL(fixture.url('/ok')).hostname)
  assert.equal(request.agent, false)
  assert.equal((request.headers as Record<string, string>).authorization, undefined)
  assert.equal((request.headers as Record<string, string>).cookie, undefined)
  for (const path of ['/redirect', '/encoded', '/empty']) await assert.rejects(downloadProviderOutput(fixture.url(path), 100), { statusCode: 502 })
  for (const path of ['/large', '/chunked']) await assert.rejects(downloadProviderOutput(fixture.url(path), 32), { data: { code: 'provider_output_too_large' } })
  const before = fixture.requests.length
  for (const invalid of ['http://example.com/file', 'https://127.0.0.1/file', 'file:///etc/passwd',
    fixture.url('/ok').replace('.volces.com', '.volces.com.evil.example'),
    fixture.url('/ok').replace('https://', 'https://user:password@'), fixture.url('/ok').replace('/ok', ':444/ok')])
    await assert.rejects(downloadProviderOutput(invalid, 100), { data: { code: 'invalid_provider_output' } })
  fixture.dnsAddresses = [{ address: '127.0.0.1', family: 4 }]
  await assert.rejects(downloadProviderOutput(fixture.url('/ok'), 100), { data: { code: 'invalid_provider_output' } })
  fixture.dnsAddresses = [{ address: '93.184.216.34', family: 4 }, { address: '10.1.2.3', family: 4 }]
  await assert.rejects(downloadProviderOutput(fixture.url('/ok'), 100), { data: { code: 'invalid_provider_output' } })
  assert.equal(fixture.requests.length, before, 'Unsafe destinations must never reach the transport')
})

test('Voplica signed URLs require explicit context and retain public DNS, credential and redirect protections', async (t) => {
  const fixture = await createModelArkMediaFixture(t, {
    '/signed': Buffer.from('original output'),
    '/redirect': { bytes: Buffer.alloc(0), status: 302, headers: { location: 'https://127.0.0.1/private' } },
    '/large': { bytes: Buffer.alloc(64), chunked: true },
  })
  const url = 'https://signed-output.example/signed?signature=private%2Ftoken&expires=123'
  await assert.rejects(downloadProviderOutput(url, 100), { data: { code: 'invalid_provider_output' } })
  await assert.rejects(downloadProviderOutput(url, 100, 'modelark'), { data: { code: 'invalid_provider_output' } })
  await assert.rejects(downloadProviderOutput(url, 100, 'unknown' as ProviderId), { data: { code: 'invalid_provider_output' } })
  assert.equal(fixture.requests.length, 0)
  assert.equal((await downloadProviderOutput(url, 100, 'voplica')).toString(), 'original output')
  const request = fixture.requests[0]!
  assert.equal(request.hostname, '93.184.216.34')
  assert.equal(request.servername, 'signed-output.example')
  assert.equal(request.port, 443)
  assert.equal(request.path, '/signed?signature=private%2Ftoken&expires=123')
  assert.equal(request.agent, false)
  assert.deepEqual(Object.keys(request.headers!).map(key => key.toLowerCase()).sort(), ['accept', 'accept-encoding', 'host'],
    'API authorization and application cookies cannot reach signed download origins')
  const beforeRedirect = fixture.requests.length
  await assert.rejects(downloadProviderOutput('https://signed-output.example/redirect', 100, 'voplica'), { statusCode: 502 })
  assert.equal(fixture.requests.length, beforeRedirect + 1, 'A redirect must never be followed')
  await assert.rejects(downloadProviderOutput('https://signed-output.example/large', 32, 'voplica'), { data: { code: 'provider_output_too_large' } })
  const before = fixture.requests.length
  for (const invalid of ['http://signed-output.example/signed', 'https://signed-output.example:444/signed',
    'https://user:secret@signed-output.example/signed', `${url}#fragment`, `${url}#`,
    'https://127.0.0.1/signed', 'https://2130706433/signed', 'https://169.254.169.254/signed',
    'https://[::1]/signed', 'https://[::ffff:127.0.0.1]/signed', 'file:///etc/passwd'])
    await assert.rejects(downloadProviderOutput(invalid, 100, 'voplica'), { data: { code: 'invalid_provider_output' } })
  for (const addresses of [[], [{ address: '10.0.0.1', family: 4 }], [{ address: 'fc00::1', family: 6 }],
    [{ address: '::ffff:127.0.0.1', family: 6 }], [{ address: 'fe80::1', family: 6 }],
    [{ address: '2606:4700:4700::1111', family: 6 }, { address: 'fd00::1', family: 6 }]]) {
    fixture.dnsAddresses = addresses
    await assert.rejects(downloadProviderOutput(url, 100, 'voplica'), { data: { code: 'invalid_provider_output' } })
  }
  assert.equal(fixture.requests.length, before, 'Unsafe URL or DNS results must never reach the transport')
  fixture.dnsAddresses = [{ address: '2606:4700:4700::1111', family: 6 }]
  assert.equal((await downloadProviderOutput(url, 100, 'voplica')).toString(), 'original output')
  assert.equal(fixture.requests.at(-1)!.hostname, '2606:4700:4700::1111', 'IPv6 destinations are pinned too')
})

test('output origin/IP and single-range validation rejects boundary tricks', () => {
  for (const address of ['127.0.0.1', '0.0.0.0', '10.0.0.2', '169.254.169.254', '172.31.0.1', '192.168.0.1',
    '100.64.0.1', '198.18.0.1', '224.0.0.1', '192.0.2.1', '::1', '::ffff:127.0.0.1', 'fc00::1', 'fe80::1',
    '2001:db8::1', '2001:20::1', '2002:7f00:1::', '3fff::1']) assert.equal(isPublicAddress(address), false, address)
  for (const address of ['8.8.8.8', '93.184.216.34', '2606:4700:4700::1111', '2001:4860:4860::8888'])
    assert.equal(isPublicAddress(address), true, address)
  assert.throws(() => providerOutputUrl('https://example.com/'))
  assert.deepEqual(parseMediaRange('bytes=2-4', 10), { start: 2, end: 4 })
  assert.deepEqual(parseMediaRange('bytes=-3', 10), { start: 7, end: 9 })
  assert.deepEqual(parseMediaRange('bytes=8-', 10), { start: 8, end: 9 })
  assert.deepEqual(parseMediaRange('bytes=0-100', 10), { start: 0, end: 9 })
  assert.equal(parseMediaRange(undefined, 10), null)
  for (const range of ['bytes=10-', 'bytes=-0', 'bytes=5-2', 'bytes=0-1,4-5', 'bytes=a-b', 'bytes=9007199254740992-'])
    assert.throws(() => parseMediaRange(range, 10))
})

test('generated image originals and video/last-frame bytes survive unchanged; unsupported media fails', async (t) => {
  const jpeg = await sharp({ create: { width: 40, height: 20, channels: 3, background: 'red' } }).jpeg().withMetadata({ orientation: 6 }).toBuffer()
  const png = await sharp({ create: { width: 40, height: 20, channels: 3, background: 'blue' } }).png().toBuffer()
  const webp = await sharp(png).webp().withMetadata().toBuffer()
  const mp4 = createSyntheticMp4()
  const fixture = await createModelArkMediaFixture(t, { '/original.jpg': jpeg, '/original.png': png, '/original.webp': webp,
    '/video.mp4': mp4, '/malformed': Buffer.from('not media'), '/truncated.mp4': mp4.subarray(0, -1) })
  for (const [path, bytes, mime] of [['/original.jpg', jpeg, 'image/jpeg'], ['/original.png', png, 'image/png'], ['/original.webp', webp, 'image/webp']] as const) {
    const image = await prepareGeneratedMedia({ mode: 'image', url: fixture.url(path) })
    assert.deepEqual(image.source, bytes)
    assert.equal(image.mimeType, mime)
    assert.equal((await sharp(image.preview!.bytes).metadata()).format, 'webp')
    assert.equal((await sharp(image.preview!.bytes).metadata()).exif, undefined)
  }
  const video = await prepareGeneratedMedia({ mode: 'video', url: fixture.url('/video.mp4'), posterUrl: fixture.url('/original.jpg') })
  assert.deepEqual(video.source, mp4)
  assert.deepEqual(video.preview!.bytes, jpeg)
  assert.equal(video.preview!.mimeType, 'image/jpeg')
  assert.deepEqual({ width: video.width, height: video.height }, { width: 320, height: 240 })
  assert.equal((await prepareGeneratedMedia({ mode: 'video', url: fixture.url('/video.mp4') })).preview, null)
  await assert.rejects(prepareGeneratedMedia({ mode: 'image', url: fixture.url('/malformed') }), { statusCode: 502 })
  await assert.rejects(prepareGeneratedMedia({ mode: 'video', url: fixture.url('/truncated.mp4') }), { statusCode: 502 })
  assert.throws(() => inspectGeneratedMp4(Buffer.from('not an MP4')))
})

test('generated media requires the saved provider to match output before source or poster downloads', async (t) => {
  const png = await sharp({ create: { width: 40, height: 20, channels: 3, background: 'blue' } }).png().toBuffer()
  const mp4 = createSyntheticMp4()
  const fixture = await createModelArkMediaFixture(t, { '/image.png': png, '/video.mp4': mp4 })
  const imageUrl = 'https://signed-output.example/image.png'
  for (const [outputProvider, expectedProvider] of [['voplica', undefined], ['voplica', 'modelark'],
    ['modelark', 'voplica'], [undefined, 'voplica'], ['unknown', 'unknown']] as const) {
    await assert.rejects(prepareGeneratedMedia({ mode: 'image', url: imageUrl, provider: outputProvider as ProviderId | undefined },
      expectedProvider as ProviderId | undefined), { data: { code: 'invalid_provider_output' } })
  }
  assert.equal(fixture.requests.length, 0, 'A provider mismatch must fail before opening a media connection')
  const image = await prepareGeneratedMedia({ mode: 'image', url: imageUrl, provider: 'voplica' }, 'voplica')
  assert.deepEqual(image.source, png)
  const video = await prepareGeneratedMedia({ mode: 'video', url: 'https://signed-output.example/video.mp4',
    posterUrl: imageUrl, provider: 'voplica' }, 'voplica')
  assert.deepEqual(video.source, mp4)
  assert.deepEqual(video.preview!.bytes, png)
  assert.equal(fixture.requests.length, 3, 'The same provider policy is used for source and poster')
})
