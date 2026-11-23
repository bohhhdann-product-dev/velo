import dns from 'node:dns/promises'
import https from 'node:https'
import { isIP } from 'node:net'
import { fail } from './media'
import type { ProviderId } from './generation/provider'

// BytePlus documents these exact output origins; custom/CDN hosts require a reviewed change.
// https://docs.byteplus.com/en/docs/iga/accelerate_downloads_of_ai_generated_content_en-us
export const MODELARK_OUTPUT_HOSTS = new Set([
  'ark-content-generation-v2-ap-southeast-1.tos-ap-southeast-1.volces.com',
  'ark-content-generation-ap-southeast-1.tos-ap-southeast-1.volces.com',
  'ark-acg-ap-southeast-1.tos-ap-southeast-1.volces.com',
])

export function providerOutputUrl(value: string, provider: ProviderId = 'modelark'): URL {
  if (typeof value !== 'string' || value.length > 16 * 1024 || !['modelark', 'voplica'].includes(provider))
    fail(502, 'invalid_provider_output', 'The provider returned an invalid media URL')
  let url: URL
  try { url = new URL(value) } catch { fail(502, 'invalid_provider_output', 'The provider returned an invalid media URL') }
  if (url!.protocol !== 'https:' || (url!.port && url!.port !== '443') || url!.username || url!.password
    || url!.href.includes('#') || (provider === 'modelark' && !MODELARK_OUTPUT_HOSTS.has(url!.hostname)))
    fail(502, 'invalid_provider_output', 'The provider returned an unsupported media origin')
  const address = url!.hostname.replace(/^\[|\]$/g, '')
  if (isIP(address) && !isPublicAddress(address))
    fail(502, 'invalid_provider_output', 'The media origin did not resolve to a public address')
  return url!
}

export function isPublicAddress(address: string): boolean {
  if (isIP(address) === 4) {
    const [a, b, c] = address.split('.').map(Number) as [number, number, number, number]
    return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127)
      || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && (b === 168 || (b === 0 && (c === 0 || c === 2)) || (b === 88 && c === 99)))
      || (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100)))
      || (a === 203 && b === 0 && c === 113))
  }
  if (isIP(address) === 6) {
    const normalized = new URL(`http://[${address}]/`).hostname.slice(1, -1).toLowerCase()
    const [first, second = '0'] = normalized.split(':')
    return /^[23][0-9a-f]{3}:/.test(normalized) && !normalized.startsWith('2001:db8:')
      && !(first === '2001' && parseInt(second || '0', 16) < 0x200)
      && !['2002', '3ffe'].includes(first!) && !(first === '3fff' && parseInt(second || '0', 16) < 0x1000)
  }
  return false
}

/** Provider must come from the saved job manifest, never from a browser-supplied URL. */
export async function downloadProviderOutput(value: string, maxBytes: number, provider: ProviderId = 'modelark'): Promise<Buffer> {
  const url = providerOutputUrl(value, provider)
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 200 * 1024 * 1024)
    throw new Error('Invalid provider download limit')
  return new Promise<Buffer>((resolve, reject) => {
    let request: ReturnType<typeof https.request> | undefined
    let settled = false
    const finish = (error?: unknown, bytes?: Buffer) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (error) {
        request?.destroy()
        if (error && typeof error === 'object' && 'statusCode' in error) reject(error)
        else { try { fail(502, 'provider_download_failed', 'The generated media could not be downloaded') } catch (safeError) { reject(safeError) } }
      } else resolve(bytes!)
    }
    const timer = setTimeout(() => finish(new Error('Download deadline exceeded')), 120_000)
    ;(async () => {
      // Voplica returns signed file URIs without a documented fixed origin; every resolved address must be public.
      const addresses = await dns.lookup(url.hostname.replace(/^\[|\]$/g, ''), { all: true, verbatim: true })
      if (settled) return
      if (!addresses.length || addresses.some(({ address }) => !isPublicAddress(address)))
        fail(502, 'invalid_provider_output', 'The media origin did not resolve to a public address')
      const address = addresses.find((item) => item.family === 4) ?? addresses[0]!
      // Connect to the checked address itself; SNI and certificate verification retain the original host.
      request = https.request({ hostname: address.address, servername: url.hostname, port: 443,
        method: 'GET', path: url.pathname + url.search, agent: false, maxHeaderSize: 16 * 1024,
        headers: { Host: url.hostname, Accept: 'image/png,image/jpeg,image/webp,video/mp4,application/octet-stream', 'Accept-Encoding': 'identity' },
      }, (response) => {
        ;(async () => {
          if (response.statusCode !== 200) {
            response.destroy()
            fail(502, 'provider_download_failed', 'The media origin did not return a file')
          }
          if (response.headers['content-encoding'] && response.headers['content-encoding'] !== 'identity')
            fail(502, 'invalid_provider_output', 'Compressed media responses are unsupported')
          const length = response.headers['content-length']
          if (length && (!/^\d+$/.test(length) || Number(length) > maxBytes))
            fail(502, 'provider_output_too_large', 'The generated media exceeds the storage limit')
          const chunks: Buffer[] = []
          let size = 0
          for await (const chunk of response) {
            const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
            size += bytes.length
            if (size > maxBytes) fail(502, 'provider_output_too_large', 'The generated media exceeds the storage limit')
            chunks.push(bytes)
          }
          if (!size) fail(502, 'invalid_provider_output', 'The provider returned an empty media file')
          finish(undefined, Buffer.concat(chunks, size))
        })().catch((error) => { response.destroy(); finish(error) })
      })
      request.setTimeout(30_000, () => finish(new Error('Media connection timed out')))
      request.once('error', finish)
      request.end()
    })().catch(finish)
  })
}
