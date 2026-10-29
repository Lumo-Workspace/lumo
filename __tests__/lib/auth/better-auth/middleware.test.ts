/**
 * @jest-environment node
 */
import { NextRequest, NextResponse } from 'next/server'
import {
  createBetterAuthMiddleware,
  isPageRequest,
  localModeEntryRedirect,
  localSignInRedirectUrl,
  signInRedirectUrl,
} from '@/lib/auth/better-auth/middleware'

const req = (path: string, init: { method?: string; accept?: string } = {}) =>
  new NextRequest(`http://localhost:3000${path}`, {
    method: init.method ?? 'GET',
    headers: init.accept ? { accept: init.accept } : {},
  })

describe('Better Auth middleware (LUM-1027)', () => {
  it('isPageRequest: GET/HEAD accepting HTML only', () => {
    expect(isPageRequest(req('/x', { accept: 'text/html' }))).toBe(true)
    expect(
      isPageRequest(req('/x', { method: 'POST', accept: 'text/html' }))
    ).toBe(false)
    expect(signInRedirectUrl(req('/')).search).toBe('')
  })

  it('protect() answers a non-page request with 401 instead of a redirect', async () => {
    const mw = createBetterAuthMiddleware(
      async auth => {
        await auth.protect()
        return NextResponse.next()
      },
      async () => ({ userId: null, setCookies: [] })
    )
    const res = await mw(req('/x', { accept: 'application/json' }))
    expect(res.status).toBe(401)
  })

  it('does not look the session up when the handler never asks', async () => {
    const lookup = jest.fn()
    const mw = createBetterAuthMiddleware(
      async () => NextResponse.next(),
      lookup
    )
    const res = await mw(req('/x'))
    expect(res.headers.get('x-middleware-next')).toBe('1')
    expect(lookup).not.toHaveBeenCalled()
  })

  it('rethrows non-protect errors', async () => {
    const boom = new Error('boom')
    const mw = createBetterAuthMiddleware(
      async () => {
        throw boom
      },
      async () => ({ userId: null, setCookies: [] })
    )
    await expect(mw(req('/x'))).rejects.toBe(boom)
  })
})

describe('local mode redirects (LUM-1335)', () => {
  const saved = process.env.LUMO_MODE
  afterEach(() => {
    if (saved === undefined) delete process.env.LUMO_MODE
    else process.env.LUMO_MODE = saved
  })
  const page = (path: string) => req(path, { accept: 'text/html' })
  const location = (res: Response | null) =>
    res?.headers.get('location') ?? null

  it('localSignInRedirectUrl returns to the page, or to a sign-in page’s own target', () => {
    const deep = localSignInRedirectUrl(page('/workspace/acme/tasks?x=1'))
    expect(deep.pathname).toBe('/api/auth/lumo/local-sign-in')
    expect(deep.searchParams.get('redirect_url')).toBe(
      '/workspace/acme/tasks?x=1'
    )
    expect(localSignInRedirectUrl(page('/')).search).toBe('')
    expect(localSignInRedirectUrl(page('/signin')).search).toBe('')
    expect(
      localSignInRedirectUrl(
        page('/signin?redirect_url=%2Fworkspace%2Facme')
      ).searchParams.get('redirect_url')
    ).toBe('/workspace/acme')
  })

  it('localModeEntryRedirect: anonymous /, /signin, /signup pages in local mode only', () => {
    process.env.LUMO_MODE = 'local'
    for (const path of ['/', '/signin', '/signup']) {
      expect(location(localModeEntryRedirect(page(path), null))).toContain(
        '/api/auth/lumo/local-sign-in'
      )
    }
    expect(localModeEntryRedirect(page('/signin'), 'user_1')).toBeNull()
    expect(localModeEntryRedirect(page('/workspace'), null)).toBeNull()
    expect(
      localModeEntryRedirect(
        req('/signin', { accept: 'application/json' }),
        null
      )
    ).toBeNull()
    delete process.env.LUMO_MODE
    expect(localModeEntryRedirect(page('/signin'), null)).toBeNull()
  })

  it('protect() sends an anonymous page to the local sign-in in local mode, to /signin otherwise', async () => {
    const mw = createBetterAuthMiddleware(
      async auth => {
        await auth.protect()
        return NextResponse.next()
      },
      async () => ({ userId: null, setCookies: [] })
    )
    process.env.LUMO_MODE = 'local'
    expect(location(await mw(page('/workspace')))).toBe(
      'http://localhost:3000/api/auth/lumo/local-sign-in?redirect_url=%2Fworkspace'
    )
    delete process.env.LUMO_MODE
    expect(location(await mw(page('/workspace')))).toBe(
      'http://localhost:3000/signin?redirect_url=%2Fworkspace'
    )
  })
})
