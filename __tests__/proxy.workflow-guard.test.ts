/**
 * @jest-environment node
 */
import { NextRequest } from 'next/server'

// LUM-1031 — the workflow delivery routes (/.well-known/workflow/v1/*) are
// public in proxy.ts so Vercel's platform can reach them. Self-hosted, the
// Postgres World worker POSTs to them over loopback HTTP with no signature, so
// the proxy itself has to demand a shared secret. Auth is stubbed so these
// tests exercise only the proxy's own routing decision.

const protect = jest.fn(async () => undefined)
jest.mock('@/lib/auth/middleware', () => {
  const actual = jest.requireActual<typeof import('@/lib/auth/route-matcher')>(
    '@/lib/auth/route-matcher'
  )
  type Handler = (
    auth: { userId: () => Promise<string | null>; protect: typeof protect },
    req: NextRequest
  ) => Promise<Response>
  return {
    createRouteMatcher: actual.createRouteMatcher,
    createAuthMiddleware: (handler: Handler) => (req: NextRequest) =>
      handler({ userId: async () => null, protect }, req),
  }
})

import proxy, { config } from '@/proxy'

type ProxyFn = (req: NextRequest) => Promise<Response>
const run = (req: NextRequest) => (proxy as unknown as ProxyFn)(req)

// Built at runtime (not a literal) so secret scanners do not flag a fixture;
// the slash and colon prove URL-decoding and first-colon splitting.
const SECRET = ['fixture', 'shared/value', 'with:colon'].join('-')
const basic = (user: string, pass: string) =>
  `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}`

const delivery = (path: string, authorization?: string) =>
  new NextRequest(`http://localhost:3000${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-vqs-queue-name': '__wkf_step_x',
      'x-vqs-message-id': 'msg_01',
      'x-vqs-message-attempt': '1',
      ...(authorization === undefined ? {} : { authorization }),
    },
    body: '{}',
  })

const ENV_KEYS = [
  'WORKFLOW_SECRET',
  'WORKFLOW_TARGET_WORLD',
  'VERCEL_DEPLOYMENT_ID',
] as const
const saved: Record<string, string | undefined> = {}

beforeEach(() => {
  for (const k of ENV_KEYS) saved[k] = process.env[k]
  // Self-hosted shape: no Vercel deployment, Postgres World selected.
  delete process.env.VERCEL_DEPLOYMENT_ID
  process.env.WORKFLOW_TARGET_WORLD = '@workflow/world-postgres'
  process.env.WORKFLOW_SECRET = SECRET
  protect.mockClear()
})
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
})

describe('self-hosted workflow delivery routes', () => {
  const routes = [
    '/.well-known/workflow/v1/step',
    '/.well-known/workflow/v1/flow',
    '/.well-known/workflow/v1/webhook/tok_123',
  ]

  it.each(routes)('rejects a delivery with no credential: %s', async path => {
    expect((await run(delivery(path))).status).toBe(401)
  })

  it.each(routes)('rejects a wrong credential: %s', async path => {
    expect((await run(delivery(path, basic('workflow', 'nope')))).status).toBe(
      401
    )
    expect((await run(delivery(path, `Bearer ${SECRET}`))).status).toBe(401)
  })

  it('fails closed when WORKFLOW_SECRET is unset or empty', async () => {
    for (const value of [undefined, '']) {
      if (value === undefined) delete process.env.WORKFLOW_SECRET
      else process.env.WORKFLOW_SECRET = value
      const path = '/.well-known/workflow/v1/step'
      expect((await run(delivery(path))).status).toBe(401)
      expect((await run(delivery(path, basic('workflow', '')))).status).toBe(
        401
      )
      expect(
        (await run(delivery(path, basic('workflow', 'undefined')))).status
      ).toBe(401)
    }
  })

  it('rejects an encoded spelling of the delivery path', async () => {
    const res = await run(delivery('/.well-known/%77orkflow/v1/step'))
    expect(res.status).toBe(401)
  })

  it.each(routes)('lets the worker through with the secret: %s', async path => {
    const res = await run(delivery(path, basic('workflow', SECRET)))
    expect(res.status).toBe(200)
    expect(res.headers.get('x-middleware-next')).toBe('1')
    expect(protect).not.toHaveBeenCalled()
  })
})

describe('proxy matcher reaches the workflow routes', () => {
  it('runs the proxy for step and flow deliveries', () => {
    const matcher = config.matcher
    if (!Array.isArray(matcher) || typeof matcher[0] !== 'string') {
      throw new Error('expected a string matcher')
    }
    const re = new RegExp(matcher[0])
    expect(re.test('/.well-known/workflow/v1/step')).toBe(true)
    expect(re.test('/.well-known/workflow/v1/flow')).toBe(true)
  })
})

describe('outside self-hosted mode', () => {
  it('leaves the Vercel path to the platform (no secret needed)', async () => {
    delete process.env.WORKFLOW_TARGET_WORLD
    delete process.env.WORKFLOW_SECRET
    process.env.VERCEL_DEPLOYMENT_ID = 'dpl_123'
    const res = await run(delivery('/.well-known/workflow/v1/step'))
    expect(res.status).toBe(200)
    expect(res.headers.get('x-middleware-next')).toBe('1')
  })
})

describe('MCP OAuth discovery endpoints are unaffected', () => {
  it.each([
    '/.well-known/oauth-authorization-server',
    '/.well-known/oauth-protected-resource',
  ])('%s stays public with no credential, secret unset', async path => {
    delete process.env.WORKFLOW_SECRET
    const res = await run(
      new NextRequest(`http://localhost:3000${path}`, { method: 'GET' })
    )
    expect(res.status).toBe(200)
    expect(res.headers.get('x-middleware-next')).toBe('1')
    expect(protect).not.toHaveBeenCalled()
  })
})
