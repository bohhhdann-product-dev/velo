import assert from 'node:assert/strict'
import { createServer, request, type ClientRequest } from 'node:http'
import { once, EventEmitter } from 'node:events'
import test from 'node:test'
import { createApp, defineEventHandler, toNodeListener } from 'h3'
import { receiveImageUpload } from '../../server/services/media'

test('upload admission precedes buffering and releases slots after aborts and parse errors', async () => {
  let entered = 0
  let finished = 0
  const changes = new EventEmitter()
  const app = createApp({ debug: false })
  app.use(defineEventHandler(async (event) => {
    entered++
    changes.emit('change')
    try { return await receiveImageUpload('isolated-admission-fixture', event) }
    finally { finished++; changes.emit('change') }
  }))
  const server = createServer(toNodeListener(app))
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  const requests: ClientRequest[] = []
  async function until(check: () => boolean) {
    while (!check()) await once(changes, 'change', { signal: AbortSignal.timeout(2000) })
  }
  function open() {
    const req = request(base, { method: 'POST', headers: {
      'content-type': 'multipart/form-data; boundary=fixture',
      'transfer-encoding': 'chunked', connection: 'close',
    } })
    req.on('error', () => {}) // Aborting is part of the fixture.
    req.flushHeaders()
    requests.push(req)
    return req
  }
  try {
    const first = open(), second = open()
    await until(() => entered === 2)
    const third = open()
    const [response] = await once(third, 'response', { signal: AbortSignal.timeout(2000) })
    assert.equal(response.statusCode, 429, 'Admission must reject before this client sends or ends its body')
    response.resume()
    third.destroy()
    first.destroy()
    second.destroy()
    await until(() => finished === 3)
    for (let i = 0; i < 3; i++) {
      const malformed = await fetch(base, { method: 'POST', headers: {
        'content-type': 'multipart/form-data; boundary=fixture', connection: 'close',
      }, body: 'not multipart' })
      assert.equal(malformed.status, 400, 'An aborted/invalid upload must release its slot')
      await malformed.arrayBuffer()
    }
  } finally {
    for (const req of requests) req.destroy()
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})
