import { createError, getHeader, type H3Event } from 'h3'

export const MAX_PROJECT_BODY_BYTES = 1024 * 1024

/** Bound memory for both Content-Length and chunked JSON requests. */
export async function readJsonBody(event: H3Event, maxBytes = MAX_PROJECT_BODY_BYTES): Promise<unknown> {
  if (getHeader(event, 'content-type')?.split(';')[0]?.trim().toLowerCase() !== 'application/json') {
    throw createError({ statusCode: 415, statusMessage: 'Use application/json' })
  }
  const length = getHeader(event, 'content-length')
  if (length && (!/^\d+$/.test(length) || Number(length) > maxBytes)) {
    throw createError({ statusCode: 413, statusMessage: 'Request body is too large' })
  }
  const raw = await new Promise<Buffer>((resolve, reject) => {
    const request = event.node.req
    let bytes = 0
    const chunks: Buffer[] = []
    function cleanup() {
      request.removeListener('data', onData)
      request.removeListener('end', onEnd)
      request.removeListener('error', onError)
      request.removeListener('aborted', onAborted)
    }
    function onError() {
      cleanup()
      reject(createError({ statusCode: 400, statusMessage: 'Could not read request body' }))
    }
    function onAborted() { onError() }
    function onData(value: Buffer | string) {
      const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value)
      bytes += chunk.length
      if (bytes > maxBytes) {
        cleanup()
        request.resume()
        reject(createError({ statusCode: 413, statusMessage: 'Request body is too large' }))
      } else chunks.push(chunk)
    }
    function onEnd() { cleanup(); resolve(Buffer.concat(chunks)) }
    request.on('data', onData)
    request.once('end', onEnd)
    request.once('error', onError)
    request.once('aborted', onAborted)
  })
  try { return JSON.parse(raw.toString('utf8')) } catch {
    throw createError({ statusCode: 400, statusMessage: 'Invalid JSON body' })
  }
}
