import { timingSafeEqual } from 'node:crypto'
import { createClerkClient } from '@clerk/backend'
import { createError, getHeader, getHeaders, getRequestURL, setHeader, type H3Event } from 'h3'
import { getDb } from './db'
import { assertAccountActive, isAdminUser } from '../services/account-policy'

const writes = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])
const loopbackHosts = new Set(['localhost', '127.0.0.1', '[::1]', '::1'])

export function allowedOrigins(): string[] {
  const origins = (process.env.VELA_ALLOWED_ORIGINS ?? '').split(',').map((value) => value.trim()).filter(Boolean)
  if (!origins.length || origins.some((origin) => {
    try {
      const url = new URL(origin)
      return !['http:', 'https:'].includes(url.protocol) || url.origin !== origin
    } catch { return true }
  })) throw createError({ statusCode: 503, statusMessage: 'Allowed origins are not configured' })
  return origins
}

export function assertWriteOrigin(event: H3Event, origins = allowedOrigins()) {
  if (!writes.has(event.method.toUpperCase())) return
  const origin = getHeader(event, 'origin')
  if ((origin && !origins.includes(origin)) || getHeader(event, 'sec-fetch-site') === 'cross-site') {
    throw createError({ statusCode: 403, statusMessage: 'Origin is not allowed' })
  }
  // Bearer clients may omit Origin; cookie-authenticated writes must provide it.
  if (!origin && !/^Bearer \S+$/.test(getHeader(event, 'authorization') ?? '')) {
    throw createError({ statusCode: 403, statusMessage: 'Origin is required' })
  }
}

function unauthorized(): never {
  throw createError({ statusCode: 401, statusMessage: 'Sign in is required' })
}

function localUser(event: H3Event): string {
  const address = event.node.req.socket.remoteAddress
  const localAddress = address === '::1' || address === '127.0.0.1' || address === '::ffff:127.0.0.1'
  const hostname = getRequestURL(event, { xForwardedHost: false, xForwardedProto: false }).hostname
  if (process.env.NODE_ENV === 'production' || !localAddress || !loopbackHosts.has(hostname)) unauthorized()
  const expected = process.env.VELA_LOCAL_AUTH_TOKEN
  const userId = process.env.VELA_LOCAL_USER_ID
  if (!expected || expected.length < 24 || !userId || !/^[a-zA-Z0-9_-]{1,128}$/.test(userId)) {
    throw createError({ statusCode: 503, statusMessage: 'Local authentication is not configured' })
  }
  const authorization = getHeader(event, 'authorization') ?? ''
  const supplied = authorization.startsWith('Bearer ') ? authorization.slice(7) : ''
  const actualBytes = Buffer.from(supplied)
  const expectedBytes = Buffer.from(expected)
  if (actualBytes.length !== expectedBytes.length || !timingSafeEqual(actualBytes, expectedBytes)) unauthorized()
  return userId
}

/** Only verified session identity is accepted; request payloads never select an owner. */
export async function requireUser(event: H3Event): Promise<{ id: string }> {
  setHeader(event, 'Cache-Control', 'private, no-store')
  const origins = allowedOrigins()
  assertWriteOrigin(event, origins)
  let id: string
  if (process.env.VELA_AUTH_MODE === 'local') {
    id = localUser(event)
  } else {
    if (process.env.VELA_AUTH_MODE && process.env.VELA_AUTH_MODE !== 'clerk') {
      throw createError({ statusCode: 503, statusMessage: 'Authentication mode is not configured' })
    }
    const secretKey = process.env.CLERK_SECRET_KEY
    const publishableKey = process.env.CLERK_PUBLISHABLE_KEY || process.env.NUXT_PUBLIC_CLERK_PUBLISHABLE_KEY
    const issuer = process.env.CLERK_ISSUER_URL
    if (!secretKey || !publishableKey || !issuer) {
      throw createError({ statusCode: 503, statusMessage: 'Authentication is not configured' })
    }
    const headers = new Headers()
    for (const [key, value] of Object.entries(getHeaders(event))) {
      if (value !== undefined) headers.set(key, Array.isArray(value) ? value.join(', ') : value)
    }
    const request = new Request(getRequestURL(event, { xForwardedHost: false, xForwardedProto: false }), { headers })
    try {
      const state = await createClerkClient({ secretKey, publishableKey, telemetry: { disabled: true } }).authenticateRequest(request, {
        authorizedParties: origins,
        issuer,
        jwtKey: process.env.CLERK_JWT_KEY,
        acceptsToken: 'session_token',
      })
      const auth = state.toAuth()
      if (!state.isAuthenticated || !auth?.userId || !auth.sessionClaims?.azp || !origins.includes(auth.sessionClaims.azp)) unauthorized()
      id = auth.userId
    } catch {
      unauthorized()
    }
  }
  await getDb()`INSERT INTO app_users (id) VALUES (${id}) ON CONFLICT (id) DO NOTHING`
  await assertAccountActive(getDb(), id)
  return { id }
}

export async function requireAdmin(event: H3Event): Promise<{ id: string }> {
  const user = await requireUser(event)
  if (!isAdminUser(user.id))
    throw createError({ statusCode: 403, statusMessage: 'Administrator access is required', data: { code: 'not_admin' } })
  return user
}
