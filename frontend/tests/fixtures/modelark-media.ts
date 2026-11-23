import { createServer, request as httpRequest } from 'node:http'
import https from 'node:https'
import dns from 'node:dns/promises'
import type { TestContext } from 'node:test'
import { MODELARK_OUTPUT_HOSTS } from '../../server/services/provider-download'

type FixtureFile = Buffer | { bytes: Buffer; mimeType?: string; status?: number; headers?: Record<string, string>; chunked?: boolean }

/** Only test transport is redirected to loopback; URL/DNS checks and byte validation still execute. */
export async function createModelArkMediaFixture(t: TestContext, files: Record<string, FixtureFile>) {
  const server = createServer((req, res) => {
    const file = files[new URL(req.url ?? '/', 'http://fixture.invalid').pathname]
    if (!file) { res.writeHead(404); res.end(); return }
    const result = Buffer.isBuffer(file) ? { bytes: file } : file
    res.writeHead(result.status ?? 200, { 'content-type': result.mimeType ?? 'application/octet-stream',
      ...(result.chunked ? {} : { 'content-length': String(result.bytes.length) }), ...result.headers })
    if (result.chunked) {
      res.write(result.bytes.subarray(0, Math.floor(result.bytes.length / 2)))
      res.end(result.bytes.subarray(Math.floor(result.bytes.length / 2)))
    } else res.end(result.bytes)
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as { port: number }).port
  const fixture = { dnsAddresses: [{ address: '93.184.216.34', family: 4 }], requests: [] as https.RequestOptions[],
    url: (path: string) => `https://${[...MODELARK_OUTPUT_HOSTS][0]}${path}` }
  t.mock.method(dns, 'lookup', async () => fixture.dnsAddresses)
  t.mock.method(https, 'request', (options: https.RequestOptions, callback: Parameters<typeof httpRequest>[1]) => {
    fixture.requests.push(options)
    return httpRequest({ hostname: '127.0.0.1', port, path: options.path, method: options.method, agent: false,
      headers: { ...options.headers, connection: 'close' } }, callback as never)
  })
  t.after(async () => {
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  })
  return fixture
}

/** Synthetic ISO-BMFF video container for storage/range tests, not a playable codec sample. */
export function createSyntheticMp4(width = 320, height = 240) {
  const box = (type: string, body: Buffer) => {
    const header = Buffer.alloc(8)
    header.writeUInt32BE(body.length + 8)
    header.write(type, 4, 'ascii')
    return Buffer.concat([header, body])
  }
  const tkhd = Buffer.alloc(84)
  tkhd.writeUInt32BE(width * 65536, 76)
  tkhd.writeUInt32BE(height * 65536, 80)
  const hdlr = Buffer.alloc(20)
  hdlr.write('vide', 8)
  return Buffer.concat([box('ftyp', Buffer.from('isom\0\0\0\0mp42')), box('moov', box('trak', Buffer.concat([
    box('tkhd', tkhd), box('mdia', box('hdlr', hdlr)),
  ]))), box('mdat', Buffer.from([0, 0, 0, 1, 0, 0]))])
}
