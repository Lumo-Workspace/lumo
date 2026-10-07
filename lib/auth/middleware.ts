/**
 * Request middleware entry point (LUM-1026), used by proxy.ts. Kept apart
 * from the @/lib/auth barrel so the proxy bundle never pulls in Prisma at
 * load time. AUTH_PROVIDER picks Clerk's middleware or Better Auth's
 * (LUM-1027; it loads its server instance lazily, on the first request).
 */
import type { NextFetchEvent, NextRequest } from 'next/server'
import { createAuthMiddleware as createClerkMiddleware } from './clerk/middleware'
import { createBetterAuthMiddleware } from './better-auth/middleware'
import { isBetterAuth } from './provider'
import type { AuthMiddlewareHandler } from './types'

/**
 * `(request) => boolean` for path patterns like `/api/(.*)`. Clerk's matcher
 * is a pure path-to-regexp helper (no keys, no network), so both providers
 * share it.
 */
export { createRouteMatcher } from './clerk/middleware'

type Middleware = (
  request: NextRequest,
  event: NextFetchEvent
) =>
  | Response
  | null
  | undefined
  | void
  | Promise<Response | null | undefined | void>

/**
 * Wrap a middleware handler so it runs with the auth session resolved. The
 * provider is chosen on the first request (not at import), so building the
 * app needs no auth configuration.
 */
export function createAuthMiddleware(handler: AuthMiddlewareHandler) {
  let impl: Middleware | null = null
  return (request: NextRequest, event: NextFetchEvent) => {
    impl ??= isBetterAuth()
      ? createBetterAuthMiddleware(handler)
      : (createClerkMiddleware(handler) as Middleware)
    return impl(request, event)
  }
}

export type { AuthMiddlewareHandler, MiddlewareAuth } from './types'
