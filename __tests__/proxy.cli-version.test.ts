/**
 * @jest-environment node
 */
import { NextRequest } from 'next/server'

// LUM-1110 — proxy.ts answers a CLI below the minimum version with a 426
// before authentication runs, and the version header never changes what
// authentication does. Clerk is stubbed so only the proxy's own decision runs.

const protect = jest.fn(async () => undefined)
jest.mock('@clerk/nextjs/server', () => {
  const actual = jest.requireActual<typeof import('@clerk/nextjs/server')>(
    '@clerk/nextjs/server'
  )
  type Handler = (
    auth: (() => Promise<{ userId: string | null }>) & {
      protect: typeof protect
    },
    req: NextRequest
  ) => Promise<Response>
  return {
    createRouteMatcher: actual.createRouteMatcher,
    clerkMiddleware: (handler: Handler) => (req: NextRequest) =>
      handler(
        Object.assign(async () => ({ userId: null }), { protect }),
        req
      ),
  }
})

import proxy from '@/proxy'

type ProxyFn = (req: NextRequest) => Promise<Response>
const run = (req: NextRequest) => (proxy as unknown as ProxyFn)(req)

const request = (path: string, version?: string) =>
  new NextRequest(`http://localhost:3000${path}`, {
    headers: {
      authorization: 'Bearer lum_fixture',
      ...(version === undefined ? {} : { 'x-lumo-cli-version': version }),
    },
  })

let savedMin: string | undefined
beforeEach(() => {
  savedMin = process.env.LUMO_MIN_CLI_VERSION
  process.env.LUMO_MIN_CLI_VERSION = '1.120.0'
  protect.mockClear()
})
afterEach(() => {
  if (savedMin === undefined) delete process.env.LUMO_MIN_CLI_VERSION
  else process.env.LUMO_MIN_CLI_VERSION = savedMin
})

describe('CLI version gate in the proxy', () => {
  it('answers a CLI below the minimum with 426 and the upgrade body', async () => {
    const res = await run(request('/api/tasks/me', '1.119.9'))
    expect(res.status).toBe(426)
    const body = (await res.json()) as { code: string; minVersion: string }
    expect(body.code).toBe('CLI_VERSION_UNSUPPORTED')
    expect(body.minVersion).toBe('1.120.0')
  })

  it('lets a current CLI and a header-less request through unchanged', async () => {
    for (const version of ['1.120.0', undefined]) {
      const res = await run(request('/api/tasks/me', version))
      expect(res.status).toBe(200)
      expect(res.headers.get('x-middleware-next')).toBe('1')
    }
  })

  it('does not let the header change authentication on protected pages', async () => {
    await run(request('/workspace', '1.119.0'))
    await run(request('/workspace', '9.9.9'))
    await run(request('/workspace'))
    expect(protect).toHaveBeenCalledTimes(3)
  })

  it('lets everything through when no minimum is configured', async () => {
    delete process.env.LUMO_MIN_CLI_VERSION
    const res = await run(request('/api/tasks/me', '0.0.1'))
    expect(res.status).toBe(200)
  })
})
