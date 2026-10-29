/**
 * LUM-1027 — Better Auth implementation of the request middleware (proxy.ts).
 *
 * `userId()` validates the session (signed cookie cache first, database when
 * it has expired), so a stale cookie never counts as signed in — the proxy's
 * "signed-in users skip /signin" redirect cannot loop. `protect()` sends an
 * anonymous page request to /signin?redirect_url=<path>, and an anonymous
 * non-page request a 401, mirroring Clerk's `auth.protect()`.
 *
 * Any Set-Cookie the session lookup produced (a refreshed cookie cache or
 * session expiry) is copied onto the handler's response.
 */
import { NextResponse, type NextRequest } from 'next/server'
import type { AuthMiddlewareHandler, MiddlewareAuth } from '../types'
import { REDIRECT_PARAM_NAME } from './sign-in-helpers'
import { isLocalMode, LOCAL_SIGN_IN_PATH } from '../local-mode'

export const SIGN_IN_PATH = '/signin'

/** Thrown by `protect()`; turned into the response by the wrapper. */
class ProtectSignal {
  constructor(readonly response: Response) {}
}

type SessionLookup = (
  request: NextRequest
) => Promise<{ userId: string | null; setCookies: string[] }>

/** Pure: whether the request is a browser page navigation. */
export function isPageRequest(request: NextRequest): boolean {
  if (request.method !== 'GET' && request.method !== 'HEAD') return false
  const accept = request.headers.get('accept') ?? ''
  return accept.includes('text/html')
}

/** Pure: the sign-in URL that returns to the current path afterwards. */
export function signInRedirectUrl(request: NextRequest): URL {
  const url = new URL(SIGN_IN_PATH, request.url)
  const back = request.nextUrl.pathname + request.nextUrl.search
  if (back !== '/') url.searchParams.set(REDIRECT_PARAM_NAME, back)
  return url
}

/** The pages an anonymous visitor reaches before signing in. */
function isSignInEntry(pathname: string): boolean {
  return (
    pathname === '/' ||
    pathname.startsWith(SIGN_IN_PATH) ||
    pathname.startsWith('/signup')
  )
}

/**
 * LUM-1335 — pure: the local-mode sign-in URL that returns to the current
 * page afterwards. From a sign-in entry page (/, /signin, /signup) it returns
 * to that page's own `redirect_url`, or the default landing.
 */
export function localSignInRedirectUrl(request: NextRequest): URL {
  const url = new URL(LOCAL_SIGN_IN_PATH, request.url)
  const { pathname, search, searchParams } = request.nextUrl
  const back = isSignInEntry(pathname)
    ? searchParams.get(REDIRECT_PARAM_NAME)
    : pathname + search
  if (back) url.searchParams.set(REDIRECT_PARAM_NAME, back)
  return url
}

/**
 * LUM-1335 — in local mode, an anonymous visit to a sign-in entry page goes
 * straight to the local sign-in; anything else (and every other mode) → null.
 */
export function localModeEntryRedirect(
  request: NextRequest,
  userId: string | null
): Response | null {
  if (userId || !isPageRequest(request) || !isLocalMode()) return null
  if (!isSignInEntry(request.nextUrl.pathname)) return null
  return NextResponse.redirect(localSignInRedirectUrl(request))
}

async function lookupSession(request: NextRequest): ReturnType<SessionLookup> {
  const { getBetterAuth } = await import('./server')
  const { headers, response } = await getBetterAuth().api.getSession({
    headers: request.headers,
    returnHeaders: true,
  })
  return {
    userId: response?.user.id ?? null,
    setCookies: headers.getSetCookie(),
  }
}

/**
 * Build the middleware. `lookup` is injectable for tests; production uses
 * the Better Auth instance (imported lazily, on the first request).
 */
export function createBetterAuthMiddleware(
  handler: AuthMiddlewareHandler,
  lookup: SessionLookup = lookupSession
) {
  return async (request: NextRequest): Promise<Response> => {
    let session: Awaited<ReturnType<SessionLookup>> | null = null
    const resolve = async () => (session ??= await lookup(request))

    const auth: MiddlewareAuth = {
      userId: async () => (await resolve()).userId,
      protect: async () => {
        if ((await resolve()).userId) return
        throw new ProtectSignal(
          isPageRequest(request)
            ? NextResponse.redirect(
                isLocalMode()
                  ? localSignInRedirectUrl(request)
                  : signInRedirectUrl(request)
              )
            : NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        )
      },
    }

    let response: Response
    try {
      response = (await handler(auth, request)) ?? NextResponse.next()
    } catch (err) {
      if (err instanceof ProtectSignal) response = err.response
      else throw err
    }
    const resolved = session as Awaited<ReturnType<SessionLookup>> | null
    for (const cookie of resolved?.setCookies ?? []) {
      response.headers.append('set-cookie', cookie)
    }
    return response
  }
}
