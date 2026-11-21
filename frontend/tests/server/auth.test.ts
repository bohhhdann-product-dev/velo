import assert from 'node:assert/strict'
import { createServer, request } from 'node:http'
import { once } from 'node:events'
import { after, before, test } from 'node:test'
import { createApp, defineEventHandler, toNodeListener } from 'h3'
import { requireUser } from '../../server/utils/auth'
import { readJsonBody } from '../../server/utils/request'

const saved = { ...process.env }
const app = createApp({ debug: false })
app.use('/auth', defineEventHandler((event) => requireUser(event)))
app.use('/body', defineEventHandler((event) => readJsonBody(event, 64)))
const server = createServer(toNodeListener(app))
let base = ''

before(async () => {
  process.env.VELA_ALLOWED_ORIGINS = 'http://localhost:3000'
  process.env.VELA_AUTH_MODE = 'local'
  process.env.VELA_LOCAL_USER_ID = 'local_test'
  process.env.VELA_LOCAL_AUTH_TOKEN = 'test-only-token-long-enough-to-validate'
  process.env.NODE_ENV = 'test'
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`
})
after(async () => {
  for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key]
  Object.assign(process.env, saved)
  server.close()
  await once(server, 'close')
})

test('missing and invalid local credentials deny access before database access', async () => {
  assert.equal((await fetch(`${base}/auth`)).status, 401)
  assert.equal((await fetch(`${base}/auth`, { headers: { authorization: 'Bearer invalid' } })).status, 401)
})

test('local mode cannot run in production or trust a forwarded loopback host', async () => {
  const headers = { authorization: `Bearer ${process.env.VELA_LOCAL_AUTH_TOKEN}` }
  process.env.NODE_ENV = 'production'
  assert.equal((await fetch(`${base}/auth`, { headers })).status, 401)
  process.env.NODE_ENV = 'test'
  const status = await new Promise<number>((resolve, reject) => {
    const req = request(`${base}/auth`, { headers: { ...headers, host: 'example.test', 'x-forwarded-host': 'localhost' } }, (response) => {
      response.resume()
      resolve(response.statusCode!)
    })
    req.on('error', reject)
    req.end()
  })
  assert.equal(status, 401)
})

test('disallowed write origins and missing cookie origin are denied', async () => {
  assert.equal((await fetch(`${base}/auth`, { method: 'POST', headers: { origin: 'https://evil.example' } })).status, 403)
  assert.equal((await fetch(`${base}/auth`, { method: 'POST', headers: { cookie: '__session=fake' } })).status, 403)
})

test('missing Clerk configuration has no local authentication fallback', async () => {
  delete process.env.VELA_AUTH_MODE
  const previous = process.env.CLERK_SECRET_KEY
  delete process.env.CLERK_SECRET_KEY
  try { assert.equal((await fetch(`${base}/auth`)).status, 503) } finally {
    if (previous) process.env.CLERK_SECRET_KEY = previous
    process.env.VELA_AUTH_MODE = 'local'
  }
})

test('JSON reader rejects invalid media type, malformed JSON and declared oversized bodies', async () => {
  assert.equal((await fetch(`${base}/body`, { method: 'POST', body: '{}' })).status, 415)
  assert.equal((await fetch(`${base}/body`, { method: 'POST', body: '{', headers: { 'content-type': 'application/json' } })).status, 400)
  assert.equal((await fetch(`${base}/body`, { method: 'POST', body: JSON.stringify({ value: 'x'.repeat(65) }), headers: { 'content-type': 'application/json' } })).status, 413)
  const response = await fetch(`${base}/body`, { method: 'POST', body: '{"ok":true}', headers: { 'content-type': 'application/json' } })
  assert.deepEqual(await response.json(), { ok: true })
})

test('JSON reader enforces the same cap without Content-Length', async () => {
  const status = await new Promise<number>((resolve, reject) => {
    const req = request(`${base}/body`, { method: 'POST', headers: { 'content-type': 'application/json', 'transfer-encoding': 'chunked' } }, (response) => {
      response.resume()
      resolve(response.statusCode!)
    })
    req.on('error', reject)
    req.write('{"value":"')
    req.write('x'.repeat(65))
    req.end('"}')
  })
  assert.equal(status, 413)
})
