/**
 * @jest-environment node
 */
import { NextRequest, NextResponse } from 'next/server'
import {
  createBetterAuthMiddleware,
  isPageRequest,
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
