/**
 * Request middleware entry point (LUM-1026), used by proxy.ts. Kept apart
 * from the @/lib/auth barrel so the proxy bundle never pulls in Prisma at
 * load time. Better Auth's middleware (LUM-1027) loads its server instance
 * lazily, on the first request.
 */
import type { NextRequest } from 'next/server'
import { createBetterAuthMiddleware } from './better-auth/middleware'
import { resolveAuthProvider } from './provider'
import type { AuthMiddlewareHandler } from './types'

export { createRouteMatcher } from './route-matcher'

type Middleware = ReturnType<typeof createBetterAuthMiddleware>

/**
 * Wrap a middleware handler so it runs with the auth session resolved. Built
 * on the first request (not at import), so building the app needs no auth
 * configuration; that first request also rejects a leftover
 * AUTH_PROVIDER=clerk (LUM-1077) instead of quietly ignoring it.
 */
export function createAuthMiddleware(handler: AuthMiddlewareHandler) {
  let impl: Middleware | null = null
  return (request: NextRequest) => {
    if (!impl) {
      resolveAuthProvider()
      impl = createBetterAuthMiddleware(handler)
    }
    return impl(request)
  }
}

export type { AuthMiddlewareHandler, MiddlewareAuth } from './types'
